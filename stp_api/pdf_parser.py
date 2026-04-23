"""
DESKER 목재 견적 계산기 — PDF 도면 파싱 모듈
===============================================
위치: stp_api/pdf_parser.py

⚠️  이 파일은 PDF 파싱 핵심 로직입니다.
    커서(AI)가 임의로 수정하지 마세요.
    수정이 필요할 때는 # EDIT: 주석이 달린 구간만 변경하세요.

추출 가능한 정보:
  - 파트번호 (DAXZ602016 등 표제란)
  - 파트명   (DD13_1200_DOOR_L 등)
  - 소재     (PB, MDF)
  - 표면재   (LPM/O, PET)
  - 엣지     (ABS 2T R2 등)
  - T (두께) — 소재 라인 "18t PB" 패턴
  - W, D     — 도면 상 주요 치수 (정밀도 중간)
  - 보링 개수 — 벡터 원형 요소 카운팅
  - 신뢰도   — 0.0 ~ 1.0

⚠️ 주의: PDF 치수는 도면 표기 치수라서 STP 모델 치수와
   다를 수 있습니다. STP가 있으면 STP 우선 사용 권장.

의존성:
  pip install pdfplumber pymupdf --break-system-packages
"""

import re
import json
import sys
from pathlib import Path
from typing import Optional

try:
    import pdfplumber
    import fitz  # PyMuPDF
except ImportError:
    raise ImportError("pip install pdfplumber pymupdf --break-system-packages")


# ─────────────────────────────────────────────────────────────
# 1. 상수 / 패턴
# ─────────────────────────────────────────────────────────────

# EDIT: 소재 키워드 추가 시 이 딕셔너리만 수정
MATERIAL_MAP = {
    'PB': 'PB', '파티클': 'PB', 'PARTICLE': 'PB',
    'MDF': 'MDF',
}

# EDIT: 표면재 키워드 추가 시 이 딕셔너리만 수정
SURFACE_MAP = {
    'LPM/O': 'LPM/O', 'LPM': 'LPM/O', '멜라민': 'LPM/O',
    'PET': 'PET',
    'UV': 'UV',
}

# EDIT: 파트번호 패턴 변경 시 이 정규식만 수정
PART_NO_PATTERN = r'(DA[A-Z]{2}\d{6})'

# EDIT: 두께 패턴 변경 시 이 정규식만 수정
THICKNESS_PATTERN = r'(\d{1,2}(?:\.\d)?)t\s*(?:PB|MDF|합판|목재)'


# ─────────────────────────────────────────────────────────────
# 2. 텍스트 기반 추출
# ─────────────────────────────────────────────────────────────

def extract_part_info(full_text: str) -> dict:
    """
    표제란 텍스트에서 파트번호, 파트명, 소재, 표면재, 엣지 추출.

    # EDIT: 표제란 포맷이 다르면 이 함수 수정
    """
    info = {
        'part_no': '',
        'part_name': '',
        'material': '',
        'surface': '',
        'edge': '',
    }

    # 파트번호 (DAXZ602016 형식)
    m = re.search(PART_NO_PATTERN, full_text)
    if m:
        info['part_no'] = m.group(1)

    # 파트명 — 파일명 패턴 (DD13_1200_... 형식)
    m = re.search(r'(DD\d+[_\-]\w+(?:[_\-]\w+){1,4})', full_text)
    if m:
        info['part_name'] = m.group(1).rstrip('_ASSY').rstrip('_asm')

    # 소재
    text_upper = full_text.upper()
    for kw, mat in MATERIAL_MAP.items():
        if kw.upper() in text_upper:
            info['material'] = mat
            break

    # 표면재
    for kw, surf in SURFACE_MAP.items():
        if kw.upper() in text_upper:
            info['surface'] = surf
            break

    # 엣지 (ABS R2, 2T ABS 등)
    m = re.search(r'(\d+t?\s*ABS(?:\s*\(?R\d+\)?)?)', full_text, re.IGNORECASE)
    if m:
        info['edge'] = m.group(1).strip()

    return info


def extract_thickness(full_text: str) -> Optional[float]:
    """
    "18t PB", "15.5t MDF" 등 소재 라인에서 두께 추출.

    # EDIT: THICKNESS_PATTERN 변경으로 대응
    """
    m = re.search(THICKNESS_PATTERN, full_text, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


def extract_dimensions(full_text: str) -> tuple[Optional[float], Optional[float]]:
    """
    도면 텍스트에서 W, D 추정.
    — 200~3000 범위 숫자 중 큰 두 값을 W, D로 사용.
    — 정밀도 낮음. STP 있으면 STP 우선 사용 권장.

    Returns: (W, D)

    # EDIT: 치수 추출 로직 개선 시 이 함수
    """
    nums = [float(n) for n in re.findall(r'\b(\d{3,4}(?:\.\d)?)\b', full_text)]
    candidates = sorted(set(n for n in nums if 100 < n < 3000), reverse=True)

    if len(candidates) >= 2:
        return candidates[1], candidates[0]  # W, D (작은 쪽, 큰 쪽)
    elif len(candidates) == 1:
        return candidates[0], None
    return None, None


# ─────────────────────────────────────────────────────────────
# 3. 벡터 요소 기반 보링 추출
# ─────────────────────────────────────────────────────────────

def extract_holes_from_vectors(pdf_path: str) -> tuple[int, int]:
    """
    PyMuPDF로 PDF 벡터 원형 요소를 카운팅해 보링 개수 추출.

    기준:
    - 원에 가까운 사각형 경계 (종횡비 0.75~1.25)
    - 반지름 4pt 이상 → 일반 보링
    - 반지름 1.5~4pt  → 2단 보링 (작은 원)
    - 결과는 ÷2 (상하 대칭 도면)

    Returns: (hole_1st, hole_2nd)

    # EDIT: 반지름 임계값(pt 단위) 변경 시 이 함수
    """
    doc = fitz.open(pdf_path)
    h1 = h2 = 0

    for page in doc:
        for path in page.get_drawings():
            rect = path.get('rect')
            if not rect:
                continue
            w = rect[2] - rect[0]
            h = rect[3] - rect[1]
            # 원에 가까운지 확인
            if h == 0 or not (0.75 < w / h < 1.25):
                continue
            radius_pt = w / 2
            if radius_pt > 4:
                h1 += 1
            elif 1.5 <= radius_pt <= 4:
                h2 += 1

    doc.close()
    return h1 // 2, h2 // 2


# ─────────────────────────────────────────────────────────────
# 4. 텍스트 보링 패턴 (보조)
# ─────────────────────────────────────────────────────────────

def extract_holes_from_text(full_text: str) -> tuple[int, int]:
    """
    "2-∅35+0.5×14" 같은 텍스트 보링 표기에서 개수 추출.
    벡터 추출 실패 시 보조로 사용.

    Returns: (hole_1st, hole_2nd)

    # EDIT: 보링 텍스트 패턴 변경 시 이 함수
    """
    # "N-ØD×L" 또는 "N-DxL" 패턴
    matches = re.findall(
        r'(\d+)\s*[-–]\s*[φΦ∅]?\s*(\d+(?:\.\d+)?)\s*[xX×\+]\s*(\d+(?:\.\d+)?)',
        full_text
    )
    h1 = h2 = 0
    for count, diam, depth in matches:
        cnt = int(count)
        d = float(diam)
        dep = float(depth)
        if 3 <= d <= 70:  # 보링 직경 범위
            if dep < 8:   # 얕은 보링 → 2단
                h2 += cnt
            else:
                h1 += cnt
    return h1, h2


# ─────────────────────────────────────────────────────────────
# 5. 메인 진입점
# ─────────────────────────────────────────────────────────────

def parse_pdf(pdf_path: str) -> dict:
    """
    PDF 도면 파일 파싱 메인 함수.

    Args:
        pdf_path: PDF 파일 경로

    Returns:
        {
            "part_no":    str,
            "part_name":  str,
            "material":   str,   # "PB", "MDF"
            "surface":    str,   # "LPM/O", "PET"
            "edge":       str,   # "ABS 2T R2"
            "W":          float or None,
            "D":          float or None,
            "T":          float or None,
            "hole_1st":   int,
            "hole_2nd":   int,
            "confidence": float,  # 0.0 ~ 1.0
            "note":       str,    # 파싱 메모
        }

    신뢰도 기준:
        파트번호 추출 +0.2
        소재 추출    +0.2
        T 추출       +0.2
        W/D 추출     +0.2
        보링 있음    +0.1
        표면재 추출  +0.1
    """
    result = {
        'part_no': '', 'part_name': '', 'material': '', 'surface': '',
        'edge': '', 'W': None, 'D': None, 'T': None,
        'hole_1st': 0, 'hole_2nd': 0, 'confidence': 0.0,
        'note': '⚠ PDF 치수는 도면 표기치수. STP 있으면 STP 우선 사용 권장.',
    }
    confidence = 0.0

    # 텍스트 추출
    with pdfplumber.open(pdf_path) as pdf:
        full_text = '\n'.join(p.extract_text() or '' for p in pdf.pages)

    # 파트 정보
    info = extract_part_info(full_text)
    result.update(info)
    if info['part_no']:   confidence += 0.2
    if info['material']:  confidence += 0.2
    if info['surface']:   confidence += 0.1

    # 두께
    T = extract_thickness(full_text)
    if T:
        result['T'] = T
        confidence += 0.2

    # W, D
    W, D = extract_dimensions(full_text)
    if W:
        result['W'] = W
        result['D'] = D
        confidence += 0.2

    # 보링 — 벡터 우선, 실패 시 텍스트
    h1v, h2v = extract_holes_from_vectors(pdf_path)
    h1t, h2t = extract_holes_from_text(full_text)
    result['hole_1st'] = h1v if h1v > 0 else h1t
    result['hole_2nd'] = h2v if h2v > 0 else h2t
    if result['hole_1st'] > 0 or result['hole_2nd'] > 0:
        confidence += 0.1

    result['confidence'] = round(min(confidence, 1.0), 2)
    return result


# ─────────────────────────────────────────────────────────────
# 6. CLI 실행
# ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python pdf_parser.py <path/to/drawing.pdf>")
        sys.exit(1)
    result = parse_pdf(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False, indent=2))
