import { useEffect, useRef, useState, useCallback } from "react";
import { MaterialTab, type MaterialTabHandle } from "../material/MaterialTab";
import { ProductTab, type ProductTabHandle } from "../product/ProductTab";
import { SetTab, type SetTabHandle } from "../set/SetTab";

type AddSub = "material" | "product" | "set";

export function AddPage() {
  const [sub, setSub] = useState<AddSub>("material");
  const [materialBanner, setMaterialBanner] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const materialRef = useRef<MaterialTabHandle>(null);
  const productRef = useRef<ProductTabHandle>(null);
  const setRef = useRef<SetTabHandle>(null);

  const handleCreateNew = useCallback(() => {
    setConfirmNew(true);
  }, []);

  const handleConfirmNew = useCallback(() => {
    setConfirmNew(false);
    void materialRef.current?.createNew();
  }, []);

  useEffect(() => {
    if (!materialBanner) return;
    const t = window.setTimeout(() => setMaterialBanner(null), 4500);
    return () => clearTimeout(t);
  }, [materialBanner]);

  useEffect(() => {
    if (sub !== "material") setMaterialBanner(null);
  }, [sub]);

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#f8f9fa]">
      {/* 새로 만들기 확인 다이얼로그 */}
      {confirmNew && (
        <>
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setConfirmNew(false)} />
            <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
              <p className="mb-1 text-base font-bold text-[#191f28]">새로 만들기</p>
              <p className="mb-5 text-sm text-[#6f7a87]">지금까지 편집한 내용이 모두 삭제됩니다.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="flex-1 rounded-xl bg-[#1e6fff] py-2.5 text-sm font-semibold text-white hover:bg-[#185dcc]"
                  onClick={handleConfirmNew}
                >
                  새로 만들기
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-xl border-2 border-[#d6dbe3] bg-white py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => setConfirmNew(false)}
                >
                  돌아가기
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      <div className="shrink-0 border-b border-[#e0e0e0] bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6 min-w-0">
            <h1 className="text-2xl font-bold text-[#111] tracking-tight shrink-0">견적내기</h1>
            <div className="inline-flex rounded-full bg-[#f0f2f5] p-1 gap-1">
              {(
                [
                  ["material", "자재"],
                  ["product", "단품"],
                  ["set", "세트"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSub(k)}
                  className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${
                    sub === k ? "bg-[#1e6fff] text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {(sub === "material" || sub === "product" || sub === "set") && (
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {sub === "material" && materialBanner && (
                <span className="max-w-[min(100%,20rem)] text-sm font-medium text-[#3182f6] tabular-nums" role="status">
                  {materialBanner}
                </span>
              )}
              {sub === "material" && (
                <button
                  type="button"
                  className="rounded-xl border-2 border-[#d6dbe3] bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={handleCreateNew}
                >
                  새로 만들기
                </button>
              )}
              <button
                type="button"
                className="rounded-xl bg-[#1e6fff] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#185dcc]"
                onClick={() => {
                  if (sub === "material") void materialRef.current?.save();
                  if (sub === "product") void productRef.current?.save();
                  if (sub === "set") void setRef.current?.save();
                }}
              >
                저장하기
              </button>
              {sub === "material" && (
                <button
                  type="button"
                  className="rounded-xl border-2 border-[#d6dbe3] bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => materialRef.current?.openLibrary()}
                >
                  보관함
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className={`flex-1 min-h-0 flex flex-col ${sub === "material" ? "" : "hidden"}`}>
          <MaterialTab
            ref={materialRef}
            active={sub === "material"}
            onBannerMessage={(m) => setMaterialBanner(m)}
          />
        </div>
        <div className={`flex-1 min-h-0 flex flex-col ${sub === "product" ? "" : "hidden"}`}>
          <ProductTab ref={productRef} active={sub === "product"} />
        </div>
        <div className={`flex-1 min-h-0 flex flex-col ${sub === "set" ? "" : "hidden"}`}>
          <SetTab ref={setRef} active={sub === "set"} />
        </div>
      </div>
    </div>
  );
}
