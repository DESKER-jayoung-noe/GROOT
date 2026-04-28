import { useState } from "react";

/* ─────────────────────────────────────────
   데이터
───────────────────────────────────────────── */

const HOTMELT_ROWS = [
  { code: "ETET000425-R000_12", name: "핫멜트, 12t용", unit: "㎡", price: 72  },
  { code: "ETET000425-R000_15", name: "핫멜트, 15t용", unit: "㎡", price: 85  },
  { code: "ETET000425-R000_18", name: "핫멜트, 18t용", unit: "㎡", price: 99  },
  { code: "ETET000425-R000_22", name: "핫멜트, 22t용", unit: "㎡", price: 116 },
  { code: "ETET000425-R000_28", name: "핫멜트, 28t용", unit: "㎡", price: 143 },
  { code: "ETET000425-R000_30", name: "핫멜트, 30t용", unit: "㎡", price: 152 },
  { code: "ETET000425-R000_33", name: "핫멜트, 33t용", unit: "㎡", price: 166 },
  { code: "ETET000425-R000_37", name: "핫멜트, 37t용", unit: "㎡", price: 188 },
  { code: "ETET000425-R000_40", name: "핫멜트, 40t용", unit: "㎡", price: 197 },
  { code: "ETET000425-R000_44", name: "핫멜트, 44t용", unit: "㎡", price: 215 },
];

const EDGE_ROWS = [
  { type: "도장엣지", thickness: "",  width: "",   color: "WW", unit: "M", price: 2500,  code: "P0COATEDG21"    },
  { type: "평엣지",   thickness: "1", width: "16", color: "WW", unit: "M", price: 139,   code: "W21-3E-3400A"  },
  { type: "평엣지",   thickness: "1", width: "19", color: "WW", unit: "M", price: 166,   code: "W21-3E-3399A"  },
  { type: "평엣지",   thickness: "1", width: "21", color: "WW", unit: "M", price: 184,   code: "W21-3E-3401A"  },
  { type: "평엣지",   thickness: "1", width: "26", color: "WW", unit: "M", price: 224,   code: "W21-3E-3398B"  },
  { type: "평엣지",   thickness: "1", width: "33", color: "WW", unit: "M", price: 280,   code: "W21-3E-3402"   },
  { type: "평엣지",   thickness: "2", width: "19", color: "WW", unit: "M", price: 251,   code: "W21-3E-3174"   },
  { type: "평엣지",   thickness: "2", width: "21", color: "WW", unit: "M", price: 271,   code: "W21-3E-3168"   },
  { type: "평엣지",   thickness: "2", width: "26", color: "WW", unit: "M", price: 338,   code: "W21-3E-3398C"  },
  { type: "평엣지",   thickness: "2", width: "33", color: "WW", unit: "M", price: 439,   code: "W21-3E-3152"   },
];

const BOARD_ROWS = [
  { material: "PB", thickness: "12T", size: "4×8",   grain: "정결", price: 19460, code: "WDWP000260-R000"  },
  { material: "PB", thickness: "15T", size: "4×6",   grain: "정결", price: 23270, code: "WDWP001205-R000"  },
  { material: "PB", thickness: "15T", size: "4×8",   grain: "정결", price: 32800, code: "WDWP000258-R000"  },
  { material: "PB", thickness: "15T", size: "6×8",   grain: "정결", price: 23270, code: "WDWP001360-R000"  },
  { material: "PB", thickness: "18T", size: "4×6",   grain: "정결", price: 16620, code: "WDPGBL0000550"    },
  { material: "PB", thickness: "18T", size: "4×8",   grain: "정결", price: 23270, code: "WDWP000274-R000"  },
  { material: "PB", thickness: "18T", size: "6×8",   grain: "정결", price: 23770, code: "WDWPMF0000237"    },
  { material: "PB", thickness: "22T", size: "4×8",   grain: "정결", price: 19460, code: "WDWP000266-R000"  },
  { material: "PB", thickness: "22T", size: "6×8",   grain: "정결", price: 23270, code: "WDWP000730-R000"  },
  { material: "PB", thickness: "25T", size: "4×8",   grain: "정결", price: 23270, code: "WDWP001811-R000"  },
  { material: "PB", thickness: "28T", size: "4×5.3", grain: "정결", price: 23270, code: "WDWP000322-R000"  },
  { material: "PB", thickness: "28T", size: "4×8",   grain: "정결", price: 23270, code: "WDWP000407-R000"  },
  { material: "PB", thickness: "28T", size: "6×8",   grain: "정결", price: 23270, code: "WDWP000951-R000"  },
];

/* ─────────────────────────────────────────
   스타일 헬퍼
───────────────────────────────────────────── */
const th: React.CSSProperties = {
  padding: "7px 12px",
  fontSize: 11,
  fontWeight: 600,
  color: "#666",
  textAlign: "left",
  background: "#f6f7f9",
  borderBottom: "1px solid #e8e8e8",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "7px 12px",
  fontSize: 12,
  color: "#1a1a1a",
  borderBottom: "0.5px solid #f0f0f0",
  whiteSpace: "nowrap",
};
const tdCode: React.CSSProperties = { ...td, fontFamily: "monospace", fontSize: 11, color: "#888" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right" };

const fmtWon = (n: number) => n.toLocaleString("ko-KR") + "원";

/* ─────────────────────────────────────────
   컴포넌트
───────────────────────────────────────────── */
type Tab = "edge" | "board" | "hotmelt";

export function DBModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("edge");

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 500 }}
        onMouseDown={onClose}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 501,
          background: "#fff",
          width: 680,
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "calc(100vh - 80px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 40px rgba(0,0,0,.18)",
          borderRadius: 2,
          overflow: "hidden",
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px 0",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>단가 DB</span>
          <button
            type="button"
            onClick={onClose}
            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#aaa", lineHeight: 1, padding: "0 2px" }}
          >
            ×
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, padding: "10px 18px 0", borderBottom: "1px solid #e8e8e8", flexShrink: 0 }}>
          {([
            { key: "edge"    as Tab, label: "엣지 단가" },
            { key: "board"   as Tab, label: "보드 단가" },
            { key: "hotmelt" as Tab, label: "핫멜트 단가" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: tab === key ? 700 : 400,
                color: tab === key ? "#1a1a1a" : "#888",
                borderBottom: tab === key ? "2px solid #1a1a1a" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 0 12px" }}>
          {tab === "edge" ? (
            <EdgeTable />
          ) : tab === "board" ? (
            <BoardTable />
          ) : (
            <HotmeltTable />
          )}
        </div>
      </div>
    </>
  );
}

/* ── 엣지 단가 표 ── */
function EdgeTable() {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th}>유형</th>
            <th style={th}>두께 (T)</th>
            <th style={th}>폭 (mm)</th>
            <th style={th}>색상</th>
            <th style={th}>단위</th>
            <th style={{ ...th, textAlign: "right" }}>단가 (원/m)</th>
            <th style={th}>자재코드</th>
          </tr>
        </thead>
        <tbody>
          {EDGE_ROWS.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              <td style={td}>{r.type}</td>
              <td style={td}>{r.thickness}</td>
              <td style={td}>{r.width}</td>
              <td style={td}>{r.color}</td>
              <td style={td}>{r.unit}</td>
              <td style={tdNum}>{r.price.toLocaleString("ko-KR")}</td>
              <td style={tdCode}>{r.code}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 보드 단가 표 ── */
function BoardTable() {
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ padding: "0 18px 8px", fontSize: 11, color: "#888" }}>
        WW · LPM/O 기준
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th}>소재</th>
            <th style={th}>두께</th>
            <th style={th}>원장사이즈</th>
            <th style={th}>결방향</th>
            <th style={{ ...th, textAlign: "right" }}>매출가 (원)</th>
            <th style={th}>자재코드</th>
          </tr>
        </thead>
        <tbody>
          {BOARD_ROWS.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              <td style={td}>{r.material}</td>
              <td style={td}>{r.thickness}</td>
              <td style={td}>{r.size}</td>
              <td style={td}>{r.grain}</td>
              <td style={tdNum}>{fmtWon(r.price)}</td>
              <td style={tdCode}>{r.code}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 핫멜트 단가 표 ── */
function HotmeltTable() {
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ padding: "0 18px 8px", fontSize: 11, color: "#888" }}>
        ABS 엣지 시 자동 적용 — 실소요량(㎡) × 단가
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={th}>자재코드</th>
            <th style={th}>자재명</th>
            <th style={th}>단위</th>
            <th style={{ ...th, textAlign: "right" }}>단가 (원/㎡)</th>
          </tr>
        </thead>
        <tbody>
          {HOTMELT_ROWS.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
              <td style={tdCode}>{r.code}</td>
              <td style={td}>{r.name}</td>
              <td style={td}>{r.unit}</td>
              <td style={tdNum}>{r.price.toLocaleString("ko-KR")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
