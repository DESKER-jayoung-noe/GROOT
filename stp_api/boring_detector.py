"""
DESKER 목재 견적 — 보링/루터 자동 감지 모듈
==============================================

V2 알고리즘 (정확도 85% 검증됨)

1. 모든 cylindrical face 추출
2. 같은 (x,y,z,r,axis) → 동일 홀로 그루핑 (반쪽 face 2개 합치기)
3. R > 30mm 필터 (필렛/곡면 컷아웃 제외)
4. 루터 감지: R≥6mm + 4코너 사각형 + 관통 → 루터 슬롯
5. 나머지 보링 분류:
   - 깊이 < 2.5mm → 2단 보링 (얕은 카운터싱크)
   - 깊이 ≥ 2.5mm → 일반 보링

검증 데이터: 데스커 DD13R 멀티책상세트 20개 부품
정확도: 17/20 (85%)
누락 케이스:
  - 측판 L/R: STP에 표시 안 된 도면 보링 4개 누락 가능성
  - back_top: 카운터싱크 카운트 기준 차이 (1개)
"""
from build123d import import_step
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE
from OCP.TopoDS import TopoDS
from OCP.BRepBndLib import BRepBndLib
from OCP.Bnd import Bnd_Box
from collections import defaultdict

# 튜닝 파라미터 (실측 기반)
MAX_RADIUS = 30.0          # R>30 = 모서리 라운드/곡면
ROUTER_MIN_RADIUS = 6.0    # R≥6 = 루터 후보 (Ø12+)
ROUTER_MIN_SIZE = 10.0     # 사각형 변 길이 최소 10mm
DEPTH_2DAN = 2.5           # 깊이 < 2.5mm = 2단 보링
THROUGH_TOLERANCE = 1.0    # 관통 판정 허용 오차


def _get_cylinder_faces(stp_path: str):
    """STP에서 모든 원통면 추출 (반지름, 위치, 축, 깊이)"""
    shape = import_step(stp_path)
    solid = shape.solid()
    bb = solid.bounding_box()
    T = min(bb.size.X, bb.size.Y, bb.size.Z)  # 자재 두께
    
    ocp_shape = solid.wrapped
    explorer = TopExp_Explorer(ocp_shape, TopAbs_FACE)
    
    cylinders = []
    while explorer.More():
        face = TopoDS.Face_s(explorer.Current())
        surf = BRepAdaptor_Surface(face)
        if surf.GetType() == GeomAbs_Cylinder:
            cyl = surf.Cylinder()
            radius = cyl.Radius()
            if radius <= MAX_RADIUS:
                loc = cyl.Axis().Location()
                d = cyl.Axis().Direction()
                bbox = Bnd_Box()
                BRepBndLib.Add_s(face, bbox)
                xmin, ymin, zmin, xmax, ymax, zmax = bbox.Get()
                if abs(d.Z()) > 0.9:
                    depth, axis = zmax - zmin, "Z"
                elif abs(d.Y()) > 0.9:
                    depth, axis = ymax - ymin, "Y"
                else:
                    depth, axis = xmax - xmin, "X"
                cylinders.append({
                    "r": radius, "x": loc.X(), "y": loc.Y(), "z": loc.Z(),
                    "axis": axis, "depth": depth,
                })
        explorer.Next()
    return cylinders, T


def _group_holes(cylinders):
    """반쪽 face 2개를 1개 홀로 합침"""
    grouped = defaultdict(list)
    for c in cylinders:
        key = (round(c["x"], 1), round(c["y"], 1), round(c["z"], 1),
               round(c["r"], 2), c["axis"])
        grouped[key].append(c)
    
    holes = []
    for key, faces in grouped.items():
        x, y, z, r, axis = key
        depth = max(f["depth"] for f in faces)
        holes.append({"x": x, "y": y, "z": z, "r": r, "axis": axis, "depth": depth})
    return holes


def _detect_routers(holes, T):
    """
    루터 감지: R≥6 + 4코너 사각형 + 관통
    Returns: (router_index_set, router_slots)
    """
    router_indices = set()
    router_slots = []
    
    by_plane = defaultdict(list)
    for i, h in enumerate(holes):
        if h["r"] < ROUTER_MIN_RADIUS:
            continue
        if h["axis"] == "Z":
            plane_key, in_plane = round(h["z"], 1), (h["x"], h["y"])
        elif h["axis"] == "Y":
            plane_key, in_plane = round(h["y"], 1), (h["x"], h["z"])
        else:
            plane_key, in_plane = round(h["x"], 1), (h["y"], h["z"])
        gk = (h["axis"], plane_key, round(h["r"], 2))
        by_plane[gk].append((i, in_plane[0], in_plane[1], h))
    
    for gk, items in by_plane.items():
        if len(items) != 4:
            continue
        us = sorted(set(round(it[1], 1) for it in items))
        vs = sorted(set(round(it[2], 1) for it in items))
        if len(us) != 2 or len(vs) != 2:
            continue
        # 핵심: 모두 관통이어야 루터
        if not all(abs(it[3]["depth"] - T) < THROUGH_TOLERANCE for it in items):
            continue
        width, height = us[1] - us[0], vs[1] - vs[0]
        if width <= ROUTER_MIN_SIZE or height <= ROUTER_MIN_SIZE:
            continue
        for it in items:
            router_indices.add(it[0])
        router_slots.append({
            "axis": gk[0],
            "size": (round(width, 1), round(height, 1)),
            "corner_radius": gk[2],
            "perimeter_mm": round(2 * (width + height), 1),
        })
    return router_indices, router_slots


def analyze_part(stp_path: str) -> dict:
    """
    STP 파일에서 보링/루터 자동 추출
    
    Returns:
        {
            "boring_normal": int,      # 일반 보링 개수
            "boring_2dan": int,        # 2단 보링 개수 (얕은 카운터싱크)
            "router_slots": [          # 사각 루터 슬롯들
                {
                    "axis": "Z",                  # 가공 축
                    "size": (162.0, 36.0),        # mm
                    "corner_radius": 8.0,         # mm
                    "perimeter_mm": 396.0,        # 가공비 계산용 둘레
                },
                ...
            ],
            "thickness_mm": float,     # 자재 두께
            "all_holes": [...],        # 디버그용: 모든 검출된 홀
        }
    """
    cylinders, T = _get_cylinder_faces(stp_path)
    holes = _group_holes(cylinders)
    router_idx, router_slots = _detect_routers(holes, T)
    
    boring_holes = [h for i, h in enumerate(holes) if i not in router_idx]
    n_normal = sum(1 for h in boring_holes if h["depth"] >= DEPTH_2DAN)
    n_2dan = sum(1 for h in boring_holes if h["depth"] < DEPTH_2DAN)
    
    return {
        "boring_normal": n_normal,
        "boring_2dan": n_2dan,
        "router_slots": router_slots,
        "thickness_mm": round(T, 2),
        "all_holes": holes,
    }


if __name__ == "__main__":
    import sys
    import json
    
    if len(sys.argv) < 2:
        print("Usage: python boring_detector.py <file.stp>")
        sys.exit(1)
    
    result = analyze_part(sys.argv[1])
    # all_holes는 디버그용이라 제외하고 출력
    output = {k: v for k, v in result.items() if k != "all_holes"}
    print(json.dumps(output, indent=2, ensure_ascii=False))
