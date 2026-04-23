import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import * as THREE from "three";
import { useTree, getMaterialsForItem } from "../context/TreeContext";
import { computeMaterial, buildMaterialInput } from "../lib/materialCalc";
import type { SheetId } from "../lib/yield";
import type { BomMaterialData } from "../offline/stores";

export type ProductTabHandle = {
  saveDraft: () => Promise<void>;
  save: () => Promise<void>;
  createNew: () => void;
  openLibrary: () => void;
  loadFromVault: (id: string) => Promise<void>;
};

const SHEET_PRICE_BY_T: Partial<Record<number, Partial<Record<string, number>>>> = {
  12: { "4x8": 16720 },
  15: { "4x6": 14450, "4x8": 19060, "6x8": 27320 },
  18: { "4x6": 16620, "4x8": 21510, "6x8": 30650 },
  22: { "4x8": 24680, "6x8": 35610 },
  25: { "4x8": 6640 },
  28: { "4x8": 29620, "6x8": 42600 },
};

function bomPreset(et: string, es: string): "none" | "abs1t" | "abs2t" | "paint" {
  if (et === "ABS") return es === "4면 2T" ? "abs2t" : "abs1t";
  if (et === "도장") return "paint";
  return "none";
}

function calcMatCost(data: BomMaterialData): number {
  if (data.w <= 0 || data.d <= 0 || data.t <= 0) return 0;
  const prices = SHEET_PRICE_BY_T[data.t] ?? {};
  const sp: Partial<Record<SheetId, number>> = {};
  for (const sid of ["4x6", "4x8", "6x8"] as SheetId[]) {
    if (prices[sid] != null) sp[sid] = prices[sid]!;
  }
  const input = buildMaterialInput({
    wMm: data.w, dMm: data.d, hMm: data.t,
    color: data.color, boardMaterial: data.material,
    placementMode: "default",
    edgePreset: bomPreset(data.edgeType, data.edgeSetting),
    edgeCustomSides: data.edgeCustom ?? { top: 0, bottom: 0, left: 0, right: 0 },
    sheetPrices: sp,
    formingM: 0, rutaM: 0, assemblyHours: 0, washM2: 0,
    boring1Ea: 0, boring2Ea: 0, curvedEdgeM: 0, ruta2M: 0, tenonerMm: 0,
  });
  return computeMaterial(input, null).grandTotalWon;
}

function roundup5(v: number) {
  return Math.ceil((v * 0.05) / 100) * 100;
}

type Packed = { bw: number; bd: number; t: number; x: number; y: number; z: number };
type PackedResult = { placed: Packed[]; totalH: number };

function packBoards(boards: { w: number; d: number; t: number }[], boxW: number, boxD: number): PackedResult {
  const sorted = [...boards].sort((a, b) => b.w * b.d - a.w * a.d);
  const layers: { ys: number; slots: { x: number; z: number; w: number; d: number; used: boolean }[]; h: number }[] = [];
  const placed: Packed[] = [];

  for (const b of sorted) {
    let best:
      | { layer: (typeof layers)[number]; slot: (typeof layers)[number]["slots"][number]; bw: number; bd: number; waste: number }
      | null = null;
    for (const layer of layers) {
      for (const slot of layer.slots) {
        if (slot.used) continue;
        for (const [bw, bd] of [[b.w, b.d], [b.d, b.w]]) {
          if (bw <= slot.w && bd <= slot.d) {
            const waste = (slot.w - bw) * (slot.d - bd);
            if (!best || waste < best.waste) best = { layer, slot, bw, bd, waste };
          }
        }
      }
    }
    if (best) {
      const { layer, slot, bw, bd } = best;
      placed.push({ bw, bd, t: b.t, x: slot.x + bw / 2 - boxW / 2, z: slot.z + bd / 2 - boxD / 2, y: layer.ys + b.t / 2 });
      slot.used = true;
      if (slot.w - bw > 10) layer.slots.push({ x: slot.x + bw, z: slot.z, w: slot.w - bw, d: slot.d, used: false });
      if (slot.d - bd > 10) layer.slots.push({ x: slot.x, z: slot.z + bd, w: bw, d: slot.d - bd, used: false });
      if (layer.h < b.t) layer.h = b.t;
    } else {
      const ys = layers.reduce((s, l) => s + l.h, 0);
      const nl = { ys, slots: [{ x: 0, z: 0, w: boxW, d: boxD, used: true }], h: b.t };
      layers.push(nl);
      placed.push({ bw: b.w, bd: b.d, t: b.t, x: b.w / 2 - boxW / 2, z: b.d / 2 - boxD / 2, y: ys + b.t / 2 });
      if (b.w < boxW) nl.slots.push({ x: b.w, z: 0, w: boxW - b.w, d: boxD, used: false });
      if (b.d < boxD) nl.slots.push({ x: 0, z: b.d, w: b.w, d: boxD - b.d, used: false });
    }
  }
  return { placed, totalH: layers.reduce((s, l) => s + l.h, 0) };
}

export const ProductTab = forwardRef<
  ProductTabHandle,
  {
    active?: boolean;
    quoteBindEntityId?: string | null;
    onQuoteMeta?: (meta: { name: string; grandTotalWon: number }) => void;
    onQuoteEntityRebind?: (entityId: string) => void;
    stripRenameEpoch?: number;
  }
>(function ProductTab({ active = true, onQuoteMeta }, ref) {
  const [tab, setTab] = useState<0 | 1 | 2>(0);
  const [hwOn, setHwOn] = useState(true);
  const [hwN, setHwN] = useState(12);
  const [hwBag, setHwBag] = useState(1);
  const [nkVal, setNkVal] = useState<"500" | "1000" | "1500" | "2000">("1000");
  const [, setMsg] = useState<string | null>(null);
  const [packInfo, setPackInfo] = useState({ sizeText: "—", emptyText: "—" });

  const { treeNodes, activeItem } = useTree();
  const materials = useMemo(() => getMaterialsForItem(treeNodes, activeItem), [treeNodes, activeItem]);
  const name = treeNodes[activeItem]?.name ?? "이름 없음";

  // Box dimensions from actual material data
  const boxDims = useMemo(() => {
    const mats = materials.map(m => m.data).filter((d): d is BomMaterialData => !!d);
    if (mats.length === 0) return { bw: 1220, bd: 620, bh: 50 };
    const bw = Math.max(...mats.map(m => m.w)) + 20;
    const bd = Math.max(...mats.map(m => m.d)) + 20;
    const bh = mats.reduce((s, m) => s + m.t, 0) + 30;
    return { bw, bd, bh };
  }, [materials]);

  // Estimated weight: density 0.0007 kg/cm³
  const estWeight = useMemo(() => {
    const mats = materials.map(m => m.data).filter((d): d is BomMaterialData => !!d);
    const kg = mats.reduce((s, m) => s + (m.w / 10) * (m.d / 10) * (m.t / 10) * 0.0007, 0);
    return Math.round(kg * 10) / 10;
  }, [materials]);

  // Per-material costs
  const matCosts = useMemo(
    () => materials.map(m => ({ name: m.name ?? "이름 없음", data: m.data, cost: m.data ? calcMatCost(m.data) : 0 })),
    [materials]
  );
  const matTotal = useMemo(() => matCosts.reduce((s, m) => s + m.cost, 0), [matCosts]);

  // Auto-select packaging based on material count
  const autoNkVal = useMemo((): "500" | "1000" | "1500" | "2000" => {
    const n = materials.length;
    if (n <= 2) return "500";
    if (n <= 5) return "1000";
    if (n <= 8) return "1500";
    return "2000";
  }, [materials.length]);

  useEffect(() => { setNkVal(autoNkVal); }, [autoNkVal]);

  // Boards for 3D packing
  const boardsMemo = useMemo(() => {
    const mats = materials.map(m => m.data).filter((d): d is BomMaterialData => !!d);
    return mats.map(m => ({ w: m.w, d: m.d, t: m.t }));
  }, [materials]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const pivotRef = useRef<THREE.Group | null>(null);

  const calc = useMemo(() => {
    const { bw, bd } = boxDims;
    const wash = Math.round(bw * bd / 1e6 * 2 * 250);
    const tape = Math.round(((bw + 100) + (bd + 100) * 2) / 1000 * 15.42);
    const sticker = 6;
    const hwCost = hwOn ? hwN * 21 : 0;
    const bagCost = hwOn ? hwBag * 1000 : 0;
    const nkCost = Number(nkVal);
    const packSub = wash + hwCost + bagCost + nkCost + tape + sticker;
    const base = matTotal + packSub;
    const overhead = roundup5(base);
    const factory = base + overhead;
    return { hwCost, bagCost, nkCost, packSub, overhead, factory, wash, tape, sticker };
  }, [hwOn, hwN, hwBag, nkVal, boxDims, matTotal]);

  useEffect(() => {
    onQuoteMeta?.({ name, grandTotalWon: calc.factory });
  }, [name, calc.factory, onQuoteMeta]);

  useEffect(() => {
    if (tab !== 1) return;
    const canvas = canvasRef.current;
    const parent = parentRef.current;
    if (!canvas || !parent) return;

    const { bw, bd } = boxDims;
    const boards = boardsMemo.length > 0
      ? boardsMemo
      : [{ w: Math.max(bw - 20, 100), d: Math.max(bd - 20, 100), t: 18 }];
    const packed = packBoards(boards, bw, bd);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xf4f4f4, 1);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(4, 7, 4);
    scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.25);
    dl2.position.set(-3, -2, -3);
    scene.add(dl2);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const pivot = new THREE.Group();
    pivotRef.current = pivot;
    scene.add(pivot);
    const SC = 6 / Math.max(bw, bd, packed.totalH + 20, 100);

    const buildMeshes = (placed: Packed[], totalH: number) => {
      if (!pivotRef.current) return;
      const rm: THREE.Object3D[] = [];
      pivotRef.current.children.forEach((c) => { if (c.userData.b || c.userData.w) rm.push(c); });
      rm.forEach((c: THREE.Object3D) => pivotRef.current?.remove(c));

      const boxH = (totalH + 20) * SC;
      const boxWsc = bw * SC;
      const boxDsc = bd * SC;
      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(boxWsc, boxH, boxDsc)),
        new THREE.LineBasicMaterial({ color: 0xc0c0c0 })
      );
      wire.userData.w = true;
      pivotRef.current.add(wire);
      const colors = [0x374151, 0x4b5563, 0x6b7280, 0x374151, 0x4b5563];
      placed.forEach((p, i) => {
        const pw = p.bw * SC;
        const ph = p.t * SC;
        const pd = p.bd * SC;
        const yc = -boxH / 2 + p.y * SC;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(pw, ph, pd),
          new THREE.MeshLambertMaterial({ color: colors[i % colors.length] })
        );
        mesh.position.set(p.x * SC, yc, p.z * SC);
        mesh.userData.b = true;
        pivotRef.current?.add(mesh);
      });
      const vol = placed.reduce((s, p) => s + p.bw * p.bd * p.t, 0);
      const bv = bw * bd * (totalH + 20);
      const emptyVol = bv - vol;
      const emptyH = bw > 0 && bd > 0 ? Math.round(emptyVol / (bw * bd)) : 0;
      setPackInfo({ sizeText: `${bw}×${bd}×${totalH + 20}mm`, emptyText: `${bw}×${bd}×${emptyH}mm` });
    };

    buildMeshes(packed.placed, packed.totalH);

    let rX = 0.38, rY = 0.5, cd = 4.5, drag = false, lx = 0, ly = 0;
    const updateCamera = () => {
      camera.position.set(cd * Math.sin(rY) * Math.cos(rX), cd * Math.sin(rX), cd * Math.cos(rY) * Math.cos(rX));
      camera.lookAt(0, 0, 0);
    };
    updateCamera();

    const md = (e: MouseEvent) => { drag = true; lx = e.clientX; ly = e.clientY; };
    const mm = (e: MouseEvent) => {
      if (!drag) return;
      rY += (e.clientX - lx) * 0.007; rX += (e.clientY - ly) * 0.007;
      rX = Math.max(-1.3, Math.min(1.3, rX)); lx = e.clientX; ly = e.clientY; updateCamera();
    };
    const mu = () => { drag = false; };
    const wh = (e: WheelEvent) => { e.preventDefault(); cd = Math.max(2, Math.min(10, cd * (1 + e.deltaY * 0.001))); updateCamera(); };
    canvas.addEventListener("mousedown", md);
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", mu);
    canvas.addEventListener("wheel", wh, { passive: false });

    const resize = () => {
      const w = parent.clientWidth, h = parent.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); resize(); renderer.render(scene, camera); };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousedown", md);
      window.removeEventListener("mousemove", mm);
      window.removeEventListener("mouseup", mu);
      canvas.removeEventListener("wheel", wh);
      renderer.dispose();
      pivotRef.current = null;
    };
  }, [tab, boxDims, boardsMemo]);

  const repack = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const btn = e.currentTarget;
    const prev = btn.textContent;
    btn.textContent = "✓ 완료";
    window.setTimeout(() => { btn.textContent = prev ?? "다시 쌓기"; }, 900);
  };

  useImperativeHandle(ref, () => ({
    saveDraft: async () => setMsg("임시저장되었습니다."),
    save: async () => setMsg("저장되었습니다."),
    createNew: () => setMsg(null),
    openLibrary: () => setTab(2),
    loadFromVault: async () => setMsg("보관함 불러오기는 새 화면에서 미구현입니다."),
  }), []);

  if (!active) return null;

  const secStyle: React.CSSProperties = { fontSize: "10px", fontWeight: 700, color: "#aaa", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: "8px" };

  return (
    <div className="page active" style={{ display: "flex" }}>
      <div className="item-body">
        {/* Left panel */}
        <div className="item-left">
          <div className="it-tabs">
            <div className={`it-tab${tab === 0 ? " on" : ""}`} onClick={() => setTab(0)}>포장 정보</div>
            <div className={`it-tab${tab === 1 ? " on" : ""}`} onClick={() => setTab(1)}>3D 박스</div>
            <div className={`it-tab${tab === 2 ? " on" : ""}`} onClick={() => setTab(2)}>포함 자재</div>
          </div>

          {/* Tab 0: 포장 정보 */}
          <div className={`it-tc${tab === 0 ? " on" : ""}`}>
            <div style={{ maxWidth: "50%" }}>
              <div className="sec-title mb8" style={secStyle}>철물</div>
              <div className="inp-row">
                <span className="inp-label">별도 철물 포함</span>
                <input type="checkbox" className="chk" checked={hwOn} onChange={e => setHwOn(e.target.checked)} />
              </div>
              <div className="inp-row">
                <span className="inp-label">철물 수량<span className="inp-sub">개당 21원</span></span>
                <input type="number" className="num-inp" value={hwN} onChange={e => setHwN(Number(e.target.value) || 0)} />
                <span style={{ fontSize: "10px", color: "#999", marginLeft: "4px" }}>개</span>
              </div>
              <div className="inp-row">
                <span className="inp-label">별도 철물 묶음 수<span className="inp-sub">1,000원/묶음</span></span>
                <input type="number" className="num-inp" value={hwBag} onChange={e => setHwBag(Number(e.target.value) || 0)} />
                <span style={{ fontSize: "10px", color: "#999", marginLeft: "4px" }}>묶음</span>
              </div>
            </div>

            <div className="divider-line" />

            <div style={{ maxWidth: "50%" }}>
              <div className="sec-title mb8" style={{ ...secStyle, marginTop: "4px" }}>박스 포장비</div>
              <div style={{ fontSize: "10px", color: "#bbb", marginBottom: "8px" }}>
                자재 <span style={{ color: "#555", fontWeight: 600 }}>{materials.length}개</span> 기준으로 자동 선택됨
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                {(["500", "1000", "1500", "2000"] as const).map(v => (
                  <label key={v} className={`part-label${nkVal === v ? " sel" : ""}`}>
                    <input type="radio" name="parts" value={v} checked={nkVal === v} onChange={() => setNkVal(v)} style={{ accentColor: "#1a1a1a" }} />
                    {v === "500" && "1~2개"}{v === "1000" && "3~5개 / 기본"}{v === "1500" && "6~8개"}{v === "2000" && "9개 이상"}
                    <span className={`auto-badge${v === autoNkVal ? " on" : ""}`}>자동</span>
                    <span style={{ color: "#bbb", marginLeft: "auto" }}>{Number(v).toLocaleString()}원</span>
                  </label>
                ))}
              </div>
            </div>

            {materials.length > 0 && (
              <>
                <div className="divider-line" />
                <div style={secStyle}>포함 자재</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                  {materials.map((m, i) => (
                    <div key={i} style={{ fontSize: "11px", color: "#555", padding: "3px 0" }}>
                      {m.name ?? "이름 없음"}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Tab 1: 3D 박스 */}
          <div style={{ display: tab === 1 ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
            <div className="canvas-wrap" ref={parentRef} style={{ flex: 1, minHeight: 0 }}>
              <canvas ref={canvasRef} />
              <div className="drag-hint">드래그 회전 · 스크롤 줌</div>
            </div>
            <div style={{ padding: "12px 16px", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div className="sec-title" style={{ margin: 0, ...secStyle }}>박스 정보</div>
                <button className="repack-btn" onClick={repack}>
                  <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                    <path d="M2 6.5a4.5 4.5 0 1 1 .9 2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    <path d="M2 10.5V7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  다시 쌓기
                </button>
              </div>
              <div className="bs-grid">
                <div className="bs-item"><div className="bs-label">외곽 크기</div><div className="bs-value" style={{ fontSize: "11px" }}>{packInfo.sizeText}</div></div>
                <div className="bs-item"><div className="bs-label">빈 공간</div><div className="bs-value" style={{ fontSize: "11px" }}>{packInfo.emptyText}</div></div>
                <div className="bs-item"><div className="bs-label">자재 수</div><div className="bs-value">{materials.length}개</div></div>
                <div className="bs-item"><div className="bs-label">예상 무게</div><div className="bs-value">{estWeight} kg</div></div>
              </div>
            </div>
          </div>

          {/* Tab 2: 포함 자재 */}
          <div className={`it-tc${tab === 2 ? " on" : ""}`}>
            <div className="sec-title mb8" style={secStyle}>
              포함 자재{" "}
              <span style={{ fontSize: "10px", color: "#bbb", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                {materials.length}개
              </span>
            </div>
            {matCosts.length === 0 ? (
              <div style={{ fontSize: "12px", color: "#ccc", padding: "16px 0", textAlign: "center" }}>
                등록된 자재가 없습니다
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {matCosts.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#f8f8f8", borderRadius: "5px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", fontWeight: 500, color: "#333" }}>{m.name}</div>
                      {m.data && (
                        <div style={{ fontSize: "10px", color: "#999", marginTop: "2px" }}>
                          {m.data.w}×{m.data.d}×{m.data.t}T · {m.data.material} ·{" "}
                          {m.data.edgeType !== "없음" ? `${m.data.edgeType} ${m.data.edgeSetting}` : "엣지 없음"}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#282828", flexShrink: 0, marginLeft: "8px" }}>
                      {m.cost > 0 ? m.cost.toLocaleString() + "원" : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel: receipt */}
        <div className="item-right">
          <div className="rcpt-name">{name}</div>
          <div className="rcpt-total">{calc.factory.toLocaleString()}원</div>

          <div className="rsec">자재별 비용 (자재비+가공비)</div>
          {matCosts.length > 0 ? (
            matCosts.map((m, i) => (
              <div key={i} className="rrow bold">
                <span className="l">{m.name}</span>
                <span className="r">{m.cost.toLocaleString()}원</span>
              </div>
            ))
          ) : (
            <div className="rrow"><span className="l" style={{ color: "#ccc" }}>자재 없음</span><span className="r">0원</span></div>
          )}
          <div className="rsub" style={{ color: "#FF5948" }}>
            <span>자재비 합계</span><span>{matTotal.toLocaleString()}원</span>
          </div>

          <div className="rsec">포장비</div>
          <div className="rrow">
            <span className="l">세척비<small>자동 계산</small></span>
            <span className="r">{calc.wash.toLocaleString()}원</span>
          </div>
          <div className="rrow">
            <span className="l">철물 포장비<small>{hwN}개 × 21원</small></span>
            <span className="r">{calc.hwCost.toLocaleString()}원</span>
          </div>
          <div className="rrow">
            <span className="l">테이프</span>
            <span className="r">{calc.tape.toLocaleString()}원</span>
          </div>
          <div className="rrow">
            <span className="l">스티커</span>
            <span className="r">{calc.sticker.toLocaleString()}원</span>
          </div>
          <div className="rsub" style={{ color: "#FF5948" }}>
            <span>포장비 합계</span><span>{calc.packSub.toLocaleString()}원</span>
          </div>

          <div className="rsec">일반관리비</div>
          <div className="rrow">
            <span className="l">관리비<small>ROUNDUP(합계×5%, -2)</small></span>
            <span className="r">{calc.overhead.toLocaleString()}원</span>
          </div>

          <div className="rdiv" />
          <div className="rsum" style={{ color: "#FF5948" }}>
            <span>공장판매가</span><span>{calc.factory.toLocaleString()}원</span>
          </div>
        </div>
      </div>
    </div>
  );
});
