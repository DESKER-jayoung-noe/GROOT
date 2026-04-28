from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Optional

try:
    from .parser import parse_stp_zip as parse_stp_zip_file
    from .pdf_parser import parse_pdf_file, parse_pdf_zip, merge_stp_and_pdf
except ImportError:
    from parser import parse_stp_zip as parse_stp_zip_file
    from pdf_parser import parse_pdf_file, parse_pdf_zip, merge_stp_and_pdf

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.post("/api/parse/stp-zip")
async def parse_stp_zip_endpoint(
    file: UploadFile = File(...),
    bom: Optional[UploadFile] = File(None),
):
    """
    ZIP 통합 파싱 — STP + PDF 모두 처리하고 part_no 기준으로 머지.
    - STP 만 있으면 STP 결과만
    - PDF 만 있으면 PDF 결과만
    - 둘 다 있고 part_no 일치 시 STP+PDF 교차검증 자재로 머지
    """
    try:
        zip_bytes = await file.read()
        bom_content = None
        if bom is not None:
            bom_content = (await bom.read()).decode("utf-8-sig", errors="ignore")
        stp_materials = parse_stp_zip_file(zip_bytes, bom_content=bom_content)
        pdf_materials = parse_pdf_zip(zip_bytes)
        materials = merge_stp_and_pdf(stp_materials, pdf_materials)
        return JSONResponse({
            "status": "ok",
            "count": len(materials),
            "materials": materials,
            "stp_count": len(stp_materials),
            "pdf_count": len(pdf_materials),
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STP ZIP parse failed: {e}")


@app.post("/api/parse/pdf")
async def parse_pdf_endpoint(file: UploadFile = File(...)):
    """단일 PDF 도면 파싱 — STP 파서와 호환되는 평탄 응답 반환."""
    try:
        import tempfile
        import os

        if not file.filename or not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="PDF 파일만 업로드할 수 있습니다.")
        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        try:
            tmp.write(await file.read())
            tmp.close()
            parsed = parse_pdf_file(tmp.name)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
        # UploadModal.buildRows 호환: materials 배열로 래핑
        return JSONResponse({"status": "ok", "count": 1, "materials": [parsed]})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF parse failed: {e}")


@app.post("/api/parse/pdf-zip")
async def parse_pdf_zip_endpoint(file: UploadFile = File(...)):
    """ZIP 안의 PDF 여러 개 일괄 파싱"""
    try:
        zip_bytes = await file.read()
        materials = parse_pdf_zip(zip_bytes)
        return JSONResponse({"status": "ok", "count": len(materials), "materials": materials})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF ZIP parse failed: {e}")


@app.get("/api/health")
def health():
    return {"status": "ok"}
