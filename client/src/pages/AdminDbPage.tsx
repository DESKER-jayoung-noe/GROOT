import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import {
  CUTTING_FEE_BY_PLACEMENT_EA,
  EDGE45_PAINT_RATES_WON_PER_M,
  EDGE_ABS1T_WW_WON_PER_M,
  EDGE_ABS2T_WW_WON_PER_M,
  HOTMELT_WON_PER_M2,
  MISC_PROC_RATES,
  SHEET_PRICES_WON,
} from "../data/adminPricingReference";

function Th({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th
      style={{ border: "1px solid var(--border)", background: "var(--surface2)", padding: "8px 12px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "var(--text1)" }}
      className={className}
    >
      {children}
    </th>
  );
}
function Td({ children, className = "", rowSpan }: { children: ReactNode; className?: string; rowSpan?: number }) {
  return (
    <td
      rowSpan={rowSpan}
      style={{ border: "1px solid var(--border)", padding: "8px 12px", fontSize: "13px", color: "var(--text2)" }}
      className={className}
    >
      {children}
    </td>
  );
}

export function AdminDbPage() {
  const { user } = useAuth();

  if (user?.role !== "ADMIN") return <Navigate to="/material" replace />;

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)", padding: "24px 24px 48px" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "28px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--text1)", margin: "0 0 8px" }}>데이터베이스 (관리자)</h1>
          <p style={{ fontSize: "13px", color: "var(--text2)", margin: 0 }}>
            견적 계산에 사용되는 단가 요약입니다.{" "}
            <span style={{ fontWeight: 600, color: "var(--text1)" }}>참고용 · 수정 불가</span> (실제 계산은 앱 내부 로직과 동일한 값입니다.)
          </p>
        </div>

        <section className="tds-card" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text1)", margin: "0 0 4px" }}>원자재 — 원장 장당 단가 (원)</h2>
          <p style={{ fontSize: "12px", color: "var(--text3)", margin: "0 0 16px" }}>두께(T) × 원장 규격별. ERP 기반 값과 동기화된 표입니다.</p>
          <div className="overflow-x-auto select-none pointer-events-none">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>두께 (mm)</Th>
                  <Th>원장</Th>
                  <Th className="text-right">장당 단가 (원)</Th>
                </tr>
              </thead>
              <tbody>
                {SHEET_PRICES_WON.flatMap((row) =>
                  row.sheets.map((s, j) => (
                    <tr key={`${row.thicknessMm}-${s.id}`}>
                      {j === 0 ? (
                        <Td className="font-semibold whitespace-nowrap align-top" rowSpan={row.sheets.length}>
                          {row.thicknessMm}
                        </Td>
                      ) : null}
                      <Td>{s.label}</Td>
                      <Td className="text-right tabular-nums">{s.priceWon.toLocaleString("ko-KR")}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tds-card" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text1)", margin: "0 0 4px" }}>엣지 — ABS (WW 기준, 원/m)</h2>
          <p style={{ fontSize: "12px", color: "var(--text3)", margin: "0 0 16px" }}>BI 색상 등은 별도 규칙(0원 처리 등)이 적용됩니다.</p>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text2)", margin: "0 0 8px" }}>ABS 1T WW</h3>
              <div className="overflow-x-auto select-none pointer-events-none">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <Th>두께 (mm) 이하</Th>
                      <Th className="text-right">원/m</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {EDGE_ABS1T_WW_WON_PER_M.map((r, i) => (
                      <tr key={i}>
                        <Td>≤ {r.maxThicknessMm}</Td>
                        <Td className="text-right tabular-nums">{r.wonPerM.toLocaleString("ko-KR")}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text2)", margin: "0 0 8px" }}>ABS 2T WW</h3>
              <div className="overflow-x-auto select-none pointer-events-none">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <Th>두께 (mm) 이하</Th>
                      <Th className="text-right">원/m</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {EDGE_ABS2T_WW_WON_PER_M.map((r, i) => (
                      <tr key={i}>
                        <Td>≤ {r.maxThicknessMm}</Td>
                        <Td className="text-right tabular-nums">{r.wonPerM.toLocaleString("ko-KR")}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text2)", margin: "20px 0 8px" }}>45° 엣지 도장 유형 (원/m)</h3>
          <div className="overflow-x-auto select-none pointer-events-none">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>유형</Th>
                  <Th className="text-right">원/m</Th>
                </tr>
              </thead>
              <tbody>
                {EDGE45_PAINT_RATES_WON_PER_M.map((r) => (
                  <tr key={r.label}>
                    <Td>{r.label}</Td>
                    <Td className="text-right tabular-nums">{r.wonPerM.toLocaleString("ko-KR")}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text2)", margin: "20px 0 8px" }}>핫멜트 — 두께 구간 (㎡당 원)</h3>
          <div className="overflow-x-auto select-none pointer-events-none">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>두께 (mm) 이하</Th>
                  <Th className="text-right">㎡당 (원)</Th>
                </tr>
              </thead>
              <tbody>
                {HOTMELT_WON_PER_M2.map((r, i) => (
                  <tr key={i}>
                    <Td>≤ {r.maxThicknessMm}</Td>
                    <Td className="text-right tabular-nums">{r.won.toLocaleString("ko-KR")}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tds-card" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text1)", margin: "0 0 16px" }}>가공비 등</h2>
          <div className="overflow-x-auto select-none pointer-events-none">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>항목</Th>
                  <Th className="text-right">단가</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td>재단비 (배치 수량 EA 구간)</Td>
                  <Td className="text-right text-xs">
                    {CUTTING_FEE_BY_PLACEMENT_EA.map((r) => (
                      <span key={r.minEa} className="block tabular-nums">
                        {r.minEa}EA 이상 → {r.feeWon.toLocaleString("ko-KR")}원
                      </span>
                    ))}
                  </Td>
                </tr>
                <tr>
                  <Td>포밍</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.formingWonPerM.toLocaleString("ko-KR")}원/m</Td>
                </tr>
                <tr>
                  <Td>루타</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.rutaWonPerM.toLocaleString("ko-KR")}원/m</Td>
                </tr>
                <tr>
                  <Td>루타 2차</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.ruta2WonPerM.toLocaleString("ko-KR")}원/m</Td>
                </tr>
                <tr>
                  <Td>조립</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.assemblyWonPerH.toLocaleString("ko-KR")}원/h</Td>
                </tr>
                <tr>
                  <Td>세척</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.washWonPerM2.toLocaleString("ko-KR")}원/㎡</Td>
                </tr>
                <tr>
                  <Td>일반 보링</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.boring1WonPerEa.toLocaleString("ko-KR")}원/EA</Td>
                </tr>
                <tr>
                  <Td>2단 보링</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.boring2WonPerEa.toLocaleString("ko-KR")}원/EA</Td>
                </tr>
                <tr>
                  <Td>곡면 엣지 (가공)</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.curvedMachiningWonPerM.toLocaleString("ko-KR")}원/m</Td>
                </tr>
                <tr>
                  <Td>곡면 엣지 (수작업)</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.curvedManualWonPerM.toLocaleString("ko-KR")}원/m</Td>
                </tr>
                <tr>
                  <Td>45° 테이핑</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.edge45TapingWonPerM.toLocaleString("ko-KR")}원/m</Td>
                </tr>
                <tr>
                  <Td>단품 — 테이프 (자동 산출)</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.tapeWonPerM.toLocaleString("ko-KR")}원/m</Td>
                </tr>
                <tr>
                  <Td>단품 — 스티커</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.stickerWonPerEa.toLocaleString("ko-KR")}원/EA</Td>
                </tr>
                <tr>
                  <Td>단품 — 세척 (표면적)</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.cleanWonPerM2.toLocaleString("ko-KR")}원/㎡</Td>
                </tr>
                <tr>
                  <Td>단품 — 별도 철물</Td>
                  <Td className="text-right tabular-nums">{MISC_PROC_RATES.hardwareWonPerEa.toLocaleString("ko-KR")}원/EA</Td>
                </tr>
                <tr>
                  <Td>단품 — 일반관리비 기본율</Td>
                  <Td className="text-right tabular-nums">{(MISC_PROC_RATES.defaultAdminRate * 100).toFixed(0)}%</Td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

