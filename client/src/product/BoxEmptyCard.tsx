import type { ProductComputed } from "./types";

type Props = {
  computed: ProductComputed | null;
};

/** 박스 적층 가정 시 외곽 박스 vs 부품 부피 / 빈 공간 % 시각화 */
export function BoxEmptyCard({ computed }: Props) {
  if (!computed || computed.parts.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-[#e0e0e0] bg-[#f8f9fa] p-6 text-center text-sm text-slate-400 min-h-[200px] flex items-center justify-center">
        부품을 추가하면 박스·빈공간 분석이 표시됩니다.
      </div>
    );
  }

  const { boxMm, boxVolumeMm3, partsVolumeMm3, emptyVolumeMm3, emptyPercent, parts } = computed;
  const fmt = (mm3: number) => (mm3 / 1e9).toFixed(3);

  return (
    <div className="rounded-2xl border border-[#e0e0e0] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h4 className="text-sm font-bold text-[#111]">박스 내 빈공간</h4>
          <p className="text-xs text-slate-500 mt-1">
            외곽 {boxMm.w}×{boxMm.d}×{boxMm.h} mm (max W × max D × ΣH)
          </p>
        </div>
        <div className="text-right">
          <span className="text-3xl font-bold text-[#1e6fff] tabular-nums">{emptyPercent.toFixed(1)}</span>
          <span className="text-lg font-semibold text-[#1e6fff]">%</span>
        </div>
      </div>

      <div className="overflow-x-auto text-xs mb-4">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-slate-500 border-b border-[#eee]">
              <th className="text-left py-2 font-medium">구분</th>
              <th className="text-right py-2 font-medium">부피 (L)</th>
            </tr>
          </thead>
          <tbody className="text-[#111]">
            <tr className="border-b border-[#f5f5f5]">
              <td className="py-2">전체 박스</td>
              <td className="text-right tabular-nums">{fmt(boxVolumeMm3)}</td>
            </tr>
            <tr className="border-b border-[#f5f5f5]">
              <td className="py-2">부품 합계</td>
              <td className="text-right tabular-nums">{fmt(partsVolumeMm3)}</td>
            </tr>
            <tr className="border-b border-[#f5f5f5]">
              <td className="py-2">빈 공간</td>
              <td className="text-right tabular-nums text-[#1e6fff] font-semibold">{fmt(emptyVolumeMm3)}</td>
            </tr>
            {parts.map((p, pi) => (
              <tr key={`${p.materialId}-${pi}`} className="border-b border-[#f5f5f5]">
                <td className="py-1.5 pl-2 text-slate-600 truncate max-w-[140px]">{p.name}</td>
                <td className="text-right tabular-nums">{(p.wMm * p.dMm * p.hMm / 1e9).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="h-28 relative rounded-xl bg-gradient-to-b from-[#eef4ff] to-[#f8f9fa] border border-[#e3e9f2] overflow-hidden">
        <div className="absolute inset-0 flex items-end justify-center pb-3 gap-1 px-4">
          {parts.slice(0, 6).map((p, i) => {
            const hPct = Math.max(12, (p.hMm / boxMm.h) * 100 * 0.6);
            return (
              <div
                key={`${p.materialId}-${i}`}
                className="rounded-sm bg-[#93c5fd] border border-[#1e6fff]/40 shadow-sm flex-1 min-w-[20px] max-w-[48px] transition-all"
                style={{ height: `${hPct}%` }}
                title={p.name}
              />
            );
          })}
        </div>
        <p className="absolute top-2 left-2 text-[10px] text-slate-500">적층 가정 시각화</p>
      </div>
    </div>
  );
}
