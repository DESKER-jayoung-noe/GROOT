"""
DESKER 목재 견적 계산기 — STP 파싱 모듈
==========================================
위치: stp_api/parser.py

⚠️  이 파일은 STP 파싱 핵심 로직입니다.
    커서(AI)가 임의로 수정하지 마세요.
    수정이 필요할 때는 # EDIT: 주석이 달린 구간만 변경하세요.
"""

import io
import re
import zipfile
import tempfile
import os
from pathlib import Path
from typing import Optional

# build123d / OCP 의존성 — STP 3D 렌더링용이므로 파싱에는 불필요 (주석 처리)
# from build123d import import_step
# from OCP.BRepAdaptor import BRepAdaptor_Surface
# from OCP.TopoDS import TopoDS
# from OCP.GeomAbs import GeomAbs_Cylinder


# ─────────────────────────────────────────────────────────────
# 0. 공통 유틸
# ─────────────────────────────────────────────────────────────

# STEP ISO 10303-21 \X2\HEXHEX\X0\ → UTF-16 BE 디코딩
_X2_PAT = re.compile(r'\\X2\\([0-9A-Fa-f]+)\\X0\\')

def decode_step_unicode(s: str) -> str:
    """STEP 파일의 \\X2\\HEXHEX\\X0\\ 유니코드 이스케이프를 UTF-16 BE로 디코딩."""
    return _X2_PAT.sub(
        lambda m: bytes.fromhex(m.group(1)).decode('utf-16-be', 'replace'),
        s,
    )


# EDIT: 표준 두께 목록 — 실측값(.5mm 단위) 기준. 짝수 mm는 제거.
# '18t' MATERIAL 문자열 → 18.0 → snap → 18.5 로 보정됨.
STANDARD_THICKNESSES = [4.5, 9.0, 12.0, 15.5, 18.5, 22.5, 25.0, 28.5, 33.0]

def _snap_thickness(raw_t: float) -> Optional[float]:
    """
    raw_t 를 표준 두께로 스냅.
    가장 가까운 표준값과의 차이가 2.0mm 이내일 때만 반환, 아니면 None.
    None 반환 시 호출자는 MATERIAL/THICKNESS 명시값으로 폴백.
    """
    if not STANDARD_THICKNESSES:
        return None
    best = min(STANDARD_THICKNESSES, key=lambda s: abs(s - raw_t))
    return float(best) if abs(best - raw_t) <= 2.0 else None


def _is_part_code(s: str) -> bool:
    """
    DSCCAB1207 같은 '단품코드' 형식 판별 — 영문대문자+숫자, 5~15자.
    자연어(한글 포함 또는 공백 포함 영문)는 False 반환.
    """
    return bool(re.fullmatch(r'[A-Z0-9\-]{5,15}', s.strip().upper()))


# ─────────────────────────────────────────────────────────────
# 1. 파일 분류
# ─────────────────────────────────────────────────────────────

def is_edge_file(name: str) -> bool:
    """
    엣지 파일 인식 규칙:
    파일명에 _e / -e / _edge / -edge 패턴이 포함된 경우 엣지 파일로 인식.

    예: door_l_prt.stp      → 보드
        door_l_e_prt.stp    → 엣지 (_e_ 중간)
        door_l_prt_e.stp    → 엣지 (_e 끝)
        door_l_prt-edge.stp → 엣지 (-edge 끝)

    # EDIT: 파일명 패턴이 달라지면 이 함수만 수정
    """
    stem = re.sub(r'\.stp$', '', name, flags=re.IGNORECASE).upper()
    return bool(re.search(r'[_\-](E|EDGE)([_\-]|$)', stem))


def is_asm_file(name: str) -> bool:
    """ASSY 파일 → 무시"""
    stem = name.upper()
    return 'ASSY' in stem or 'ASM' in stem


# EDIT: 하드웨어 키워드 목록 수정 시 이 상수만 변경
HARDWARE_KEYWORDS = [
    'SCREW', 'RASTEX', 'RAFIX', 'HETTICH', 'SPRING', 'WASHER',
    'FLAT-SYSTEM', 'DABO', 'STICKER', 'QC', 'CAUTION', 'STRUT',
    'BRK', 'GLIDE', 'LEVELER', 'HINGE', 'SALICE', 'BAPGX',
    'MULTISOCKET', 'TORX', 'BRACKET', 'RUBBERPAD',
    'ELECTRODE', 'PCB', 'USB', 'LED',
]

def is_hardware(name: str) -> bool:
    """철물/부자재 파일 여부 (BOM 파싱 시 제외 대상)

    # EDIT: 하드웨어 치수 패턴 변경 시 이 함수
    판재 치수(예: 1200x590)와 나사 규격(예: 4X45, 6P5X8P5)을 구분:
    - 나사: 첫 번째 숫자가 1~2자리 (직경 4~12mm 등)
    - 패널: 첫 번째 숫자가 3자리 이상 → 하드웨어 아님
    """
    nu = name.upper()
    if re.search(r'\b\d{1,2}[X]\d+\b|\dP\d+', nu):
        return True  # 4X45, 6P5X8P5 등 나사 규격 표기
    return any(h in nu for h in HARDWARE_KEYWORDS)


def _is_felt_board(content: str, part_no: str) -> bool:
    """펠트/FBFP 계열 비목재 자재 판별 — 파싱 결과에서 제외 대상."""
    if part_no and part_no.upper().startswith('FBFP'):
        return True
    mat = _get_desc(content, 'MATERIAL') or ''
    mat_dec = decode_step_unicode(mat).lower()
    if 'felt' in mat_dec or '펠트' in mat_dec:
        return True
    return False


# ─────────────────────────────────────────────────────────────
# 2. 치수 추출
# ─────────────────────────────────────────────────────────────

def extract_dims_from_stp(content: str, t_hint: float = None) -> tuple:
    """
    STP 파일 텍스트에서 W, D, T 계산.

    VERTEX_POINT 기반 BB 우선 (어셈블리 배치 좌표 아티팩트 제거).
    VERTEX_POINT 가 4개 미만이면 모든 CARTESIAN_POINT 로 폴백.

    t_hint 가 있으면 T-first: BB 세 축 중 t_hint 에 가장 가까운 축을 T 로 지정,
    나머지 두 축에서 W(큰 쪽), D(작은 쪽) 결정.
    t_hint 가 없으면 내림차순 정렬 → W >= D >= T.

    Returns:
        (w, d, t_raw, t_axis)  — t_axis: 0=X, 1=Y, 2=Z
    """
    # ── 1. VERTEX_POINT 기반 좌표로 기준 범위 설정 (배치 아티팩트 제거) ──
    entity_map = _build_entity_map(content)

    vp_cp_ids: set[int] = set()
    for val in entity_map.values():
        if not val.upper().startswith('VERTEX_POINT'):
            continue
        m = re.match(r"VERTEX_POINT\s*\([^,]*,\s*#(\d+)", val, re.IGNORECASE)
        if m:
            vp_cp_ids.add(int(m.group(1)))

    vp_xs, vp_ys, vp_zs = [], [], []
    for cpid in vp_cp_ids:
        val = entity_map.get(cpid, '')
        m = re.match(r"CARTESIAN_POINT\s*\([^,]*,\s*\(([^)]+)\)", val, re.IGNORECASE)
        if m:
            p = m.group(1).split(',')
            if len(p) >= 3:
                try:
                    vp_xs.append(float(p[0]))
                    vp_ys.append(float(p[1]))
                    vp_zs.append(float(p[2]))
                except ValueError:
                    pass

    # ── 2. 전체 CARTESIAN_POINT 를 VP 범위 +20mm 내로 필터링 ─────────
    # VP 범위 안팎 최대 20mm 까지는 실제 형상(필렛·홈 등) 으로 허용,
    # 그 이상은 어셈블리 배치 좌표(아티팩트)로 제거
    if len(vp_xs) >= 4:
        margin = 20.0
        x_lo, x_hi = min(vp_xs) - margin, max(vp_xs) + margin
        y_lo, y_hi = min(vp_ys) - margin, max(vp_ys) + margin
        z_lo, z_hi = min(vp_zs) - margin, max(vp_zs) + margin
        xs, ys, zs = [], [], []
        for c in re.findall(r"CARTESIAN_POINT\s*\([^,]*,\s*\(([^)]+)\)\s*\)", content):
            p = c.split(",")
            if len(p) >= 3:
                try:
                    x, y, z = float(p[0]), float(p[1]), float(p[2])
                    if x_lo <= x <= x_hi and y_lo <= y <= y_hi and z_lo <= z <= z_hi:
                        xs.append(x); ys.append(y); zs.append(z)
                except ValueError:
                    pass
    else:
        xs, ys, zs = [], [], []
        for c in re.findall(r"CARTESIAN_POINT\s*\([^,]*,\s*\(([^)]+)\)\s*\)", content):
            p = c.split(",")
            if len(p) >= 3:
                try:
                    xs.append(float(p[0]))
                    ys.append(float(p[1]))
                    zs.append(float(p[2]))
                except ValueError:
                    pass

    if not xs:
        return 0.0, 0.0, 0.0, 2

    rx = round(max(xs) - min(xs), 2)
    ry = round(max(ys) - min(ys), 2)
    rz = round(max(zs) - min(zs), 2)
    axis_ranges = [(rx, 0), (ry, 1), (rz, 2)]

    if t_hint is not None and t_hint > 0:
        t_tup = min(axis_ranges, key=lambda a: abs(a[0] - t_hint))
        t_axis = t_tup[1]
        raw_t = t_tup[0]
        rest = sorted([a for a in axis_ranges if a[1] != t_axis], reverse=True)
        w, d = rest[0][0], rest[1][0]
    else:
        sorted_ax = sorted(axis_ranges, key=lambda a: a[0], reverse=True)
        w, d, raw_t = sorted_ax[0][0], sorted_ax[1][0], sorted_ax[2][0]
        t_axis = sorted_ax[2][1]

    return w, d, raw_t, t_axis


def extract_dims(stp_path: str) -> dict:
    """
    경로 기반 치수 추출 래퍼 — analyze_edge 등 내부 호출용.

    Returns:
        {"W": float, "D": float, "T": float}
    """
    with open(stp_path, encoding="utf-8", errors="ignore") as f:
        content = f.read()
    w, d, t, _ = extract_dims_from_stp(content)
    return {"W": w, "D": d, "T": t}


def _extract_edge_thickness(edge_content: str) -> float:
    """
    엣지 파일에서 엣지 두께를 추출.
    우선순위: EDGE_THICKNESS 디스크립터 → MATERIAL 'Nt ABS' 패턴 → 기본값 1.0
    유효값: 1.0 또는 2.0 만 허용.

    # EDIT: 엣지 두께 추출 규칙 변경 시 이 함수
    """
    # 1. EDGE_THICKNESS 디스크립터
    et_raw = _get_desc(edge_content, 'EDGE_THICKNESS')
    if et_raw:
        try:
            t = float(et_raw)
            return 2.0 if t >= 1.5 else 1.0
        except ValueError:
            pass

    # 2. MATERIAL 문자열 "Nt ABS" 패턴 (예: "2t ABS", "1t ABS봉")
    mat_raw = _get_desc(edge_content, 'MATERIAL') or ''
    mat_dec = decode_step_unicode(mat_raw)
    m = re.search(r'(\d+(?:\.\d+)?)\s*t\s+ABS', mat_dec, re.IGNORECASE)
    if m:
        t = float(m.group(1))
        return 2.0 if t >= 1.5 else 1.0

    # 3. 기본값
    return 1.0


def analyze_edge(board_dims: dict, edge_dims: dict, edge_content: str = "", edge_t: float = 1.0) -> dict:
    """
    엣지 면수 분석.
    우선순위: EDGE_EA / EDGE_COUNT 디스크립터 → 바운딩박스 비교 fallback.
    엣지 두께는 edge_t 파라미터 직접 사용.

    Args:
        board_dims:   {"W":..., "D":..., "T":...}
        edge_dims:    {"W":..., "D":..., "T":...}
        edge_content: 엣지 STP 파일 텍스트 (EDGE_EA 디스크립터 탐색용)
        edge_t:       _extract_edge_thickness() 로 계산된 실제 엣지 두께

    Returns:
        {
            "face_count": int,        # 1 / 2 / 3 / 4
            "face_label": str,        # "1면" / "2면" / "3면" / "4면"
            "edge_T": float,          # 1.0 or 2.0
            "edge_length": str,       # "W+D+W+D" 형식
            "faces": list[str],       # ["top","bottom","left","right"]
        }

    # EDIT: 엣지 면수 판별 임계값 변경 시 이 함수
    """
    bW, bD = board_dims["W"], board_dims["D"]

    def _build_result(n: int) -> dict:
        _faces = ["top", "bottom", "left", "right"]
        _labels = {1: "1면", 2: "2면", 3: "3면", 4: "4면"}
        if n == 4:
            length = f"{bW}+{bD}+{bW}+{bD}"
        elif n == 3:
            length = f"{bW}+{bD}+{bW}"
        elif n == 2:
            length = f"{bW}+{bW}"
        else:
            length = str(bW)
        return {
            "face_count": n,
            "face_label": _labels.get(n, f"{n}면"),
            "edge_T":     edge_t,
            "edge_length": length,
            "faces":      _faces[:n],
        }

    # 1. EDGE_EA / EDGE_COUNT 디스크립터 우선
    if edge_content:
        for key in ('EDGE_EA', 'EDGE_COUNT'):
            raw = _get_desc(edge_content, key)
            if raw:
                try:
                    n = int(float(raw))
                    if 1 <= n <= 6:
                        return _build_result(n)
                except ValueError:
                    pass

    # 2. 바운딩박스 비교 fallback (T 제외 — 언롤드 엣지 파일의 T는 신뢰 불가)
    diff_W = round(edge_dims["W"] - bW, 1)
    diff_D = round(edge_dims["D"] - bD, 1)

    fb = len(re.findall(r'FACE_OUTER_BOUND\s*\(', edge_content, re.IGNORECASE)) if edge_content else 0

    if diff_W <= 0.3 and diff_D <= 0.3:
        # 0-diff: edge VP ≈ board VP. FACE_OUTER_BOUND count heuristic.
        if fb >= 28:
            return _build_result(4)
        if fb >= 12:
            return _build_result(2)
        return _build_result(1)

    # diff/edge_T 로 각 축 면수 계산
    edge_t_safe = max(edge_t, 0.5)
    n_W = min(2, round(max(diff_W, 0) / edge_t_safe)) if diff_W > 0.3 else 0
    n_D = min(2, round(max(diff_D, 0) / edge_t_safe)) if diff_D > 0.3 else 0
    total = max(1, min(4, n_W + n_D))

    # Small-diff override: formula yields ≤1 but FACEBOUND suggests more faces
    # (e.g. shelf panels with 3-face edge where only 1mm expansion is visible in BB)
    if total <= 1 and fb >= 28:
        total = 3

    return _build_result(total)


# ─────────────────────────────────────────────────────────────
# 3. 보링 분석
# ─────────────────────────────────────────────────────────────

def _build_entity_map(content: str) -> dict:
    """STP 파일의 #N=VALUE; 엔티티 인덱스 빌드."""
    entity_map: dict[int, str] = {}
    for m in re.finditer(r'#(\d+)\s*=\s*((?:[^;]|\n)*?);', content):
        entity_map[int(m.group(1))] = m.group(2).strip()
    return entity_map


def _resolve_to_point(ref_id: int, entity_map: dict, depth: int = 0) -> Optional[tuple]:
    """#ref_id 를 재귀적으로 따라가 CARTESIAN_POINT 좌표 반환. 최대 5단계."""
    if depth > 5:
        return None
    val = entity_map.get(ref_id)
    if not val:
        return None

    # CARTESIAN_POINT('', (x,y,z))
    m = re.match(r"CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)", val, re.IGNORECASE)
    if m:
        parts = m.group(1).split(',')
        try:
            return (float(parts[0]), float(parts[1]), float(parts[2]))
        except (ValueError, IndexError):
            return None

    # AXIS2_PLACEMENT_3D / AXIS1_PLACEMENT → 첫 번째 #ref 따라가기
    m = re.match(r"AXIS[12]_PLACEMENT(?:_3D)?\s*\(\s*'[^']*'\s*,\s*#(\d+)", val, re.IGNORECASE)
    if m:
        return _resolve_to_point(int(m.group(1)), entity_map, depth + 1)

    return None


def _circles_deduped(content: str, r_min: float, r_max: float, entity_map: dict, tol: float = 1.0) -> int:
    """3D 좌표 기준 중복 제거 (레거시 — analyze_holes 에서는 미사용)."""
    pattern = re.compile(
        r"CIRCLE\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*([\d.E+\-]+)\s*\)",
        re.IGNORECASE,
    )
    unique_pts: list[tuple] = []
    no_coord_count = 0
    for m in pattern.finditer(content):
        try:
            r = float(m.group(2))
            if not (r_min <= r <= r_max):
                continue
            loc = _resolve_to_point(int(m.group(1)), entity_map)
            if loc is None:
                no_coord_count += 1
                continue
            is_dup = any(
                abs(loc[0] - q[0]) <= tol and
                abs(loc[1] - q[1]) <= tol and
                abs(loc[2] - q[2]) <= tol
                for q in unique_pts
            )
            if not is_dup:
                unique_pts.append(loc)
        except (ValueError, IndexError):
            pass
    return len(unique_pts) + no_coord_count // 2


def _get_circles_with_coords(content: str, r_min: float, r_max: float, entity_map: dict) -> list:
    """반지름 r_min~r_max 범위 CIRCLE 엔티티를 (radius, (x,y,z)) 리스트로 반환."""
    pattern = re.compile(
        r"CIRCLE\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*([\d.E+\-]+)\s*\)",
        re.IGNORECASE,
    )
    results = []
    for m in pattern.finditer(content):
        try:
            r = float(m.group(2))
            if not (r_min <= r <= r_max):
                continue
            loc = _resolve_to_point(int(m.group(1)), entity_map)
            results.append((round(r, 3), loc))
        except (ValueError, IndexError):
            pass
    return results


def _dedup_xy(circles: list, tol: float = 2.0) -> list:
    """
    (radius, point) 리스트를 XY 평면 기준으로 중복 제거.
    Z 축은 무시 — 동일 위치를 위/아래 면에서 각각 모델링한 CIRCLE 을 하나로 합침.
    반환: [{'xy': (x,y), 'r': set(radii)}, ...]
    """
    groups: list[dict] = []
    for r, pt in circles:
        if pt is None:
            continue
        px, py = pt[0], pt[1]
        found = False
        for g in groups:
            gx, gy = g['xy']
            if abs(px - gx) <= tol and abs(py - gy) <= tol:
                g['r'].add(round(r, 2))
                found = True
                break
        if not found:
            groups.append({'xy': (px, py), 'r': {round(r, 2)}})
    return groups


def _dedup_perp(circles: list, t_axis: int, tol: float = 2.0) -> list:
    """
    (radius, point) 리스트를 T 수직 평면 기준으로 중복 제거.
    t_axis=0(T=X): YZ 평면 → (Y,Z)
    t_axis=1(T=Y): XZ 평면 → (X,Z)
    t_axis=2(T=Z): XY 평면 → (X,Y)  ← _dedup_xy 와 동일
    반환: [{'p': (a,b), 'r': set(radii)}, ...]
    """
    groups: list[dict] = []
    for r, pt in circles:
        if pt is None:
            continue
        if t_axis == 0:
            p1, p2 = pt[1], pt[2]
        elif t_axis == 1:
            p1, p2 = pt[0], pt[2]
        else:
            p1, p2 = pt[0], pt[1]
        found = False
        for g in groups:
            g1, g2 = g['p']
            if abs(p1 - g1) <= tol and abs(p2 - g2) <= tol:
                g['r'].add(round(r, 2))
                found = True
                break
        if not found:
            groups.append({'p': (p1, p2), 'r': {round(r, 2)}})
    return groups


def analyze_holes(content: str, T_val: float, t_axis: int = 2) -> tuple[int, int]:
    """
    STP 파일 텍스트에서 보링 개수 추출.

    우선순위:
      1. HOLE_COUNT / BORING 디스크립터
      2. CIRCLE r=2~8mm 를 2D XY 중복제거 (Z 무시, tol=2mm)
         h1 = 총 고유 위치 수
         h2 = 같은 XY에 소(r<4.5mm) + 대(r≥4.5mm) 원이 함께 있는 위치 수
              (2단보링 = 2단계 드릴 가공)
    최대 200개 cap.

    # EDIT: 반지름 범위 또는 cap 변경 시 이 함수
    """
    # 1. HOLE_COUNT / BORING 디스크립터
    for key in ('HOLE_COUNT', 'BORING'):
        val = _get_desc(content, key)
        if val:
            try:
                h1 = min(int(float(val)), 200)
                h2_desc = _get_desc(content, 'HOLE2_COUNT')
                h2 = min(int(float(h2_desc)), 200) if h2_desc else 0
                return h1, h2
            except ValueError:
                pass

    # 2. 보링 홀 원 추출 (r=1.5~7.5mm)
    emap = _build_entity_map(content)
    circles = _get_circles_with_coords(content, 1.5, 7.5, emap)

    # h1: XY 기준 중복 제거 (T=Z 패널 기준이지만 전체 적용)
    groups_xy = _dedup_xy(circles, tol=2.0)
    h1 = min(len(groups_xy), 200)

    # h2: T 수직면 기준 중복 제거 → 소(r<4.5) + 대(r≥4.5) 공존 위치 = 2단보링
    # T=Y/X 패널에서 양면 모델링된 원을 같은 그룹으로 묶어 정확히 검출
    groups_perp = _dedup_perp(circles, t_axis, tol=2.0)
    h2 = sum(
        1 for g in groups_perp
        if any(r < 4.5 for r in g['r']) and any(r >= 4.5 for r in g['r'])
    )

    h2 = min(h2, 200)
    return h1, h2


# ─────────────────────────────────────────────────────────────
# 4. 단일 STP 파싱 (parse_stp_zip 의 단위 처리)
# ─────────────────────────────────────────────────────────────

def _get_desc(content: str, key: str) -> Optional[str]:
    """DESCRIPTIVE_REPRESENTATION_ITEM('KEY','value') 에서 value 추출."""
    m = re.search(
        r"DESCRIPTIVE_REPRESENTATION_ITEM\s*\(\s*'"
        + re.escape(key)
        + r"'\s*,\s*'([^']*)'\s*\)",
        content,
        re.IGNORECASE,
    )
    return m.group(1).strip() if m else None


def _parse_material_str(s: str) -> dict:
    """
    '18.5t PB + LPM/O' → {'thickness': 18.5, 'base_material': 'PB', 'surface': 'LPM/O'}
    소수점 포함 두께 파싱. 파싱 실패 시 빈 dict 반환.
    """
    if not s or s.strip() in ("", "-"):
        return {}
    m = re.match(r"(\d+(?:\.\d+)?)t\s+(\w+)\s*\+\s*(.+)", s.strip(), re.IGNORECASE)
    if m:
        return {
            "thickness":     float(m.group(1)),   # float 유지 (18.5T 지원)
            "base_material": m.group(2).upper(),
            "surface":       m.group(3).strip(),
        }
    return {}


def _extract_part_name(content: str) -> tuple[str, str]:
    """
    STP 내용에서 (자재명, 단품코드) 추출.

    PART_NAME 형식: '{ITEM_CODE} {한글/자연어 명}'
      예) 'DSCCAB1207 1200 \\X2\\D558BD80\\X0\\ ...' → ('1200 하부 뒤판 패널', 'DSCCAB1207')

    우선순위:
      1. PART_NAME — X2 디코딩 후 ITEM_NAME 접두사 제거
      2. NAME / DESCRIPTION 디스크립터 (단품코드 형식이 아닌 것)
      3. PRODUCT 첫 번째 인수 (자연어인 경우)
      4. 빈 문자열 (파일명 stem 으로 폴백은 호출자에서)

    Returns:
        (name: str, part_code: str)
    """
    item_code = (_get_desc(content, 'ITEM_NAME') or '').strip()

    # 1. PART_NAME 디코딩
    part_name_raw = _get_desc(content, 'PART_NAME') or ''
    if part_name_raw:
        decoded = decode_step_unicode(part_name_raw).strip()
        # ITEM_CODE 접두사 제거 (정확 일치)
        if item_code and decoded.upper().startswith(item_code.upper()):
            decoded = decoded[len(item_code):].strip()
        else:
            # ITEM_CODE가 여러 개이거나 와일드카드 코드일 경우:
            # 첫 번째 공백-구분 토큰이 단품코드 형식이면 제거
            decoded = re.sub(r'^[A-Z0-9\-]{5,15}\s+', '', decoded, flags=re.IGNORECASE)
        if decoded and not _is_part_code(decoded):
            return decoded, item_code

    # 2. NAME / DESCRIPTION 디스크립터
    for key in ('NAME', 'DESCRIPTION'):
        val = _get_desc(content, key) or ''
        val = decode_step_unicode(val).strip()
        if val and val not in ('-', '') and not _is_part_code(val):
            return val, item_code

    # 3. PRODUCT 첫 번째 인수
    prod_m = re.search(
        r"PRODUCT\s*\(\s*'([^']*)'\s*,\s*'([^']*)'",
        content, re.IGNORECASE,
    )
    if prod_m:
        prod_name = decode_step_unicode(prod_m.group(2)).strip()
        if prod_name and not _is_part_code(prod_name):
            return prod_name, item_code

    return '', item_code


def parse_stp_file(
    stp_path: str,
    edge_path: Optional[str] = None,
    part_name: str = "",
) -> dict:
    """
    STP 파일 하나를 파싱해 클라이언트·_norm() 공통 포맷으로 반환.

    처리 순서:
      1. 파일을 한 번만 읽어 content 확보
      2. DESCRIPTIVE_REPRESENTATION_ITEM 에서 메타 정보 추출
         - PART_NAME X2 디코딩 → 자재명 / 단품코드 분리
         - MATERIAL → 두께(소수점 포함)·소재·표면
         - THICKNESS 디스크립터 (MATERIAL보다 우선)
         - COLOR
      3. extract_dims_from_stp(content) 로 w/d/t 계산
         세 축 범위 내림차순 정렬 → W >= D >= T
         → MATERIAL 또는 THICKNESS 명시값이 있으면 t 를 덮어씀
      4. 엣지 페어가 있으면 엣지 파일도 읽어 face_count / edge_T 추출
         EDGE_EA 디스크립터 우선, 없으면 바운딩박스 비교
      5. analyze_holes(board_content, t) 로 보링 카운트 (엣지 파일 분리)
      6. 펠트/FBFP 비목재 → is_wood=False 마킹

    반환 키 (buildRows / _norm 양쪽에서 인식):
        stpFile, file, name, partNo, source,
        w, d, t, holeCount, hole2Count, edgeCount, edgeT,
        material, surface, color, is_wood
    """
    basename = os.path.basename(stp_path)
    stem = re.sub(r'\.(stp|step)$', '', basename, flags=re.IGNORECASE)

    # ── 1. 파일 읽기 ─────────────────────────────────────────────
    with open(stp_path, encoding="utf-8", errors="ignore") as f:
        content = f.read()

    # ── 2. 메타 정보 추출 ────────────────────────────────────────
    # 자재명 / 단품코드
    detected_name, part_code = _extract_part_name(content)

    # MATERIAL → 두께 / 소재 / 표면 (소수점 포함)
    desc_material = _get_desc(content, "MATERIAL") or ""
    mat_info = _parse_material_str(decode_step_unicode(desc_material))

    # THICKNESS 디스크립터 (MATERIAL보다 우선)
    desc_thickness = _get_desc(content, "THICKNESS")
    explicit_t: Optional[float] = None
    if desc_thickness:
        try:
            explicit_t = float(desc_thickness)
        except ValueError:
            pass
    if explicit_t is None and mat_info.get("thickness"):
        explicit_t = float(mat_info["thickness"])

    # COLOR
    desc_color = _get_desc(content, "COLOR") or "WW"
    if desc_color in ('-', ''):
        desc_color = "WW"

    # ── 3. 치수 추출 ─────────────────────────────────────────────
    # T-first: MATERIAL/THICKNESS 명시 두께를 힌트로 T 축 먼저 찾기
    t_hint = explicit_t if explicit_t is not None else (
        float(mat_info["thickness"]) if mat_info.get("thickness") else None
    )
    w, d, raw_t, t_axis = extract_dims_from_stp(content, t_hint=t_hint)

    # T 우선순위: THICKNESS/MATERIAL 명시값 → snap → raw_t
    if explicit_t is not None:
        t = _snap_thickness(explicit_t) or explicit_t
    else:
        snapped = _snap_thickness(raw_t)
        if snapped is not None:
            t = snapped
        elif mat_info.get("thickness"):
            # 바운딩박스 스냅 실패 → MATERIAL 두께로 재시도
            t_mat = float(mat_info["thickness"])
            t = _snap_thickness(t_mat) or t_mat
        else:
            t = raw_t

    # ── 4. 엣지 분석 ─────────────────────────────────────────────
    edge_count = 0
    edge_t_val = 0.0
    if edge_path:
        try:
            with open(edge_path, encoding="utf-8", errors="ignore") as f:
                edge_content = f.read()
            ew, ed, et_raw, _ = extract_dims_from_stp(edge_content)
            edge_t_val = _extract_edge_thickness(edge_content)

            # W/D: 엣지파일이 완성 치수를 담고 있을 때만 사용 (board 대비 ±15% 이내)
            w_final = ew if (w > 0 and 0.95 <= ew / w <= 1.15) else w
            d_final = ed if (d > 0 and 0.95 <= ed / d <= 1.15) else d

            board_dims = {"W": w, "D": d, "T": t}       # 원본 board 치수
            edge_dims  = {"W": ew, "D": ed, "T": et_raw}
            edge_info  = analyze_edge(board_dims, edge_dims,
                                      edge_content=edge_content, edge_t=edge_t_val)
            edge_count = edge_info.get("face_count", 0)

            # 엣지파일 기반 완성 W/D 적용
            w, d = w_final, d_final
        except Exception:
            pass

    # ── 5. 보링 분석 (보드 파일만, 엣지 제외) ────────────────────
    h1, h2 = analyze_holes(content, t, t_axis)

    # ── 6. 펠트/비목재 판별 ──────────────────────────────────────
    is_wood = not _is_felt_board(content, part_code)

    # 이름 우선순위: 호출자 인수 > STP 내 자연어명 > 파일명 stem
    name_out = part_name or detected_name or stem

    return {
        # 파일 식별
        "stpFile":    basename,
        "file":       basename,        # 하위호환
        # 기본 정보
        "name":       name_out,
        "partNo":     part_code,       # ITEM_NAME (예: DSCCAB1207)
        "source":     "stp",
        "is_wood":    is_wood,
        # 치수
        "w":          w,
        "d":          d,
        "t":          t,
        # 보링
        "holeCount":  h1,
        "hole2Count": h2,
        # 엣지
        "edgeCount":  edge_count,
        "edgeT":      edge_t_val,
        # 소재
        "material":   mat_info.get("base_material", "PB"),
        "surface":    mat_info.get("surface", "LPM/O"),
        "color":      desc_color,
    }


# ─────────────────────────────────────────────────────────────
# 5. BOM 파싱
# ─────────────────────────────────────────────────────────────

def parse_bom(content: str) -> dict:
    """
    Creo BOM (.bom.3) 파일 파싱.
    Sub-Assembly 블록별로 파트명 매핑 반환.

    Returns:
        {
            "ASSY_NAME": {
                "board": "파일명",
                "edge":  "파일명",
                "board_pname": "한글 파트명",
                "asm_parts": [{"name": str, "qty": int}, ...]
            }
        }

    # EDIT: BOM 파일 포맷이 바뀌면 이 함수
    """
    bom_info = {}
    blocks = re.split(r'={3,}', content)

    for block in blocks:
        assy_m = re.search(r'Sub-Assembly\s+([\w\-]+)\s+contains', block)
        if not assy_m:
            continue
        assy = assy_m.group(1)
        board_n = edge_n = board_pname = None
        asm_parts = []

        for line in block.splitlines():
            line = line.strip()
            m = re.match(r'^(\S+)\s+(Part|Sub-Assembly)\s+(.+?)\s+(\d+)\s*$', line)
            if not m:
                continue
            fname, ptype, pname, qty = m.group(1), m.group(2), m.group(3).strip(), int(m.group(4))

            if '패널' in pname:
                board_n = fname
                board_pname = pname
            elif '엣지' in pname:
                edge_n = fname
            elif is_edge_file(fname):
                pass
            elif is_hardware(fname):
                pass
            elif 'CASING' in fname.upper() or 'NAMEPLATE' in fname.upper():
                asm_parts.append({"name": fname, "qty": qty})
            else:
                asm_parts.append({"name": fname, "qty": qty})

        if board_n:
            bom_info[assy] = {
                "board": board_n,
                "edge": edge_n,
                "board_pname": re.sub(r'\s*패널.*', '', board_pname or ''),
                "asm_parts": asm_parts,
            }

    return bom_info


# ─────────────────────────────────────────────────────────────
# 6. ZIP 전체 파싱 (메인 진입점)
# ─────────────────────────────────────────────────────────────

def parse_stp_zip(zip_bytes: bytes, bom_content: Optional[str] = None) -> list[dict]:
    """
    ZIP 바이트를 받아 내부 STP 파일을 전부 추출·파싱 후 자재 목록 반환.
    is_wood=False 인 펠트/비목재 자재는 결과에서 제외.

    흐름:
      1. zipfile 모듈로 ZIP을 열어 임시 폴더에 압축 해제
      2. 모든 .stp 파일을 재귀 탐색
      3. 어셈블리(ASSY/ASM) 및 하드웨어 파일 제외
      4. 보드↔엣지 파일 매핑 (파일명 패턴 기반)
      5. 각 보드 파일마다 parse_stp_file 호출
      6. BOM이 있으면 파트명 오버라이드
      7. 비목재(펠트 등) 제외

    반환 키는 parse_stp_file 과 동일 (buildRows / _norm 공통):
        stpFile, file, name, partNo, source, w, d, t,
        holeCount, hole2Count, edgeCount, edgeT, is_wood
    """
    bom_info = parse_bom(bom_content) if bom_content else {}

    with tempfile.TemporaryDirectory() as tmpdir:
        # ── 1. ZIP 압축 해제 ──────────────────────────────────────────
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(tmpdir)

        # ── 2. .stp 파일 전체 수집 (대소문자 무관) ─────────────────────
        root = Path(tmpdir)
        all_stp = [
            f for f in root.rglob("*")
            if f.is_file() and f.suffix.lower() in (".stp", ".step")
        ]

        # ── 3. 보드 / 엣지 분류 ──────────────────────────────────────
        board_files: dict[str, str] = {}   # 파일명(원본) → 절대경로
        edge_files:  dict[str, str] = {}

        for f in all_stp:
            name = f.name
            if is_asm_file(name):
                continue
            if is_hardware(name):
                continue
            if is_edge_file(name):
                edge_files[name] = str(f)
            else:
                board_files[name] = str(f)

        # ── 4. 보드↔엣지 매핑 + 5. parse_stp_file 호출 ───────────────
        results: list[dict] = []
        for bname, bpath in board_files.items():
            try:
                stem = re.sub(r'\.(stp|step)$', '', bname, flags=re.IGNORECASE)

                # 엣지 페어 탐색 (보드 stem 이 엣지명에 포함되거나 _E 제거 후 일치)
                epath = None
                for ek, ep in edge_files.items():
                    ek_stem = re.sub(r'\.(stp|step)$', '', ek, flags=re.IGNORECASE)
                    board_up = stem.upper()
                    edge_up  = ek_stem.upper()
                    if (board_up in edge_up
                            or edge_up.replace('_E', '').replace('-E', '') == board_up):
                        epath = ep
                        break

                # BOM 파트명 조회
                part_name = ''
                for assy_data in bom_info.values():
                    if assy_data.get('board', '').upper() == bname.upper():
                        part_name = assy_data.get('board_pname', '')
                        break

                # 단일 파일 파싱
                result = parse_stp_file(bpath, edge_path=epath, part_name=part_name)

                # 비목재(펠트 등) 제외
                if not result.get("is_wood", True):
                    continue

                results.append(result)

            except Exception as e:
                print(f"[WARN] {bname} 파싱 실패: {e}")
                results.append({
                    "stpFile":    bname,
                    "file":       bname,
                    "name":       re.sub(r'\.(stp|step)$', '', bname, flags=re.IGNORECASE),
                    "partNo":     "",
                    "source":     "stp",
                    "is_wood":    True,
                    "w": 0.0, "d": 0.0, "t": 0.0,
                    "holeCount": 0, "hole2Count": 0,
                    "edgeCount": 0, "edgeT": 0.0,
                    "error":      str(e),
                })

    return results
