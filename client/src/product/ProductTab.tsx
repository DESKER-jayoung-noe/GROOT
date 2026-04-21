import {
  forwardRef,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, ApiError } from "../api";
import { getProducts } from "../offline/stores";
import { useAuth } from "../auth";
import { formatWonKorean } from "../util/format";
import { BoxEmptyCard } from "./BoxEmptyCard";
import type { ProductComputed, ProductFormState } from "./types";

export type ProductTabHandle = {
  saveDraft: () => Promise<void>;
  save: () => Promise<void>;
  createNew: () => void;
  openLibrary: () => void;
  loadFromVault: (id: string) => Promise<void>;
};

type MatRow = {
  id: string;
  name: string;
  grandTotalWon: number;
  summary: string;
  color?: string;
  edge?: string;
  board?: string;
  sheetLabel?: string;
};

function defaultForm(): ProductFormState {
  return {
    name: "1200폭 멀티책상세트 책장선반류 A",
    lineItems: [],
    hardwareEa: 0,
    stickerEa: 1,
    adminRate: 0.05,
  };
}

function normalizeProductForm(f: ProductFormState): ProductFormState {
  if (f.lineItems && f.lineItems.length > 0) {
    return {
      ...f,
      lineItems: f.lineItems.map((l) => ({
        materialId: l.materialId,
        qty: Math.min(500, Math.max(1, Math.floor(Number(l.qty) || 1))),
      })),
    };
  }
  if (f.materialIds && f.materialIds.length > 0) {
    return {
      ...f,
      lineItems: f.materialIds.map((id) => ({ materialId: id, qty: 1 })),
    };
  }
  return { ...f, lineItems: [] };
}

function formatPartSizeLine(p: ProductComputed["parts"][number]): string {
  const w = String(Math.round(p.wMm)).padStart(3, "0");
  const d = String(Math.round(p.dMm)).padStart(3, "0");
  const t = String(Math.round(p.hMm)).padStart(2, "0");
  return `${w}×${d}×${t}T`;
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
>(function ProductTab({ active = true, quoteBindEntityId, onQuoteMeta, onQuoteEntityRebind, stripRenameEpoch = 0 }, ref) {
  const { token } = useAuth();
  const [form, setForm] = useState<ProductFormState>(defaultForm);
  const [computed, setComputed] = useState<ProductComputed | null>(null);
  const [library, setLibrary] = useState<MatRow[]>([]);
  const [list, setList] = useState<
    { id: string; name: string; updatedAt: string; grandTotalWon: number; summary: string }[]
  >([]);
  const [savedSearch, setSavedSearch] = useState("");
  const [libSearch, setLibSearch] = useState("");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selectedLineIdx, setSelectedLineIdx] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [vaultTab, setVaultTab] = useState<"material" | "product">("material");
  const vaultAsideRef = useRef<HTMLElement>(null);
  const onQuoteEntityRebindRef = useRef(onQuoteEntityRebind);
  onQuoteEntityRebindRef.current = onQuoteEntityRebind;

  const saveBody = useMemo(() => ({ ...form }), [form]);

  const previewPayload = useMemo(
    () => ({
      lineItems: form.lineItems,
      hardwareEa: form.hardwareEa,
      stickerEa: form.stickerEa,
      adminRate: form.adminRate,
    }),
    [form.lineItems, form.hardwareEa, form.stickerEa, form.adminRate]
  );

  const previewKey = useMemo(() => JSON.stringify({ ...previewPayload, name: "" }), [previewPayload]);
  const deferredPreviewKey = useDeferredValue(previewKey);

  const refreshLibrary = useCallback(async () => {
    if (!token) return;
    const rows = await api<MatRow[]>("/materials/list?status=SAVED", { token });
    setLibrary(rows);
  }, [token]);

  const refreshList = useCallback(async () => {
    if (!token) return;
    const rows = await api<
      { id: string; name: string; updatedAt: string; grandTotalWon: number; summary: string }[]
    >("/products/list?status=SAVED", { token });
    setList(rows);
  }, [token]);

  useEffect(() => {
    if (!active) return;
    void refreshLibrary();
    void refreshList();
  }, [active, refreshLibrary, refreshList]);

  useEffect(() => {
    if (!active || !token) return;
    let cancelled = false;
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      api<{ computed: ProductComputed }>("/products/preview", {
        method: "POST",
        body: deferredPreviewKey,
        token,
        signal: ac.signal,
      })
        .then((r) => {
          if (!cancelled) startTransition(() => setComputed(r.computed));
        })
        .catch((e: unknown) => {
          if ((e as { name?: string })?.name === "AbortError") return;
          if (!cancelled) startTransition(() => setComputed(null));
        });
    }, 480);
    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(t);
    };
  }, [active, token, deferredPreviewKey]);

  const addMaterial = useCallback((materialId: string) => {
    setForm((f) => ({ ...f, lineItems: [...f.lineItems, { materialId, qty: 1 }] }));
    setSelectedLineIdx(null);
  }, []);

  const removeLine = useCallback((lineIdx: number) => {
    setForm((f) => ({
      ...f,
      lineItems: f.lineItems.filter((_, i) => i !== lineIdx),
    }));
    setSelectedLineIdx((s) => (s === lineIdx ? null : s !== null && s > lineIdx ? s - 1 : s));
  }, []);

  const setLineQty = useCallback((lineIdx: number, qty: number) => {
    const q = Math.min(500, Math.max(1, Math.floor(qty) || 1));
    setForm((f) => ({
      ...f,
      lineItems: f.lineItems.map((l, i) => (i === lineIdx ? { ...l, qty: q } : l)),
    }));
  }, []);

  const onSaveRef = useRef<(draft: boolean, silent?: boolean) => Promise<void>>(async () => {});

  const onSave = useCallback(
    async (draft: boolean, silent?: boolean) => {
      if (!silent) setMsg(null);
      if (!token) return;
      try {
        if (editingId) {
          await api(`/products/${editingId}`, { method: "PUT", body: JSON.stringify(saveBody), token });
          if (!silent) setMsg(draft ? "임시저장되었습니다." : "저장되었습니다.");
        } else {
          const path = draft ? "/products/draft" : "/products/save";
          const res = await api<{ id: string }>(path, {
            method: "POST",
            body: JSON.stringify(saveBody),
            token,
          });
          setEditingId(res.id);
          onQuoteEntityRebindRef.current?.(res.id);
          if (!silent) setMsg(draft ? "임시저장되었습니다." : "보관함에 저장되었습니다.");
        }
        void refreshList();
      } catch (e) {
        if (!silent) setMsg(e instanceof ApiError ? e.message : "저장에 실패했습니다.");
      }
    },
    [token, saveBody, editingId, refreshList]
  );

  onSaveRef.current = onSave;

  const createNew = useCallback(() => {
    setForm(defaultForm());
    setEditingId(null);
    setMsg(null);
    setSelectedLineIdx(null);
  }, []);

  const loadProduct = useCallback(
    async (id: string) => {
      if (!token) return;
      const row = await api<{ name: string; form: ProductFormState; computed: ProductComputed }>(`/products/${id}`, {
        token,
      });
      setForm(normalizeProductForm({ ...row.form, name: row.name }));
      setComputed(row.computed);
      setEditingId(id);
      onQuoteEntityRebindRef.current?.(id);
    },
    [token]
  );

  const openLibraryImpl = useCallback(() => {
    setVaultTab("product");
    window.requestAnimationFrame(() => {
      vaultAsideRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      saveDraft: () => onSave(true),
      save: () => onSave(false),
      createNew,
      openLibrary: openLibraryImpl,
      loadFromVault: (id: string) => loadProduct(id),
    }),
    [onSave, createNew, openLibraryImpl, loadProduct]
  );

  useEffect(() => {
    if (!active || !quoteBindEntityId || !token) return;
    void loadProduct(quoteBindEntityId);
  }, [active, quoteBindEntityId, token, loadProduct]);

  useEffect(() => {
    if (!stripRenameEpoch || !quoteBindEntityId || !active) return;
    const p = getProducts().find((x) => x.id === quoteBindEntityId);
    if (!p) return;
    setForm((f) => ({ ...f, name: p.name }));
  }, [stripRenameEpoch, quoteBindEntityId, active]);

  const quoteMode = Boolean(quoteBindEntityId);

  useEffect(() => {
    if (!quoteMode) return;
    return () => {
      void onSaveRef.current(true, true);
    };
  }, [quoteMode]);

  const autoSaveKey = useMemo(() => JSON.stringify(saveBody) + String(editingId), [saveBody, editingId]);

  useEffect(() => {
    if (!active) return;
    if (quoteBindEntityId && editingId !== quoteBindEntityId) return;
    const tid = window.setTimeout(() => {
      void onSave(true, true);
    }, 1600);
    return () => clearTimeout(tid);
  }, [active, autoSaveKey, editingId, quoteBindEntityId, onSave]);

  useEffect(() => {
    if (!quoteBindEntityId || !active) return;
    if (editingId !== quoteBindEntityId) return;
    onQuoteMeta?.({
      name: form.name?.trim() || "이름 없음",
      grandTotalWon: computed?.grandTotalWon ?? 0,
    });
  }, [quoteBindEntityId, active, editingId, form.name, computed?.grandTotalWon, onQuoteMeta]);

  async function onCopy(id: string) {
    if (!token) return;
    const res = await api<{ id: string; name: string }>(`/products/${id}/copy`, { method: "POST", token });
    await loadProduct(res.id);
    setMsg(`복사됨: ${res.name}`);
    void refreshList();
  }

  const filteredLib = useMemo(() => {
    const q = libSearch.toLowerCase();
    return library.filter((m) => m.name.toLowerCase().includes(q));
  }, [library, libSearch]);

  const filteredSaved = useMemo(() => {
    let rows = list.filter((r) => r.name.toLowerCase().includes(savedSearch.toLowerCase()));
    rows = [...rows].sort((a, b) =>
      sort === "new"
        ? new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        : new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
    );
    return rows;
  }, [list, savedSearch, sort]);

  const onDragStartLib = (e: React.DragEvent, materialId: string) => {
    e.dataTransfer.setData("materialId", materialId);
    e.dataTransfer.effectAllowed = "copy";
  };

  const onDropParts = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData("materialId");
    if (id) addMaterial(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f2f4f7] lg:flex-row">
      <div className="flex-1 min-w-0 overflow-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-6 lg:py-6 2xl:px-8">
        <div className="w-full max-w-none mx-auto lg:mx-0 space-y-6">
          <div className="rounded-2xl bg-white border border-[#e0e0e0] shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-4 border-b border-[#f0f0f0]">
              <input
                className="text-lg font-bold text-[#111] bg-transparent border-none outline-none flex-1 min-w-0 placeholder:text-slate-400"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="단품명"
              />
              <div className="text-right shrink-0">
                <span className="text-sm text-slate-500">예상 : </span>
                <span className="text-lg font-bold text-[#1e6fff] tabular-nums">
                  {computed ? formatWonKorean(computed.grandTotalWon) : "—"}
                </span>
              </div>
            </div>

            <div className="px-6 py-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-stretch">
                <div className="min-w-0 flex-[3] space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-bold text-[#111]">부품리스트</h3>
                    <span className="text-sm font-bold text-[#111] tabular-nums shrink-0">
                      {computed ? formatWonKorean(computed.partsCostWon) : "—"}
                    </span>
                  </div>
                  <div
                    className={`min-h-[160px] rounded-2xl border-2 border-dashed transition-colors ${
                      dragOver ? "border-[#1e6fff] bg-[#1e6fff]/5" : "border-[#e0e0e0] bg-[#fafafa]"
                    } p-3`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDropParts}
                  >
                    <p className="text-xs text-slate-500 mb-2">자재를 여기로 끌어다 놓거나 오른쪽 보관함에서 추가하세요.</p>
                    <div className="flex flex-col gap-2">
                      {form.lineItems.map((line, lineIdx) => {
                        const lineParts =
                          computed?.parts.filter((p) => (p.sourceLineIndex ?? -1) === lineIdx) ?? [];
                        const lineTotal = lineParts.reduce((s, p) => s + p.grandTotalWon, 0);
                        const sample = lineParts[0];
                        return (
                          <button
                            key={`line-${lineIdx}-${line.materialId}`}
                            type="button"
                            onClick={() => setSelectedLineIdx(selectedLineIdx === lineIdx ? null : lineIdx)}
                            className={`w-full text-left rounded-xl border-2 p-3 transition-colors ${
                              selectedLineIdx === lineIdx ? "border-[#1e6fff] bg-[#f8fbff]" : "border-[#e0e0e0] bg-white"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                              <span className="font-semibold text-sm text-[#111] min-w-0 flex-1 break-words">
                                {sample?.name ?? "자재"}
                              </span>
                              {sample && (
                                <span className="font-mono text-sm tabular-nums text-[#0f172a] tracking-tight whitespace-nowrap">
                                  {formatPartSizeLine(sample)}
                                </span>
                              )}
                              <label className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <span className="text-[11px] text-slate-500">수량</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={500}
                                  className="w-14 rounded-lg border border-[#e0e0e0] px-2 py-1 text-right text-sm tabular-nums"
                                  value={line.qty}
                                  onChange={(e) => setLineQty(lineIdx, Number(e.target.value))}
                                />
                              </label>
                              <span className="text-[#1e6fff] font-bold text-sm tabular-nums whitespace-nowrap shrink-0">
                                {formatWonKorean(lineTotal)}
                              </span>
                              <button
                                type="button"
                                className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 text-lg leading-none"
                                title="이 줄 제거"
                                aria-label="제거"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeLine(lineIdx);
                                }}
                              >
                                ×
                              </button>
                            </div>
                          </button>
                        );
                      })}
                      {form.lineItems.length === 0 && (
                        <div className="w-full py-8 text-center text-sm text-slate-400">부품이 없습니다</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="min-w-0 flex-[3] xl:max-w-none">
                  <BoxEmptyCard computed={computed} />
                </div>

                <div className="w-full min-w-0 xl:flex-none xl:w-[min(45%,27rem)] flex flex-col gap-4">
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-base font-bold text-[#111]">포장비</h3>
                      <span className="text-sm font-bold text-[#111] tabular-nums">
                        {computed ? formatWonKorean(computed.packagingTotalWon) : "—"}
                      </span>
                    </div>
                    {computed && (
                      <div className="grid grid-cols-1 gap-2.5 text-sm">
                        <div className="flex justify-between gap-2 rounded-xl border border-[#e8e8e8] bg-[#fafafa] px-3 py-2">
                          <span className="text-slate-600">별도 철물</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              className="w-16 rounded border border-[#e0e0e0] px-2 py-0.5 text-right text-xs"
                              value={form.hardwareEa}
                              onChange={(e) => setForm((f) => ({ ...f, hardwareEa: Number(e.target.value) || 0 }))}
                            />
                            <span className="text-xs text-slate-400">EA</span>
                            <span className="font-semibold tabular-nums w-24 text-right">{formatWonKorean(computed.packaging.hardwareWon)}</span>
                          </div>
                        </div>
                        <div className="flex justify-between gap-2 rounded-xl border border-[#e8e8e8] bg-[#fafafa] px-3 py-2">
                          <span className="text-slate-600">세척비</span>
                          <span className="font-semibold tabular-nums">{formatWonKorean(computed.packaging.cleaningWon)}</span>
                        </div>
                        <div className="flex justify-between gap-2 rounded-xl border border-[#e8e8e8] bg-[#fafafa] px-3 py-2">
                          <span className="text-slate-600">박스</span>
                          <span className="font-semibold tabular-nums">{formatWonKorean(computed.packaging.boxWon)}</span>
                        </div>
                        <div className="flex flex-col gap-1 rounded-xl border border-[#e8e8e8] bg-[#fafafa] px-3 py-2">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-600">테이프</span>
                            <span className="font-semibold tabular-nums">{formatWonKorean(computed.packaging.tapeWon)}</span>
                          </div>
                          <span className="text-[10px] text-slate-500 text-right">외곽 둘레 자동</span>
                        </div>
                        <div className="flex justify-between gap-2 rounded-xl border border-[#e8e8e8] bg-[#fafafa] px-3 py-2">
                          <span className="text-slate-600">스티커</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              className="w-16 rounded border border-[#e0e0e0] px-2 py-0.5 text-right text-xs"
                              value={form.stickerEa}
                              onChange={(e) => setForm((f) => ({ ...f, stickerEa: Number(e.target.value) || 0 }))}
                            />
                            <span className="text-xs text-slate-400">EA</span>
                            <span className="font-semibold tabular-nums w-24 text-right">{formatWonKorean(computed.packaging.stickerWon)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                  <section className="flex items-center justify-between rounded-xl bg-[#f8f9fa] border border-[#e8e8e8] px-4 py-3">
                    <span className="text-sm font-bold text-[#111]">일반관리비 ({(form.adminRate * 100).toFixed(0)}%)</span>
                    <span className="text-base font-bold text-[#111] tabular-nums">
                      {computed ? formatWonKorean(computed.adminWon) : "—"}
                    </span>
                  </section>
                </div>
              </div>
            </div>
          </div>

          {msg && <p className="text-sm text-slate-600">{msg}</p>}

          <button
            type="button"
            className="text-sm text-slate-500 underline underline-offset-2 hover:text-[#1e6fff]"
            onClick={() => {
              setForm(defaultForm());
              setEditingId(null);
              setMsg(null);
            }}
          >
            새 단품
          </button>
        </div>
      </div>

      <aside
        ref={vaultAsideRef}
        className="w-full lg:w-[300px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#e0e0e0] bg-white flex flex-col min-h-[280px] lg:min-h-0 max-h-[55vh] lg:max-h-none"
      >
        <div className="p-4 border-b border-[#f0f0f0]">
          <h2 className="text-base font-bold text-[#111] mb-3">보관함</h2>
          <div className="flex rounded-xl bg-[#f2f4f7] p-1 mb-3">
            <button
              type="button"
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                vaultTab === "material" ? "bg-white text-[#111] shadow-sm" : "text-slate-500 hover:text-[#111]"
              }`}
              onClick={() => setVaultTab("material")}
            >
              자재
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                vaultTab === "product" ? "bg-white text-[#111] shadow-sm" : "text-slate-500 hover:text-[#111]"
              }`}
              onClick={() => setVaultTab("product")}
            >
              단품
            </button>
          </div>
          {vaultTab === "material" && (
            <>
              <div className="relative">
                <input
                  placeholder="자재 검색"
                  className="w-full rounded-xl border border-[#e0e0e0] bg-[#f8f9fa] pl-3 pr-10 py-2.5 text-sm focus:border-[#1e6fff] focus:outline-none focus:ring-1 focus:ring-[#1e6fff]/25"
                  value={libSearch}
                  onChange={(e) => setLibSearch(e.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
              </div>
              <p className="text-xs text-slate-500 mt-2">저장된 자재만 표시됩니다.</p>
            </>
          )}
          {vaultTab === "product" && (
            <>
              <div className="relative">
                <input
                  placeholder="단품 검색"
                  className="w-full rounded-xl border border-[#e0e0e0] bg-[#f8f9fa] pl-3 pr-10 py-2.5 text-sm focus:border-[#1e6fff] focus:outline-none focus:ring-1 focus:ring-[#1e6fff]/25"
                  value={savedSearch}
                  onChange={(e) => setSavedSearch(e.target.value)}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
              </div>
              <div className="flex gap-2 text-xs text-slate-500 mt-2">
                <button type="button" className={sort === "new" ? "font-semibold text-[#1e6fff]" : ""} onClick={() => setSort("new")}>
                  최신순
                </button>
                <span className="text-[#e0e0e0]">|</span>
                <button type="button" className={sort === "old" ? "font-semibold text-[#1e6fff]" : ""} onClick={() => setSort("old")}>
                  오래된 순
                </button>
              </div>
            </>
          )}
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {vaultTab === "material" && (
            <>
              {filteredLib.map((m) => (
                <div
                  key={m.id}
                  draggable
                  onDragStart={(e) => onDragStartLib(e, m.id)}
                  className="rounded-xl border border-[#e0e0e0] bg-white p-3 cursor-grab active:cursor-grabbing hover:border-slate-300"
                >
                  <div className="flex justify-between gap-2 items-start">
                    <span className="font-semibold text-sm text-[#111] line-clamp-1">{m.name}</span>
                    <span className="text-[#1e6fff] font-bold text-sm shrink-0 tabular-nums">{formatWonKorean(m.grandTotalWon)}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2 leading-relaxed line-clamp-3">
                    {m.summary}
                    {m.color ? ` · ${m.color}` : ""}
                    {m.edge ? ` · ${m.edge}` : ""}
                    {m.sheetLabel ? ` · ${m.sheetLabel}` : ""}
                  </p>
                  <button
                    type="button"
                    className="mt-2 w-full rounded-lg bg-[#1e6fff] py-1.5 text-xs font-semibold text-white hover:bg-[#185dcc]"
                    onClick={() => addMaterial(m.id)}
                  >
                    단품에 추가하기
                  </button>
                </div>
              ))}
              {filteredLib.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-8">저장된 자재가 없습니다</div>
              )}
              {Array.from({ length: Math.max(0, 3 - filteredLib.length) }).map((_, i) => (
                <div key={`lib-ph-${i}`} className="h-20 rounded-xl border-2 border-dashed border-[#ececec] bg-[#f8f9fa]" />
              ))}
            </>
          )}
          {vaultTab === "product" && (
            <>
              {filteredSaved.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-xl border-2 p-3 text-sm ${editingId === item.id ? "border-[#1e6fff] bg-[#f8fbff]" : "border-[#e8e8e8]"}`}
                >
                  <div className="font-semibold text-[#111]">{item.name}</div>
                  <div className="text-[#1e6fff] font-bold tabular-nums">{formatWonKorean(item.grandTotalWon)}</div>
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      className="text-xs rounded-lg border border-[#e0e0e0] px-2 py-1 hover:bg-slate-50"
                      onClick={() => void onCopy(item.id)}
                    >
                      복사
                    </button>
                    <button
                      type="button"
                      className="text-xs rounded-lg border border-[#e0e0e0] px-2 py-1 hover:bg-slate-50"
                      onClick={() => void loadProduct(item.id)}
                    >
                      불러오기
                    </button>
                  </div>
                </div>
              ))}
              {filteredSaved.length === 0 && (
                <div className="text-center text-sm text-slate-400 py-8">저장된 단품이 없습니다</div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
});
