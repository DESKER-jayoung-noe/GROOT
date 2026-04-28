"""
DESKER 목재 견적 — PDF 도면 파싱 모듈
========================================

실제 데스커 DD13R 도면 PDF 분석 기반 (Creo Parametric 7.0 + Adobe PDF)

추출 항목:
  표제란 (신뢰도 높음, 100% 일관성):
    - 부품번호 (DAXZ/DSCC/DVDS XXXXXX)
    - 두께 + 소재 (예: 18t PB)
    - 표면재 (LPM, HPM, PET 등)
    - 엣지 (예: 2t ABS R2)
  
  도면 본체 (신뢰도 보통):
    - 보링 표기 (N-ØDxL 패턴)
    - 카운터싱크 표기 (N-Ø35×14)
    - 루터 모서리 R 표기 (4-R8)
    - 외곽 치수 후보 (큰 숫자들)
    - 키워드: "루터", "관통"

PDF 텍스트 추출 특성 (실측):
  - "Ø3" → " 3" (Ø가 공백으로 변환)
  - "Ø3" → "(cid:1)n(cid:2)3" (한글 폰트 fallback에서 깨진 글리프)
  - "Ø35×14 카운터싱크" → "35+ 0 0 .5X14" (tolerance 표기 흩어짐)
  - 한글 자재명: 폰트 임베딩 안 돼 추출 불가
  - "후면" 키워드는 잘 잡힘

STP와 머지 정책:
  - W/D/T/보링 위치/루터 형상 → STP 우선 (3D 정확)
  - 재질/표면재/엣지/색상/부품번호 → PDF 우선 (표제란 정확)
"""
import re
import pdfplumber


def _clean_text(text: str) -> str:
    """깨진 글리프 (cid:N), 다중 공백 정리"""
    # (cid:숫자) 패턴 → 공백
    text = re.sub(r"\(cid:\d+\)", " ", text)
    # 영문 'n' 한 글자만 단독으로 있으면 Ø의 fallback일 수 있음 (보링 표기 컨텍스트)
    # 다중 공백 → 단일 공백
    text = re.sub(r"\s+", " ", text)
    return text


# 보링 패턴 (Ø는 공백으로 추출되므로 옵션):
# 매칭: "2- 3X3", "3- 3X10", "2-Ø3X3", "2-3X3"
BORING_PATTERN = re.compile(
    r"(\d+)\s*-\s*[Ø⌀ø∅n]?\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)"
)

# 카운터싱크 패턴 (tolerance 포함):
# 원본: "2-Ø35⁰⁺⁰⁵×14⁰⁺⁰⁵"
# 추출: "2- 35+ 0 0 .5X14" 또는 "2- 35X14"
COUNTERBORE_PATTERN = re.compile(
    r"(\d+)\s*-\s*[Ø⌀ø∅]?\s*(\d{2,})\s*(?:\+\s*[\d\s.]*)?\s*[xX×]\s*(\d+(?:\.\d+)?)"
)

# 루터 모서리 R: "4-R8"
ROUTER_PATTERN = re.compile(r"(\d+)\s*-\s*R\s*(\d+(?:\.\d+)?)")

PART_NO_PATTERN = re.compile(r"(D[A-Z]{2,4}\d{5,8})")
MATERIAL_PATTERN = re.compile(
    r"(\d+(?:\.\d+)?)\s*t\s+([A-Z]{2,4})\s*\+?\s*([A-Z]+(?:/[A-Z])?)"
)
EDGE_PATTERN = re.compile(
    r"(\d+)\s*[tT]\s+([A-Z]{2,4})\s*\(R(\d+(?:\.\d+)?)\)\s*(\d+)?"
)


def parse_pdf(pdf_path: str) -> dict:
    result = {
        "part_no": None,
        "thickness_mm": None,
        "material": None,
        "surface": None,
        "edge_thickness_mm": None,
        "edge_material": None,
        "edge_radius_mm": None,
        "boring_total": 0,
        "deep_boring_total": 0,
        "boring_details": [],
        "router_corners": [],
        "router_detected": False,
        "back_face_borings": [],
        "dimensions_mm": [],
        "has_router_keyword": False,
        "has_groove_through": False,
        "confidence": 0.0,
    }
    
    try:
        with pdfplumber.open(pdf_path) as pdf:
            page = pdf.pages[0]
            full_text = _clean_text(page.extract_text() or "")
            # 도면 영역만 (하단 표제란 15% 제외)
            h = page.height
            drawing = page.crop((0, 0, page.width, h * 0.85))
            drawing_text = _clean_text(drawing.extract_text() or "")
    except Exception as e:
        result["error"] = str(e)
        return result
    
    # 표제란 정보 (전체 텍스트에서)
    m = PART_NO_PATTERN.search(full_text)
    if m:
        result["part_no"] = m.group(1)
    
    m = MATERIAL_PATTERN.search(full_text)
    if m:
        result["thickness_mm"] = float(m.group(1))
        result["material"] = m.group(2)
        result["surface"] = m.group(3).split("/")[0]
    
    m = EDGE_PATTERN.search(full_text)
    if m:
        result["edge_thickness_mm"] = int(m.group(1))
        result["edge_material"] = m.group(2)
        result["edge_radius_mm"] = float(m.group(3))
    
    # 도면 영역에서 보링 표기 추출
    # "후면" 키워드 위치 추적
    back_positions = [m.start() for m in re.finditer(r"후면", drawing_text)]
    
    # 카운터싱크 먼저 (Ø값이 큰 것)
    counterbore_ranges = []  # 카운터싱크로 매치된 영역 기록 (중복 방지)
    for cm in COUNTERBORE_PATTERN.finditer(drawing_text):
        count = int(cm.group(1))
        big = float(cm.group(2))
        small = float(cm.group(3))
        # Ø35×14 → 큰 직경 ≥ 20일 때 카운터싱크로 인정
        if big >= 20:
            result["deep_boring_total"] += count
            result["boring_details"].append({
                "count": count, "diameter": big, "depth": small,
                "type": "counterbore", "back": False
            })
            counterbore_ranges.append((cm.start(), cm.end()))
    
    # 일반 보링
    for bm in BORING_PATTERN.finditer(drawing_text):
        # 카운터싱크 영역과 겹치면 스킵
        if any(s <= bm.start() < e for s, e in counterbore_ranges):
            continue
        count = int(bm.group(1))
        dia = float(bm.group(2))
        depth = float(bm.group(3))
        # 너무 큰 직경/깊이는 외곽 치수와 혼동 가능 → 거름
        if dia > 30 or depth > 30 or dia < 2:
            continue
        # "후면" 위치 확인
        is_back = any(abs(bm.start() - bp) < 30 for bp in back_positions)
        
        if dia >= 10:
            # Ø10 이상은 큰 보링 (다보용)
            result["boring_total"] += count
        else:
            result["boring_total"] += count
        
        entry = {
            "count": count, "diameter": dia, "depth": depth,
            "type": "boring", "back": is_back
        }
        result["boring_details"].append(entry)
        if is_back:
            result["back_face_borings"].append(entry)
    
    # 루터 모서리 R
    for rm in ROUTER_PATTERN.finditer(drawing_text):
        count = int(rm.group(1))
        r = float(rm.group(2))
        result["router_corners"].append({"count": count, "radius": r})
    if result["router_corners"] and any(c["count"] == 4 for c in result["router_corners"]):
        result["router_detected"] = True
    
    # 키워드
    result["has_router_keyword"] = "루터" in full_text
    result["has_groove_through"] = "관통" in full_text
    
    # 외곽 치수 후보
    nums = re.findall(r"\b(\d{2,4}(?:\.\d)?)\b", drawing_text)
    candidates = [float(n) for n in nums if 50 < float(n) < 3000]
    result["dimensions_mm"] = sorted(set(candidates), reverse=True)[:10]
    
    # 신뢰도
    score = 0.0
    if result["part_no"]: score += 0.2
    if result["thickness_mm"]: score += 0.2
    if result["material"]: score += 0.15
    if result["surface"]: score += 0.1
    if result["edge_thickness_mm"]: score += 0.15
    if result["boring_details"] or result["router_corners"]: score += 0.1
    if result["dimensions_mm"]: score += 0.1
    result["confidence"] = round(min(1.0, score), 2)
    
    return result


# ─────────────────────────────────────────────────────────────
# 호환 wrapper — 프론트엔드(STP 파서) 평탄 응답 형식
# ─────────────────────────────────────────────────────────────

import os as _os
import io as _io
import zipfile as _zipfile
import tempfile as _tempfile

# 표면재 매핑: PDF 표제란은 "LPM" 만 추출, STP 응답은 "LPM/O" 형식
_SURFACE_DEFAULT = {
    "LPM": "LPM/O",
    "HPM": "HPM/O",
    "PET": "PET/O",
    "FF":  "FF",
    "NF":  "NF",
    "MEL": "MEL",
    "UV":  "UV",
}


def _pdf_info_to_material(info: dict, pdf_path: str) -> dict:
    """
    pdf_drawing_parser.parse_pdf() 결과를 STP 파서 호환 평탄 응답으로 변환.
    프론트엔드 UploadModal.buildRows() 에서 그대로 사용 가능.
    """
    basename = _os.path.basename(pdf_path)
    stem = _os.path.splitext(basename)[0]

    # 외곽 치수 후보 — 큰 순서대로 정렬됨. 첫 2개를 W/D 후보로
    dims = info.get("dimensions_mm") or []
    w = dims[0] if len(dims) >= 1 else 0.0
    d = dims[1] if len(dims) >= 2 else 0.0

    t = info.get("thickness_mm") or 0.0

    # 엣지: PDF 에서 두께/소재 추출되면 4면 가정 (도면에는 면수 표기 없음 — 통상 4면)
    edge_t = info.get("edge_thickness_mm") or 0
    edge_count = 4 if edge_t > 0 else 0

    # 보링
    h1 = int(info.get("boring_total") or 0)
    h2 = int(info.get("deep_boring_total") or 0)

    # 루터 — corners 4-R 패턴이 있으면 perimeter 계산 (외곽 치수가 있을 때)
    router_slots: list[dict] = []
    router_mm_total = 0.0
    if info.get("router_detected") and w > 0 and d > 0:
        # 도면 외곽 치수를 perimeter 추정에 사용
        peri = round(2 * (w + d), 1)
        rcorner = next((c for c in info.get("router_corners") or [] if c.get("count") == 4), None)
        router_slots.append({
            "axis": "Z",
            "size": (w, d),
            "corner_radius": float(rcorner["radius"]) if rcorner else 0.0,
            "perimeter_mm": peri,
        })
        router_mm_total = peri

    # 표면재 / 소재
    material = info.get("material") or "PB"
    surface_raw = info.get("surface") or "LPM"
    surface = _SURFACE_DEFAULT.get(surface_raw.upper(), surface_raw)

    # 자재명: part_no 가 있으면 우선, 아니면 파일명 stem
    name = info.get("part_no") or stem

    return {
        # 파일 식별
        "stpFile":   basename,
        "file":      basename,
        # 기본 정보
        "name":      name,
        "partNo":    info.get("part_no") or "",
        "source":    "pdf",
        "is_wood":   True,
        # 치수
        "w": float(w), "d": float(d), "t": float(t),
        # 보링 / 루터
        "holeCount":  h1,
        "hole2Count": h2,
        "routerSlots": router_slots,
        "routerMm":    router_mm_total,
        # 엣지
        "edgeCount":   edge_count,
        "edgeT":       float(edge_t),
        # 엣지 추론 단계
        "edgeCountSource": "pdf_inferred",
        "edgeTSource":     "pdf_text" if edge_t else "default",
        "hasEdgeFile":     False,
        # 소재
        "material": material,
        "surface":  surface,
        "color":    "WW",
        # PDF 원본 정보 (머지/디버깅)
        "confidence":              float(info.get("confidence") or 0.0),
        "router_corners":          info.get("router_corners") or [],
        "has_router_keyword":      bool(info.get("has_router_keyword")),
        "has_groove_through":      bool(info.get("has_groove_through")),
        "back_face_borings":       info.get("back_face_borings") or [],
        "dimensions_mm":           dims,
        "edge_radius_mm":          info.get("edge_radius_mm"),
        "sources":                 ["pdf"],
    }


def parse_pdf_file(pdf_path: str) -> dict:
    """단일 PDF → 프론트엔드 호환 자재 딕트."""
    info = parse_pdf(pdf_path)
    return _pdf_info_to_material(info, pdf_path)


def parse_pdf_zip(zip_bytes: bytes) -> list[dict]:
    """ZIP 안의 모든 PDF 일괄 파싱 → 자재 리스트."""
    results: list[dict] = []
    try:
        with _zipfile.ZipFile(_io.BytesIO(zip_bytes)) as zf:
            for name in zf.namelist():
                if not name.lower().endswith(".pdf"):
                    continue
                if name.endswith("/"):
                    continue
                with _tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(zf.read(name))
                    tmp_path = tmp.name
                try:
                    mat = parse_pdf_file(tmp_path)
                    # 원래 ZIP 내부 경로를 file 필드로 보존
                    mat["stpFile"] = _os.path.basename(name)
                    mat["file"] = _os.path.basename(name)
                    results.append(mat)
                finally:
                    try: _os.unlink(tmp_path)
                    except OSError: pass
    except Exception:
        pass
    return results


# ─────────────────────────────────────────────────────────────
# STP / PDF 머지 (part_no 기준)
# ─────────────────────────────────────────────────────────────

def merge_stp_and_pdf(stp_results: list[dict], pdf_results: list[dict]) -> list[dict]:
    """
    같은 part_no 의 STP+PDF 결과를 머지.

    머지 원칙:
      - W/D/T/보링 위치/루터 형상 → STP 우선 (3D 정확)
      - 재질/표면재/엣지/색상/부품번호 → PDF 우선 (표제란 정확)
      - 매칭 안 되면 STP/PDF 별도 항목으로 유지

    Returns: merged 자재 리스트 (sources 필드로 출처 표기)
    """
    if not pdf_results:
        return [{**s, "sources": ["stp"]} for s in stp_results]
    if not stp_results:
        return list(pdf_results)

    # PDF 를 part_no 로 인덱싱
    pdf_by_partno: dict[str, dict] = {}
    for p in pdf_results:
        pn = (p.get("partNo") or p.get("part_no") or "").strip().upper()
        if pn:
            pdf_by_partno[pn] = p

    used_pdf: set[str] = set()
    merged: list[dict] = []
    for s in stp_results:
        pn = (s.get("partNo") or "").strip().upper()
        p = pdf_by_partno.get(pn) if pn else None
        if p is not None:
            used_pdf.add(pn)
            merged.append(_merge_one(s, p))
        else:
            merged.append({**s, "sources": ["stp"]})

    # 매칭 안 된 PDF 별도 항목으로 추가
    for pn, p in pdf_by_partno.items():
        if pn not in used_pdf:
            merged.append(p)

    return merged


def _merge_one(stp: dict, pdf: dict) -> dict:
    """단일 STP+PDF 항목 머지."""
    out = dict(stp)
    # 재질/표면재/엣지/색상/부품번호 → PDF 우선
    if pdf.get("partNo"):  out["partNo"] = pdf["partNo"]
    if pdf.get("name"):    out["name"] = pdf["name"]
    if pdf.get("material"):out["material"] = pdf["material"]
    if pdf.get("surface"): out["surface"] = pdf["surface"]
    if pdf.get("edgeT"):   out["edgeT"] = pdf["edgeT"]
    # edgeT 가 PDF 출처면 source 도 갱신
    if pdf.get("edgeT"):
        out["edgeTSource"] = "pdf_text"
    # 신뢰도 부스트
    sc = max(float(stp.get("confidence", 0) or 0), float(pdf.get("confidence", 0) or 0))
    # 두 출처 교차 검증 시 부가 점수
    out["confidence"] = round(min(1.0, sc + 0.05), 2)
    out["sources"] = ["stp", "pdf"]
    out["router_confirmed_by_pdf"] = bool(pdf.get("has_router_keyword"))
    out["edge_radius_mm"] = pdf.get("edge_radius_mm")
    return out


if __name__ == "__main__":
    import sys
    import json
    
    paths = sys.argv[1:] if len(sys.argv) > 1 else [
        "/home/claude/door_l.pdf",
        "/home/claude/m_shelf.pdf",
        "/home/claude/side_l.pdf",
        "/home/claude/duct_band.pdf",
    ]
    
    for path in paths:
        name = path.split("/")[-1]
        print(f"\n{'='*70}\nFILE: {name}\n{'='*70}")
        info = parse_pdf(path)
        print(json.dumps(info, indent=2, ensure_ascii=False))
