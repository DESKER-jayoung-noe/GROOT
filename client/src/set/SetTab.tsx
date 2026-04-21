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
import { getSets } from "../offline/stores";
import { useAuth } from "../auth";
import { formatWonKorean } from "../util/format";

export type SetTabHandle = {
  saveDraft: () => Promise<void>;
  save: () => Promise<void>;
  loadFromVault: (id: string) => Promise<void>;
};

type SetComputed = {
  items: { productId: string; name: string; grandTotalWon: number; materialNames: string[] }[];
  grandTotalWon: number;
};

type FormState = {
  name: string;
  productIds: string[];
};

type ProdRow = {
  id: string;
  name: string;
  grandTotalWon: number;
  summary: string;
};

function defaultForm(): FormState {
  return {
    name: "1200폭 멀티책상세트",
    productIds: [],
  };
}

export const SetTab = forwardRef<
  SetTabHandle,
  {
    active?: boolean;
    quoteBindEntityId?: string | null;
    onQuoteMeta?: (meta: { name: string; grandTotalWon: number }) => void;
    onQuoteEntityRebind?: (entityId: string) => void;
    stripRenameEpoch?: number;
  }
>(function SetTab({ active = true, quoteBindEntityId, onQuoteMeta, onQuoteEntityRebind, stripRenameEpoch = 0 }, ref) {
  const { token } = useAuth();
  const [form, setForm] = useState<FormState>(defaultForm);
  const [computed, setComputed] = useState<SetComputed | null>(null);
  const [library, setLibrary] = useState<ProdRow[]>([]);
  const [savedSets, setSavedSets] = useState<
    { id: string; name: string; updatedAt: string; grandTotalWon: number; summary: string }[]
  >([]);
  const [libSearch, setLibSearch] = useState("");
  const [setSearch, setSetSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragOver, setDragOver] = useState(false);
  const onQuoteEntityRebindRef = useRef(onQuoteEntityRebind);
  onQuoteEntityRebindRef.current = onQuoteEntityRebind;

  const saveBody = useMemo(() => ({ ...form }), [form]);

  const previewPayload = useMemo(() => ({ productIds: form.productIds }), [form.productIds]);

  const previewKey = useMemo(() => JSON.stringify({ ...previewPayload, name: "" }), [previewPayload]);
  const deferredPreviewKey = useDeferredValue(previewKey);

  const refreshLibrary = useCallback(async () => {
    if (!token) return;
    const rows = await api<ProdRow[]>("/products/list?status=SAVED", { token });
    setLibrary(rows);
  }, [token]);

  const refreshSavedSets = useCallback(async () => {
    if (!token) return;
    const rows = await api<
      { id: string; name: string; updatedAt: string; grandTotalWon: number; summary: string }[]
    >("/sets/list?status=SAVED", { token });
    setSavedSets(rows);
  }, [token]);

  useEffect(() => {
    if (!active) return;
    void refreshLibrary();
    void refreshSavedSets();
  }, [active, refreshLibrary, refreshSavedSets]);

  useEffect(() => {
    if (!active || !token) return;
    let cancelled = false;
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      api<{ computed: SetComputed }>("/sets/preview", {
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

  const addProduct = useCallback((productId: string) => {
    setForm((f) => ({ ...f, productIds: [...f.productIds, productId] }));
  }, []);

  const removeAt = useCallback((index: number) => {
    setForm((f) => ({
      ...f,
      productIds: f.productIds.filter((_, i) => i !== index),
    }));
  }, []);

  const onSaveRef = useRef<(draft: boolean, silent?: boolean) => Promise<void>>(async () => {});

  const onSave = useCallback(
    async (draft: boolean, silent?: boolean) => {
      if (!silent) setMsg(null);
      if (!token) return;
      try {
        if (editingId) {
          await api(`/sets/${editingId}`, { method: "PUT", body: JSON.stringify(saveBody), token });
          if (!silent) setMsg(draft ? "임시저장되었습니다." : "저장되었습니다.");
        } else {
          const path = draft ? "/sets/draft" : "/sets/save";
          const res = await api<{ id: string }>(path, {
            method: "POST",
            body: JSON.stringify(saveBody),
            token,
          });
          setEditingId(res.id);
          onQuoteEntityRebindRef.current?.(res.id);
          if (!silent) setMsg(draft ? "임시저장되었습니다." : "보관함에 저장되었습니다.");
        }
        void refreshLibrary();
        void refreshSavedSets();
      } catch (e) {
        if (!silent) setMsg(e instanceof ApiError ? e.message : "저장에 실패했습니다.");
      }
    },
    [token, saveBody, editingId, refreshLibrary, refreshSavedSets]
  );

  onSaveRef.current = onSave;

  const loadSet = useCallback(
    async (id: string) => {
      if (!token) return;
      const row = await api<{ name: string; form: FormState; computed: SetComputed }>(`/sets/${id}`, { token });
      setForm({ ...row.form, name: row.name });
      setComputed(row.computed);
      setEditingId(id);
      onQuoteEntityRebindRef.current?.(id);
    },
    [token]
  );

  useImperativeHandle(
    ref,
    () => ({
      saveDraft: () => onSave(true),
      save: () => onSave(false),
      loadFromVault: (id: string) => loadSet(id),
    }),
    [onSave, loadSet]
  );

  useEffect(() => {
    if (!active || !quoteBindEntityId || !token) return;
    void loadSet(quoteBindEntityId);
  }, [active, quoteBindEntityId, token, loadSet]);

  useEffect(() => {
    if (!stripRenameEpoch || !quoteBindEntityId || !active) return;
    const s = getSets().find((x) => x.id === quoteBindEntityId);
    if (!s) return;
    setForm((f) => ({ ...f, name: s.name }));
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

  async function onCopySet(id: string) {
    if (!token) return;
    const res = await api<{ id: string; name: string }>(`/sets/${id}/copy`, { method: "POST", token });
    await loadSet(res.id);
    setMsg(`복사됨: ${res.name}`);
    void refreshSavedSets();
  }

  const filteredLib = useMemo(() => {
    const q = libSearch.toLowerCase();
    return library.filter((p) => p.name.toLowerCase().includes(q));
  }, [library, libSearch]);

  const filteredSets = useMemo(() => {
    const q = setSearch.toLowerCase();
    return savedSets.filter((s) => s.name.toLowerCase().includes(q));
  }, [savedSets, setSearch]);

  const onDragStartLib = (e: React.DragEvent, productId: string) => {
    e.dataTransfer.setData("productId", productId);
    e.dataTransfer.effectAllowed = "copy";
  };

  const onDropMain = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData("productId");
    if (id) addProduct(id);
  };

  const toggleExpand = (key: string) => {
    setExpanded((s) => ({ ...s, [key]: !s[key] }));
  };

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-0 bg-[#f8f9fa]">
      <div className="flex-1 min-w-0 overflow-auto px-5 py-6 lg:px-8">
        <div className="max-w-3xl mx-auto lg:mx-0 space-y-6">
          <div className="rounded-2xl bg-white border border-[#e0e0e0] shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6 pb-4 border-b border-[#f0f0f0]">
              <input
                className="text-lg font-bold text-[#111] bg-transparent border-none outline-none flex-1 min-w-0"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="세트명"
              />
              <div className="text-right shrink-0">
                <span className="text-sm text-slate-500">예상 : </span>
                <span className="text-lg font-bold text-[#1e6fff] tabular-nums">
                  {computed ? formatWonKorean(computed.grandTotalWon) : "—"}
                </span>
              </div>
            </div>

            <div className="px-6 py-6">
              <div
                className={`min-h-[200px] rounded-2xl border-2 border-dashed p-4 transition-colors ${
                  dragOver ? "border-[#1e6fff] bg-[#1e6fff]/5" : "border-[#cfe2ff] bg-[#f8fbff]"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDropMain}
              >
                <p className="text-xs text-slate-500 mb-3">단품을 끌어다 놓거나 오른쪽에서 추가하세요.</p>
                <div className="space-y-3">
                  {computed?.items.map((item, i) => {
                    const key = `${item.productId}-${i}`;
                    const open = expanded[key] ?? true;
                    return (
                      <div key={key} className="rounded-xl border-2 border-[#bfdbfe] bg-white p-4 shadow-sm">
                        <div className="flex justify-between gap-3 items-start">
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-[#111]">{item.name}</div>
                            <button
                              type="button"
                              className="text-xs text-[#1e6fff] mt-1 font-medium"
                              onClick={() => toggleExpand(key)}
                            >
                              {open ? "▼ 하위 자재 접기" : "▶ 하위 자재 펼치기"}
                            </button>
                            {open && item.materialNames.length > 0 && (
                              <ul className="mt-2 text-sm text-slate-600 list-disc pl-5 space-y-0.5">
                                {item.materialNames.map((n, j) => (
                                  <li key={j}>{n}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[#1e6fff] font-bold tabular-nums">{formatWonKorean(item.grandTotalWon)}</div>
                            <button type="button" className="text-xs text-red-500 mt-2 hover:underline" onClick={() => removeAt(i)}>
                              제거
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(!computed || computed.items.length === 0) && (
                    <div className="text-center text-slate-400 text-sm py-12">추가된 단품이 없습니다</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {msg && <p className="text-sm text-slate-600">{msg}</p>}

          <details className="rounded-2xl border border-[#e0e0e0] bg-white p-4">
            <summary className="cursor-pointer text-sm font-bold text-[#111]">저장된 세트 불러오기</summary>
            <div className="mt-3 space-y-2">
              <div className="relative">
                <input
                  placeholder="검색"
                  className="w-full rounded-xl border border-[#e0e0e0] bg-[#f8f9fa] pl-3 pr-9 py-2 text-sm"
                  value={setSearch}
                  onChange={(e) => setSetSearch(e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
              </div>
              <div className="space-y-2 max-h-56 overflow-auto">
                {filteredSets.map((s) => (
                  <div
                    key={s.id}
                    className={`rounded-xl border-2 p-3 text-sm ${editingId === s.id ? "border-[#1e6fff] bg-[#f8fbff]" : "border-[#e8e8e8]"}`}
                  >
                    <div className="font-semibold text-[#111]">{s.name}</div>
                    <div className="text-[#1e6fff] font-bold tabular-nums">{formatWonKorean(s.grandTotalWon)}</div>
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        className="text-xs rounded-lg border border-[#e0e0e0] px-2 py-1 hover:bg-slate-50"
                        onClick={() => void onCopySet(s.id)}
                      >
                        복사
                      </button>
                      <button
                        type="button"
                        className="text-xs rounded-lg border border-[#e0e0e0] px-2 py-1 hover:bg-slate-50"
                        onClick={() => void loadSet(s.id)}
                      >
                        수정
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </details>

          <button
            type="button"
            className="text-sm text-slate-500 underline underline-offset-2 hover:text-[#1e6fff]"
            onClick={() => {
              setForm(defaultForm());
              setEditingId(null);
              setMsg(null);
              setExpanded({});
            }}
          >
            새 세트
          </button>
        </div>
      </div>

      <aside className="w-full lg:w-[300px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#e0e0e0] bg-white flex flex-col min-h-[280px] lg:min-h-0 max-h-[55vh] lg:max-h-none">
        <div className="p-4 border-b border-[#f0f0f0]">
          <h2 className="text-base font-bold text-[#111] mb-3">저장된 단품 목록</h2>
          <div className="relative">
            <input
              placeholder="검색"
              className="w-full rounded-xl border border-[#e0e0e0] bg-[#f8f9fa] pl-3 pr-10 py-2.5 text-sm"
              value={libSearch}
              onChange={(e) => setLibSearch(e.target.value)}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {filteredLib.map((p) => (
            <div
              key={p.id}
              draggable
              onDragStart={(e) => onDragStartLib(e, p.id)}
              className="rounded-xl border border-[#e0e0e0] bg-white p-3 cursor-grab active:cursor-grabbing"
            >
              <div className="flex justify-between gap-2">
                <span className="font-semibold text-sm text-[#111] line-clamp-2">{p.name}</span>
                <span className="text-[#1e6fff] font-bold text-sm shrink-0 tabular-nums">{formatWonKorean(p.grandTotalWon)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-2 line-clamp-2">{p.summary}</p>
              <button
                type="button"
                className="mt-2 w-full rounded-lg bg-[#1e6fff] py-1.5 text-xs font-semibold text-white"
                onClick={() => addProduct(p.id)}
              >
                세트에 추가하기
              </button>
            </div>
          ))}
          {filteredLib.length === 0 && <div className="text-center text-sm text-slate-400 py-8">저장된 단품이 없습니다</div>}
          {Array.from({ length: Math.max(0, 3 - filteredLib.length) }).map((_, i) => (
            <div key={`ph-${i}`} className="h-20 rounded-xl border-2 border-dashed border-[#ececec] bg-[#f8f9fa]" />
          ))}
        </div>
      </aside>
    </div>
  );
});
