from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Optional, List
import io

try:
    from .parser import parse_stp_zip as parse_stp_zip_file
    from .pdf_parser import parse_pdf
except ImportError:
    from parser import parse_stp_zip as parse_stp_zip_file
    from pdf_parser import parse_pdf

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/api/parse/stp-zip")
async def parse_stp_zip_endpoint(
    file: UploadFile = File(...),
    bom: Optional[UploadFile] = File(None),
):
    try:
        zip_bytes = await file.read()
        bom_content = None
        if bom is not None:
            bom_content = (await bom.read()).decode("utf-8-sig", errors="ignore")
        materials = parse_stp_zip_file(zip_bytes, bom_content=bom_content)
        return JSONResponse({"status": "ok", "count": len(materials), "materials": materials})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STP ZIP parse failed: {e}")


@app.post("/api/parse/pdf")
async def parse_pdf_endpoint(file: UploadFile = File(...)):
    try:
        import tempfile
        import os

        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="PDF 파일만 업로드할 수 있습니다.")
        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        try:
            tmp.write(await file.read())
            tmp.close()
            parsed = parse_pdf(tmp.name)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
        return JSONResponse(parsed)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF parse failed: {e}")


# ── 통합 업로드 엔드포인트 ────────────────────────────────────────────────────

def _conf(m: dict) -> float:
    """신뢰도 자동 계산 (파서 결과 기반)."""
    w = float(m.get("wMm") or m.get("w") or 0)
    d = float(m.get("dMm") or m.get("d") or 0)
    t = float(m.get("hMm") or m.get("t") or m.get("thickness") or 0)
    has_dims = w > 0 and d > 0
    has_t    = t > 0
    has_part = bool(m.get("part_no") or m.get("partNo"))
    if has_dims and has_t and has_part: return 0.92
    if has_dims and has_t:              return 0.75
    if has_t and has_part:              return 0.65
    if has_t:                           return 0.55
    return 0.35


def _norm(m: dict, fallback_fname: str, source: str) -> dict:
    """파서 출력을 클라이언트 공통 포맷으로 정규화."""
    t_val = m.get("hMm") or m.get("t") or m.get("thickness") or 0
    result: dict = {
        "fileName":   m.get("file") or fallback_fname,
        "name":       m.get("name") or m.get("item_name") or m.get("partName") or "자재",
        "source":     m.get("source") or source,
        "wMm":        float(m.get("wMm") or m.get("w") or 0),
        "dMm":        float(m.get("dMm") or m.get("d") or 0),
        "hMm":        float(t_val),
        "partNo":     str(m.get("part_no") or m.get("partNo") or ""),
        "edgeCount":  int(m.get("edgeCount") or m.get("edgeEa") or 0),
        "edgeT":      float(m.get("edgeT") or m.get("edgeThickness") or 1),
        "holeCount":  int(m.get("holeCount") or m.get("holes") or 0),
        "hole2Count": int(m.get("hole2Count") or 0),
        "routerMm":   float(m.get("routerMm") or m.get("rutaMm") or 0),
        "material":   str(m.get("base_material") or m.get("material") or "PB"),
        "surface":    str(m.get("surface") or "LPM/O"),
        "color":      str(m.get("color") or "WW"),
        "confidence": float(m.get("confidence") or _conf(m)),
    }
    if "error" in m:
        result["warn"] = str(m["error"])
    return result


@app.post("/api/parse/upload")
async def parse_upload_unified(files: List[UploadFile] = File(...)):
    """
    통합 업로드 엔드포인트: ZIP/STP/PDF 파일을 여러 개 받아
    파서별로 처리 후 정규화된 자재 목록을 반환합니다.
    같은 PART_NO가 여러 소스에서 오면 STP 우선 병합합니다.
    """
    import tempfile, os, zipfile as zipmod

    all_materials: list = []

    for upload_file in files:
        fname      = upload_file.filename or "unknown"
        fname_low  = fname.lower()
        raw        = await upload_file.read()

        try:
            if fname_low.endswith(".zip"):
                mats = parse_stp_zip_file(raw, bom_content=None)
                for m in mats:
                    all_materials.append(_norm(m, fname, "zip"))

            elif fname_low.endswith((".stp", ".step")):
                # 단일 STP를 인메모리 ZIP으로 감싸서 기존 파서 재사용
                buf = io.BytesIO()
                with zipmod.ZipFile(buf, "w", zipmod.ZIP_DEFLATED) as zf:
                    zf.writestr(fname, raw)
                mats = parse_stp_zip_file(buf.getvalue(), bom_content=None)
                for m in mats:
                    all_materials.append(_norm(m, fname, "stp"))

            elif fname_low.endswith(".pdf"):
                tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
                try:
                    tmp.write(raw)
                    tmp.close()
                    parsed = parse_pdf(tmp.name)
                    # parse_pdf may return dict or list
                    if isinstance(parsed, list):
                        for m in parsed:
                            all_materials.append(_norm(m, fname, "pdf"))
                    elif isinstance(parsed, dict):
                        inner = parsed.get("materials", [])
                        if inner:
                            for m in inner:
                                all_materials.append(_norm(m, fname, "pdf"))
                        else:
                            all_materials.append(_norm(parsed, fname, "pdf"))
                finally:
                    try:
                        os.unlink(tmp.name)
                    except OSError:
                        pass
            else:
                all_materials.append({
                    "fileName": fname, "name": "(미지원 형식)", "source": "stp",
                    "wMm": 0, "dMm": 0, "hMm": 0, "confidence": 0.2,
                    "warn": f"지원하지 않는 파일 형식: {fname}",
                })

        except Exception as exc:
            all_materials.append({
                "fileName": fname, "name": "(파싱 실패)", "source": "stp",
                "wMm": 0, "dMm": 0, "hMm": 0, "confidence": 0.1,
                "warn": str(exc),
            })

    # PART_NO 기준 STP 우선 병합
    merged: dict = {}
    for m in all_materials:
        key = m.get("partNo") or ""
        if not key:
            merged[id(m)] = m  # 고유 키로 그냥 추가
        else:
            existing = merged.get(key)
            if existing is None:
                merged[key] = m
            elif m.get("source") in ("stp", "zip") and existing.get("source") == "pdf":
                merged[key] = m  # STP가 PDF 덮어쓰기

    result = list(merged.values())
    return JSONResponse({"status": "ok", "count": len(result), "materials": result})


@app.get("/api/health")
def health():
    return {"status": "ok"}


