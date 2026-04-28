/**
 * 원장 선택 — 자재편집/검토 화면에서 공통 사용.
 * 두께(T)와 W/D 가 주어지면 가능한 원장(4x6, 4x8, 6x8) 중 가격 있는 것만 노출.
 * 카드 클릭 시 selectedSheetId 업데이트.
 */
import { piecesPerSheet, SHEET_SPECS, type SheetId } from "../lib/yield";

type Props = {
  wMm: number;
  dMm: number;
  hMm: number;
  sheetPrices: Partial<Record<SheetId, number>>;
  selectedSheetId: SheetId | null;
  placementMode?: "default" | "rotated" | "mixed";
  onChange: (sheetId: SheetId) => void;
};

function fmtWon(n: number): string {
  return `₩${Math.max(0, Math.round(n)).toLocaleString()}`;
}

export function SheetSelector({
  wMm,
  dMm,
  hMm,
  sheetPrices,
  selectedSheetId,
  placementMode = "default",
  onChange,
}: Props) {
  const T = Math.floor(hMm || 0);
  const availableIds = (Object.keys(sheetPrices) as SheetId[]).filter((id) => (sheetPrices[id] ?? 0) > 0);

  if (availableIds.length === 0) {
    return (
      <div
        style={{
          padding: "12px 14px",
          background: "#F0F0F0",
          borderRadius: 4,
          fontSize: 12,
          color: "#7E7E7E",
        }}
      >
        해당 두께({T}T)의 원장 가격 없음
      </div>
    );
  }

  // 각 원장별 절단 가능 매수 / 단가/장 / 단가/매(piece) 계산
  const cells = availableIds.map((id) => {
    const spec = SHEET_SPECS.find((s) => s.id === id);
    const sheetW = spec?.widthMm ?? 0;
    const sheetH = spec?.heightMm ?? 0;
    const n = piecesPerSheet(sheetW, sheetH, wMm || 0, dMm || 0, placementMode);
    const sheetPrice = sheetPrices[id] ?? 0;
    const cpp = n > 0 ? sheetPrice / n : Infinity;
    return { id, sheetW, sheetH, n, sheetPrice, cpp };
  });

  // 선택값 없으면 최저 cpp 자동 추천 (시각적으로만 표시)
  const recommended = [...cells].sort((a, b) => a.cpp - b.cpp)[0]?.id;

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 500, color: "#7E7E7E", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
        원장 선택
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 8 }}>
        {cells.map((c) => {
          const active = selectedSheetId === c.id;
          const isRecommended = !active && c.id === recommended && cells.length > 1;
          const disabled = c.n === 0;
          return (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(c.id)}
              style={{
                position: "relative",
                padding: "10px 12px",
                background: active ? "#282828" : disabled ? "#F5F5F5" : "#fff",
                color: active ? "#fff" : disabled ? "#B3B3B3" : "#282828",
                border: `1px solid ${active ? "#282828" : "#D6D6D6"}`,
                borderRadius: 6,
                cursor: disabled ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                fontFeatureSettings: "'tnum' 1",
              }}
              title={disabled ? "이 원장으론 절단 불가 (수율 0)" : ""}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{c.id}</div>
              <div style={{ fontSize: 9, opacity: 0.8 }}>
                {c.sheetW}×{c.sheetH}
              </div>
              <div style={{ fontSize: 10, marginTop: 4, opacity: 0.85 }}>
                {disabled ? "—" : `${c.n}매/장 · ${fmtWon(c.cpp)}/매`}
              </div>
              {isRecommended ? (
                <div style={{ position: "absolute", top: 4, right: 6, fontSize: 9, color: "#16a34a", fontWeight: 600 }}>
                  추천
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
