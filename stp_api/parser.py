"""
DESKER 목재 견적 계산기 — STP 파싱 모듈
==========================================
위치: stp_api/parser.py

⚠️  이 파일은 STP 파싱 핵심 로직입니다.
    커서(AI)가 임의로 수정하지 마세요.
    수정이 필요할 때는 # EDIT: 주석이 달린 구간만 변경하세요.
"""

import re
import zipfile
import tempfile
import os
from pathlib import Path
from typing import Optional

# build123d / OCP 의존성
from build123d import import_step
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.TopoDS import TopoDS
from OCP.GeomAbs import GeomAbs_Cylinder


# ─────────────────────────────────────────────────────────────
# 1. 파일 분류
# ─────────────────────────────────────────────────────────────

def is_edge_file(name: str) -> bool:
    """
    엣지 파일 인식 규칙:
    파일명에 _e / -e / _edge / -edge 패턴이 포함된 경우 엣지 파일로 인식.
    panel 제거 후 붙이는 형태도 포함.

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
    """철물/부자재 파일 여부 (BOM 파싱 시 제외 대상)"""
    nu = name.upper()
    if re.search(r'\d+X\d+|\dP\d+', nu):
        return True  # 4X45, 6P5X8P5 등 규격 표기
    return any(h in nu for h in HARDWARE_KEYWORDS)


# ─────────────────────────────────────────────────────────────
# 2. 치수 추출
# ─────────────────────────────────────────────────────────────

def extract_dims(stp_path: str) -> dict:
    """
    STP 파일에서 W / D / T 추출.
    바운딩박스를 오름차순 정렬 → [T, D, W]

    Returns:
        {"W": float, "D": float, "T": float}
    """
    shape = import_step(stp_path)
    bb = shape.bounding_box()
    dims = sorted([
        round(bb.size.X, 1),
        round(bb.size.Y, 1),
        round(bb.size.Z, 1),
    ])
    return {"T": dims[0], "D": dims[1], "W": dims[2]}


def analyze_edge(board_dims: dict, edge_dims: dict) -> dict:
    """
    보드와 엣지 바운딩박스 차이로 엣지 두께·면수 분석.

    Args:
        board_dims: {"T":..., "D":..., "W":...}
        edge_dims:  {"T":..., "D":..., "W":...}

    Returns:
        {
            "face_count": int,        # 1 / 2 / 4
            "face_label": str,        # "1면" / "2면" / "4면"
            "edge_T": float,          # 1.0 or 2.0
            "edge_length": str,       # "1169.0+550.0+..." 형식
            "faces": list[str],       # ["top","bottom","left","right"]
        }

    # EDIT: 엣지 판별 임계값(0.3, 비율 등) 변경 시 이 함수
    """
    b = [board_dims["T"], board_dims["D"], board_dims["W"]]
    e = [edge_dims["T"],  edge_dims["D"],  edge_dims["W"]]
    diff = [round(ev - bv, 1) for ev, bv in zip(e, b)]
    positives = [d for d in diff if d > 0.3]

    bW, bD = board_dims["W"], board_dims["D"]

    if not positives:
        # 엣지 bb < 보드 bb → 1면 추정
        edge_T = round(min(e), 1)
        return {
            "face_count": 1, "face_label": "1면", "edge_T": edge_T,
            "edge_length": str(bW), "faces": ["top"],
        }

    edge_T = round(min(positives) / 2, 1)

    if len(positives) >= 2:
        return {
            "face_count": 4, "face_label": "4면", "edge_T": edge_T,
            "edge_length": f"{bW}+{bD}+{bW}+{bD}",
            "faces": ["top", "bottom", "left", "right"],
        }
    elif diff[2] > 0.3:  # W 방향 (긴 변)
        return {
            "face_count": 2, "face_label": "2면", "edge_T": edge_T,
            "edge_length": f"{bD}+{bD}", "faces": ["left", "right"],
        }
    else:
        return {
            "face_count": 2, "face_label": "2면", "edge_T": edge_T,
            "edge_length": f"{bW}+{bW}", "faces": ["top", "bottom"],
        }


# ─────────────────────────────────────────────────────────────
# 3. 보링 분석
# ─────────────────────────────────────────────────────────────

def analyze_holes(stp_path: str, T_val: float) -> tuple[int, int]:
    """
    STP 파일에서 일반 보링 / 2단 보링 개수 추출.

    Args:
        stp_path: STP 파일 경로
        T_val: 판재 두께 (mm)

    Returns:
        (hole_1st, hole_2nd)  # 원통면 기준 ÷ 2 (상하 양면)

    # EDIT: 보링 반지름 범위(1.5~12.0) 또는 2단 기준(0.35) 변경 시 이 함수
    """
    shape = import_step(stp_path)
    h1 = h2 = 0

    for face in shape.faces():
        try:
            ad = BRepAdaptor_Surface(TopoDS.Face_s(face.wrapped))
            if ad.GetType() != GeomAbs_Cylinder:
                continue
            r = ad.Cylinder().Radius()
            if not (1.5 <= r <= 12.0):
                continue
            fbb = face.bounding_box()
            depth = sorted([fbb.size.X, fbb.size.Y, fbb.size.Z])[1]
            if depth < T_val * 0.35:
                h2 += 1
            else:
                h1 += 1
        except Exception:
            pass

    return h1 // 2, h2 // 2


# ─────────────────────────────────────────────────────────────
# 4. BOM 파싱
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
# 5. ZIP 전체 파싱 (메인 진입점)
# ─────────────────────────────────────────────────────────────

def parse_stp_zip(zip_bytes: bytes, bom_content: Optional[str] = None) -> list[dict]:
    """
    ZIP 파일 바이트를 받아 자재 목록 반환.

    Args:
        zip_bytes:   업로드된 ZIP 바이트
        bom_content: BOM 파일 텍스트 (선택)

    Returns:
        [
            {
                "id": "mat_1",
                "name": "뒷판 A",          # BOM 있을 때 자동
                "W": 1169.0,
                "D": 550.0,
                "T": 15.0,
                "hole_1st": 8,
                "hole_2nd": 4,
                "edge": {
                    "face_count": 4,
                    "face_label": "4면",
                    "edge_T": 1.0,
                    "edge_length": "1169.0+550.0+1169.0+550.0",
                    "faces": ["top","bottom","left","right"],
                },
                "asm_parts": [],
            },
            ...
        ]
    """
    bom_info = parse_bom(bom_content) if bom_content else {}

    with tempfile.TemporaryDirectory() as tmpdir:
        # ZIP 압축 해제
        with zipfile.ZipFile(__import__('io').BytesIO(zip_bytes)) as zf:
            zf.extractall(tmpdir)

        # 파일 분류
        all_files = list(Path(tmpdir).rglob('*.stp')) + list(Path(tmpdir).rglob('*.STP'))
        board_files = {}
        edge_files  = {}

        for f in all_files:
            name = f.name
            if is_asm_file(name):
                continue
            if is_edge_file(name):
                edge_files[name] = str(f)
            else:
                board_files[name] = str(f)

        # 보드↔엣지 매핑
        results = []
        for idx, (bname, bpath) in enumerate(board_files.items()):
            try:
                board_dims = extract_dims(bpath)
                T_val = board_dims["T"]

                # 엣지 파일 찾기: 보드 이름에서 유추
                stem = re.sub(r'\.stp$', '', bname, flags=re.IGNORECASE)
                ename = None
                for ek in edge_files:
                    ek_stem = re.sub(r'\.stp$', '', ek, flags=re.IGNORECASE)
                    # 보드명이 엣지명에 포함되거나 반대
                    if stem.upper() in ek_stem.upper() or ek_stem.upper().replace('_E','').replace('-E','') in stem.upper():
                        ename = ek
                        break

                edge_info = None
                if ename:
                    edge_dims = extract_dims(edge_files[ename])
                    edge_info = analyze_edge(board_dims, edge_dims)

                h1, h2 = analyze_holes(bpath, T_val)

                # BOM에서 이름 가져오기
                part_name = ''
                asm_parts = []
                for assy_data in bom_info.values():
                    if assy_data.get('board','').upper() == bname.upper():
                        part_name = assy_data.get('board_pname','')
                        asm_parts = assy_data.get('asm_parts',[])
                        break

                results.append({
                    "id": f"mat_{idx+1}",
                    "name": part_name or stem,
                    "W": board_dims["W"],
                    "D": board_dims["D"],
                    "T": T_val,
                    "hole_1st": h1,
                    "hole_2nd": h2,
                    "edge": edge_info,
                    "asm_parts": asm_parts,
                })

            except Exception as e:
                # 파싱 실패한 파일은 스킵, 로그만 남김
                print(f"[WARN] {bname} 파싱 실패: {e}")

    return results
