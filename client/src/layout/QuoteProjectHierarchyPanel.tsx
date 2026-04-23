import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import { useProject } from "../context/ProjectContext";
import { getProjectBreadcrumb } from "../lib/projectBreadcrumb";
import { useQuoteTabs, type QuoteKind } from "../context/QuoteTabsContext";
import { quotePathForKind } from "../quote/quotePaths";
import {
  applyQuoteEntityName,
  deleteMaterialCompletely,
  deleteProductEntity,
  deleteSetEntity,
  duplicateMaterialById,
  duplicateProductById,
  duplicateSetById,
  getMaterials,
  getProducts,
  getSets,
  moveMaterialRelativeToAnchor,
  moveMaterialToProduct,
  moveProductIntoSet,
  moveProductRelativeToAnchor,
  moveSetRelative,
  QUOTE_TREE_DND_MIME,
  type StoredProduct,
  type StoredSet,
} from "../offline/stores";
import type { ProductFormState } from "../product/types";

function materialIdsForProduct(form: ProductFormState): string[] {
  const li = form.lineItems;
  if (li && li.length > 0) return li.map((x) => x.materialId);
  return form.materialIds ?? [];
}

function useHierarchySnapshot() {
  const [n, setN] = useState(0);
  const { activeProjectId } = useProject();
  const refresh = useCallback(() => setN((x) => x + 1), []);

  useEffect(() => {
    refresh();
  }, [activeProjectId, refresh]);

  useEffect(() => {
    const t = window.setInterval(refresh, 2500);
    const onStore = (e: StorageEvent) => {
      if (e.key?.startsWith("groot_")) refresh();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("storage", onStore);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("storage", onStore);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  return { gen: n, refresh };
}

type MatNode = { id: string; name: string };
type ProdNode = { id: string; name: string; materials: MatNode[] };
type SetNode = { id: string; name: string; products: ProdNode[] };

type Sel = { kind: QuoteKind; id: string } | null;

type TagRole = "set" | "product" | "material";

type EditState = { kind: QuoteKind; id: string; draft: string } | null;

function KindTag({ role }: { role: TagRole }) {
  const t = role === "set" ? "세트" : role === "product" ? "단품" : "자재";
  return <span className={`quote-qt-kind quote-qt-kind--${role}`}>{t}</span>;
}

function IconCopy() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M4 16V6a2 2 0 0 1 2-2h10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 3h6l1 2h4v2H4V5h4l1-2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M6 7h12l-1 14H7L6 7Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

type HeadProps = {
  onClose: () => void;
  addOpen: boolean;
  setAddOpen: (v: boolean) => void;
  addWrapRef: RefObject<HTMLDivElement | null>;
  onAddKind: (k: QuoteKind) => void;
};

function QuoteTreeChromeHeader({ onClose, addOpen, setAddOpen, addWrapRef, onAddKind }: HeadProps) {
  const { projects, activeProjectId, groups, ungroupedProjectIds } = useProject();
  const breadcrumb = useMemo(() => {
    if (!activeProjectId) return null;
    return getProjectBreadcrumb(activeProjectId, projects, ungroupedProjectIds, groups);
  }, [activeProjectId, projects, ungroupedProjectIds, groups]);
  const pathLine = useMemo(
    () => (breadcrumb && breadcrumb.groupNames.length > 0 ? breadcrumb.groupNames.join(" / ") : ""),
    [breadcrumb]
  );

  return (
    <div className="quote-drawer-chrome quote-qt-dock__chromehead">
      <div
        className="quote-qt-dock__chromehead-text"
        title={[pathLine, breadcrumb?.projectName].filter(Boolean).join(" / ")}
      >
        {pathLine ? <p className="quote-qt-dock__pathline">{pathLine}</p> : null}
        <p className="quote-qt-dock__sec-title">{breadcrumb?.projectName?.trim() || "—"}</p>
      </div>
      <div className="quote-drawer-chrome-trailing">
        <div className="quote-side-add-wrap" ref={addWrapRef}>
          <button
            type="button"
            className="quote-side-label-btn quote-drawer-chrome-add"
            aria-expanded={addOpen}
            aria-haspopup="menu"
            aria-label="자재, 단품, 세트 추가"
            onClick={() => setAddOpen(!addOpen)}
          >
            +
          </button>
          {addOpen ? (
            <ul className="quote-side-dropdown" style={{ right: 0, left: "auto" }} role="menu">
              <li>
                <button type="button" className="quote-side-dropdown-item" role="menuitem" onClick={() => onAddKind("material")}>
                  자재
                </button>
              </li>
              <li>
                <button type="button" className="quote-side-dropdown-item" role="menuitem" onClick={() => onAddKind("product")}>
                  단품
                </button>
              </li>
              <li>
                <button type="button" className="quote-side-dropdown-item" role="menuitem" onClick={() => onAddKind("set")}>
                  세트
                </button>
              </li>
            </ul>
          ) : null}
        </div>
        <button type="button" className="quote-drawer-chrome-close" onClick={onClose} aria-label="패널 닫기">
          ×
        </button>
      </div>
    </div>
  );
}

type RowActProps = {
  onCopy: () => void;
  onDelete: () => void;
};

function TreeRowActions({ onCopy, onDelete }: RowActProps) {
  return (
    <div className="quote-qt-row-actions">
      <button
        type="button"
        className="quote-qt-icon-btn"
        title="복사"
        aria-label="복사"
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
      >
        <IconCopy />
      </button>
      <button
        type="button"
        className="quote-qt-icon-btn quote-qt-icon-btn--danger"
        title="삭제"
        aria-label="삭제"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <IconTrash />
      </button>
    </div>
  );
}

function dropPlace(e: DragEvent, el: Element): "before" | "after" {
  const r = el.getBoundingClientRect();
  return e.clientY < r.top + r.height / 2 ? "before" : "after";
}

type DragKind = "material" | "product" | "set";
type DragPay = { kind: DragKind; id: string };

function parseTreeDrag(e: DragEvent): DragPay | null {
  try {
    const t = e.dataTransfer.getData(QUOTE_TREE_DND_MIME);
    if (t) {
      const p = JSON.parse(t) as DragPay;
      if (p && (p.kind === "material" || p.kind === "product" || p.kind === "set") && p.id) return p;
    }
  } catch {
    /* ignore */
  }
  return null;
}

type GutterProps = {
  visible: boolean;
  expanded?: boolean;
  onToggle?: () => void;
};

/** 전체 행이 아닌 이 핸들에서만 DnB 시작 — 이름 클릭과 끌기가 겹치지 않게 */
function QuoteRowDragHandle({
  canDrag: canD,
  onDragStart,
}: {
  canDrag: boolean;
  onDragStart: (e: DragEvent) => void;
}) {
  return (
    <div
      className="quote-qt-draghandle"
      draggable={canD}
      onDragStart={onDragStart}
      title="끌어서 이동 (순서·그룹)"
      aria-label="끌어서 이동"
    />
  );
}

function TreeGutter({ visible, expanded = true, onToggle = () => {} }: GutterProps) {
  if (!visible) {
    return <div className="quote-qt-tree-gutter quote-qt-tree-gutter--spacer" aria-hidden />;
  }
  return (
    <div className="quote-qt-tree-gutter">
      <button
        type="button"
        className="quote-qt-chevron"
        title={expanded ? "접기" : "펼치기"}
        aria-expanded={expanded}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <span className={"quote-qt-chevron-ico" + (expanded ? " quote-qt-chevron-ico--open" : "")} aria-hidden>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path
              d="M2.5 1.25L5.5 4L2.5 6.75"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
    </div>
  );
}

type EditableLeadProps = {
  tag: TagRole;
  quoteKind: QuoteKind;
  id: string;
  name: string;
  mainClassName: string;
  editing: EditState;
  setEditing: (e: EditState) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  onCommit: (kind: QuoteKind, id: string, value: string) => void;
  goEntity: (kind: QuoteKind, id: string) => void;
};

function EditableLead({
  tag,
  quoteKind,
  id,
  name,
  mainClassName,
  editing,
  setEditing,
  inputRef,
  onCommit,
  goEntity,
}: EditableLeadProps) {
  const isThis = editing?.kind === quoteKind && editing.id === id;
  const escCancel = useRef(false);

  useEffect(() => {
    if (!isThis) return;
    const r = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(r);
  }, [isThis, inputRef]);

  return (
    <div className="quote-qt-entity__lead">
      <KindTag role={tag} />
      {isThis ? (
        <input
          ref={inputRef}
          className="quote-qt-entity__input"
          value={editing!.draft}
          onChange={(e) => setEditing({ kind: quoteKind, id, draft: e.target.value })}
          onBlur={(e) => {
            if (escCancel.current) {
              escCancel.current = false;
              return;
            }
            onCommit(quoteKind, id, (e.target as HTMLInputElement).value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              escCancel.current = true;
              setEditing(null);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className={mainClassName}
          onClick={(e) => {
            if (e.detail > 1) return;
            goEntity(quoteKind, id);
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            setEditing({ kind: quoteKind, id, draft: name });
          }}
        >
          {name}
        </button>
      )}
    </div>
  );
}

type Props = { onClose: () => void };

export function QuoteProjectHierarchyPanel({ onClose }: Props) {
  const { gen, refresh } = useHierarchySnapshot();
  const nav = useNavigate();
  const { addTab, openEntityTab, closeTabsForEntity, tabs, activeTabId, renameTabEntity, refreshLabels } = useQuoteTabs();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EditState>(null);
  const [collapsedS, setCollapsedS] = useState<Set<string>>(() => new Set());
  const [collapsedP, setCollapsedP] = useState<Set<string>>(() => new Set());
  const addWrapRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const onDragStartRow = (kind: DragKind, id: string) => (e: DragEvent) => {
    e.dataTransfer.setData(QUOTE_TREE_DND_MIME, JSON.stringify({ kind, id }));
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOverRow = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const canDrag = (kind: DragKind, id: string) => !(editing?.kind === kind && editing.id === id);

  const selected: Sel = useMemo(() => {
    if (!activeTabId) return null;
    const t = tabs.find((x) => x.tabId === activeTabId);
    if (!t) return null;
    return { kind: t.kind, id: t.entityId };
  }, [tabs, activeTabId]);

  const { setBlocks, orphanProducts, orphanMaterials } = useMemo(() => {
    void gen;
    const sets = getSets();
    const products = getProducts();
    const materials = getMaterials();
    const byProd = new Map(products.map((p) => [p.id, p] as const));
    const byMat = new Map(materials.map((m) => [m.id, m] as const));

    const inSetProductIds = new Set<string>();
    for (const s of sets) {
      for (const pid of s.form.productIds) inSetProductIds.add(pid);
    }

    const setBlocks: SetNode[] = sets.map((s) => {
      const prodNodes: ProdNode[] = [];
      for (const pid of s.form.productIds) {
        const p = byProd.get(pid);
        if (!p) continue;
        const mids = materialIdsForProduct(p.form);
        const matNodes: MatNode[] = mids.map((id) => {
          const m = byMat.get(id);
          return m ? { id, name: m.name || "이름 없음" } : { id, name: "(삭제됨)" };
        });
        prodNodes.push({ id: p.id, name: p.name || "이름 없음", materials: matNodes });
      }
      return { id: s.id, name: s.name || "이름 없음", products: prodNodes };
    });

    const orphanP: ProdNode[] = [];
    for (const p of products) {
      if (inSetProductIds.has(p.id)) continue;
      const mids = materialIdsForProduct(p.form);
      const matNodes: MatNode[] = mids.map((id) => {
        const m = byMat.get(id);
        return m ? { id, name: m.name || "이름 없음" } : { id, name: "(삭제됨)" };
      });
      orphanP.push({ id: p.id, name: p.name || "이름 없음", materials: matNodes });
    }

    const usedMat = new Set<string>();
    for (const p of products) {
      for (const id of materialIdsForProduct(p.form)) usedMat.add(id);
    }
    const orphanM: MatNode[] = materials
      .filter((m) => !usedMat.has(m.id))
      .map((m) => ({ id: m.id, name: m.name || "이름 없음" }));

    return { setBlocks, orphanProducts: orphanP, orphanMaterials: orphanM };
  }, [gen]);

  useEffect(() => {
    if (!addOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = addWrapRef.current;
      if (el && !el.contains(e.target as Node)) setAddOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [addOpen]);

  const onAddKind = (kind: QuoteKind) => {
    setAddOpen(false);
    addTab(kind);
    nav(quotePathForKind(kind));
  };

  const goEntity = (kind: QuoteKind, id: string) => {
    openEntityTab(kind, id);
    nav(quotePathForKind(kind));
  };

  const commitName = (kind: QuoteKind, id: string, value: string) => {
    setEditing(null);
    const tab = tabs.find((t) => t.kind === kind && t.entityId === id);
    if (tab) {
      renameTabEntity(tab.tabId, value);
    } else {
      applyQuoteEntityName(kind, id, value);
      refreshLabels();
    }
    refresh();
  };

  const dupSet = (id: string) => {
    const n = duplicateSetById(id);
    if (n) {
      openEntityTab("set", n);
      nav("/set");
    }
    refresh();
  };
  const delSet = (s: Pick<StoredSet, "id" | "name">) => {
    if (!window.confirm(`「${s.name}」세트를 삭제할까요?`)) return;
    closeTabsForEntity("set", s.id);
    deleteSetEntity(s.id);
    refresh();
  };

  const dupProduct = (id: string) => {
    const n = duplicateProductById(id);
    if (n) {
      openEntityTab("product", n);
      nav("/product");
    }
    refresh();
  };
  const delProduct = (p: Pick<StoredProduct, "id" | "name">) => {
    if (!window.confirm(`「${p.name}」단품을 삭제할까요?`)) return;
    closeTabsForEntity("product", p.id);
    deleteProductEntity(p.id);
    refresh();
  };

  const dupMaterial = (id: string) => {
    const n = duplicateMaterialById(id);
    if (n) {
      openEntityTab("material", n);
      nav("/material");
    }
    refresh();
  };
  const delMaterial = (id: string, name: string) => {
    if (!window.confirm(`「${name}」자재를 삭제할까요? 단품/표에서의 연결이 함께 제거됩니다.`)) return;
    closeTabsForEntity("material", id);
    deleteMaterialCompletely(id);
    refresh();
  };

  const isSel = (kind: QuoteKind, id: string) => selected?.kind === kind && selected.id === id;

  const empty = setBlocks.length === 0 && orphanProducts.length === 0 && orphanMaterials.length === 0;

  return (
    <aside className="quote-qt-dock" aria-label="견적 구성">
      <QuoteTreeChromeHeader
        onClose={onClose}
        addOpen={addOpen}
        setAddOpen={setAddOpen}
        addWrapRef={addWrapRef}
        onAddKind={onAddKind}
      />
      <nav className="quote-side-tree quote-qt-dock__tree">
        {empty ? <p className="quote-qt-empty">+ 로 자재, 단품, 세트를 추가하세요.</p> : null}

        {/* 단품에 연결되지 않은 자재 (위쪽) */}
        {orphanMaterials.length > 0 ? (
          <ul className="quote-qt-orphan-mats">
            {orphanMaterials.map((m) => {
              const mActive = isSel("material", m.id);
              return (
                <li
                  key={m.id}
                  className={"quote-qt-entity" + (mActive ? " quote-qt-entity--active" : "")}
                >
                  <QuoteRowDragHandle
                    canDrag={canDrag("material", m.id)}
                    onDragStart={onDragStartRow("material", m.id)}
                  />
                  <TreeGutter visible={false} />
                  <EditableLead
                    tag="material"
                    quoteKind="material"
                    id={m.id}
                    name={m.name}
                    mainClassName="quote-qt-entity__main quote-qt-entity__main--mat"
                    editing={editing}
                    setEditing={setEditing}
                    inputRef={nameInputRef}
                    onCommit={commitName}
                    goEntity={goEntity}
                  />
                  <TreeRowActions
                    onCopy={() => dupMaterial(m.id)}
                    onDelete={() => delMaterial(m.id, m.name)}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}

        {setBlocks.map((s) => {
          const setActive = isSel("set", s.id);
          const setHasKids = s.products.length > 0;
          const setOpen = setHasKids && !collapsedS.has(s.id);
          return (
            <section key={s.id} className="quote-grp-block">
              <div
                className={
                  "quote-qt-entity" +
                  (setActive ? " quote-qt-entity--active" : "") +
                  (setHasKids ? " quote-qt-entity--expandable" : "")
                }
                onDragOver={onDragOverRow}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const d = parseTreeDrag(e);
                  if (!d) return;
                  const t = e.currentTarget as HTMLElement;
                  const pl = dropPlace(e, t);
                  if (d.kind === "set" && d.id !== s.id) {
                    moveSetRelative(d.id, s.id, pl);
                  } else if (d.kind === "product") {
                    moveProductIntoSet(d.id, s.id, pl === "before" ? "first" : "last");
                  } else if (d.kind === "material" && s.products.length > 0) {
                    const t =
                      s.products.length === 1
                        ? s.products[0]
                        : pl === "before"
                          ? s.products[0]
                          : s.products[s.products.length - 1];
                    moveMaterialToProduct(d.id, t.id, pl === "before" ? "first" : "last");
                  }
                  refresh();
                }}
              >
                <QuoteRowDragHandle
                  canDrag={canDrag("set", s.id)}
                  onDragStart={onDragStartRow("set", s.id)}
                />
                <TreeGutter
                  visible={setHasKids}
                  expanded={setOpen}
                  onToggle={() => {
                    setCollapsedS((prev) => {
                      const n = new Set(prev);
                      if (n.has(s.id)) n.delete(s.id);
                      else n.add(s.id);
                      return n;
                    });
                  }}
                />
                <EditableLead
                  tag="set"
                  quoteKind="set"
                  id={s.id}
                  name={s.name}
                  mainClassName="quote-qt-entity__main quote-qt-entity__main--set"
                  editing={editing}
                  setEditing={setEditing}
                  inputRef={nameInputRef}
                  onCommit={commitName}
                  goEntity={goEntity}
                />
                <TreeRowActions onCopy={() => dupSet(s.id)} onDelete={() => delSet({ id: s.id, name: s.name })} />
              </div>

              {setOpen && setHasKids ? (
                <div className="quote-proj-tree">
                  <span className="quote-proj-tree-rail" aria-hidden />
                  <div className="quote-proj-tree-list">
                    {s.products.map((p) => {
                      const prodActive = isSel("product", p.id);
                      const pHasKids = p.materials.length > 0;
                      const pOpen = pHasKids && !collapsedP.has(p.id);
                      return (
                        <div key={p.id} className="quote-qt-nest">
                          <div
                            className={
                              "quote-qt-entity" +
                              (prodActive ? " quote-qt-entity--active" : "") +
                              (pHasKids ? " quote-qt-entity--expandable" : "")
                            }
                            onDragOver={onDragOverRow}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const d = parseTreeDrag(e);
                              if (!d) return;
                              const t = e.currentTarget as HTMLElement;
                              const pl = dropPlace(e, t);
                              if (d.kind === "set") return;
                              if (d.kind === "product") {
                                moveProductRelativeToAnchor(d.id, p.id, pl);
                              } else {
                                moveMaterialToProduct(d.id, p.id, pl === "before" ? "first" : "last");
                              }
                              refresh();
                            }}
                          >
                            <QuoteRowDragHandle
                              canDrag={canDrag("product", p.id)}
                              onDragStart={onDragStartRow("product", p.id)}
                            />
                            <TreeGutter
                              visible={pHasKids}
                              expanded={pOpen}
                              onToggle={() => {
                                setCollapsedP((prev) => {
                                  const n = new Set(prev);
                                  if (n.has(p.id)) n.delete(p.id);
                                  else n.add(p.id);
                                  return n;
                                });
                              }}
                            />
                            <EditableLead
                              tag="product"
                              quoteKind="product"
                              id={p.id}
                              name={p.name}
                              mainClassName="quote-qt-entity__main quote-qt-entity__main--prod"
                              editing={editing}
                              setEditing={setEditing}
                              inputRef={nameInputRef}
                              onCommit={commitName}
                              goEntity={goEntity}
                            />
                            <TreeRowActions
                              onCopy={() => dupProduct(p.id)}
                              onDelete={() => delProduct({ id: p.id, name: p.name })}
                            />
                          </div>
                          {pOpen && pHasKids ? (
                            <div className="quote-proj-tree quote-qt-mat-nest">
                              <span className="quote-proj-tree-rail" aria-hidden />
                              <ul className="quote-proj-tree-list">
                                {p.materials.map((m) => {
                                  const mActive = isSel("material", m.id);
                                  return (
                                    <li
                                      key={m.id}
                                      className={"quote-qt-entity" + (mActive ? " quote-qt-entity--active" : "")}
                                      onDragOver={onDragOverRow}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const d = parseTreeDrag(e);
                                        if (!d) return;
                                        const t = e.currentTarget as HTMLElement;
                                        const pl = dropPlace(e, t);
                                        if (d.kind === "set") return;
                                        if (d.kind === "product") {
                                          moveProductRelativeToAnchor(d.id, p.id, pl);
                                        } else {
                                          moveMaterialRelativeToAnchor(d.id, p.id, m.id, pl);
                                        }
                                        refresh();
                                      }}
                                    >
                                      <QuoteRowDragHandle
                                        canDrag={canDrag("material", m.id)}
                                        onDragStart={onDragStartRow("material", m.id)}
                                      />
                                      <TreeGutter visible={false} />
                                      <EditableLead
                                        tag="material"
                                        quoteKind="material"
                                        id={m.id}
                                        name={m.name}
                                        mainClassName="quote-qt-entity__main quote-qt-entity__main--mat"
                                        editing={editing}
                                        setEditing={setEditing}
                                        inputRef={nameInputRef}
                                        onCommit={commitName}
                                        goEntity={goEntity}
                                      />
                                      <TreeRowActions
                                        onCopy={() => dupMaterial(m.id)}
                                        onDelete={() => delMaterial(m.id, m.name)}
                                      />
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}

        {orphanProducts.length > 0
          ? orphanProducts.map((p) => {
              const prodActive = isSel("product", p.id);
              const pHasKids = p.materials.length > 0;
              const pOpen = pHasKids && !collapsedP.has(p.id);
              return (
                <div key={p.id} className="quote-qt-nest">
                  <div
                    className={
                      "quote-qt-entity" +
                      (prodActive ? " quote-qt-entity--active" : "") +
                      (pHasKids ? " quote-qt-entity--expandable" : "")
                    }
                    onDragOver={onDragOverRow}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const d = parseTreeDrag(e);
                      if (!d) return;
                      const t = e.currentTarget as HTMLElement;
                      const pl = dropPlace(e, t);
                      if (d.kind === "set") return;
                      if (d.kind === "product") {
                        moveProductRelativeToAnchor(d.id, p.id, pl);
                      } else {
                        moveMaterialToProduct(d.id, p.id, pl === "before" ? "first" : "last");
                      }
                      refresh();
                    }}
                  >
                    <QuoteRowDragHandle
                      canDrag={canDrag("product", p.id)}
                      onDragStart={onDragStartRow("product", p.id)}
                    />
                    <TreeGutter
                      visible={pHasKids}
                      expanded={pOpen}
                      onToggle={() => {
                        setCollapsedP((prev) => {
                          const n = new Set(prev);
                          if (n.has(p.id)) n.delete(p.id);
                          else n.add(p.id);
                          return n;
                        });
                      }}
                    />
                    <EditableLead
                      tag="product"
                      quoteKind="product"
                      id={p.id}
                      name={p.name}
                      mainClassName="quote-qt-entity__main quote-qt-entity__main--prod"
                      editing={editing}
                      setEditing={setEditing}
                      inputRef={nameInputRef}
                      onCommit={commitName}
                      goEntity={goEntity}
                    />
                    <TreeRowActions
                      onCopy={() => dupProduct(p.id)}
                      onDelete={() => delProduct({ id: p.id, name: p.name })}
                    />
                  </div>
                  {pOpen && pHasKids ? (
                    <div className="quote-proj-tree quote-qt-mat-nest">
                      <span className="quote-proj-tree-rail" aria-hidden />
                      <ul className="quote-proj-tree-list">
                        {p.materials.map((m) => {
                          const mActive = isSel("material", m.id);
                          return (
                            <li
                              key={m.id}
                              className={"quote-qt-entity" + (mActive ? " quote-qt-entity--active" : "")}
                              onDragOver={onDragOverRow}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const d = parseTreeDrag(e);
                                if (!d) return;
                                const t = e.currentTarget as HTMLElement;
                                const pl = dropPlace(e, t);
                                if (d.kind === "set") return;
                                if (d.kind === "product") {
                                  moveProductRelativeToAnchor(d.id, p.id, pl);
                                } else {
                                  moveMaterialRelativeToAnchor(d.id, p.id, m.id, pl);
                                }
                                refresh();
                              }}
                            >
                              <QuoteRowDragHandle
                                canDrag={canDrag("material", m.id)}
                                onDragStart={onDragStartRow("material", m.id)}
                              />
                              <TreeGutter visible={false} />
                              <EditableLead
                                tag="material"
                                quoteKind="material"
                                id={m.id}
                                name={m.name}
                                mainClassName="quote-qt-entity__main quote-qt-entity__main--mat"
                                editing={editing}
                                setEditing={setEditing}
                                inputRef={nameInputRef}
                                onCommit={commitName}
                                goEntity={goEntity}
                              />
                              <TreeRowActions
                                onCopy={() => dupMaterial(m.id)}
                                onDelete={() => delMaterial(m.id, m.name)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              );
            })
          : null}
      </nav>
    </aside>
  );
}
