import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useProject } from "./ProjectContext";
import {
  getActiveStorageProjectId,
  getBomTree,
  putBomTree,
  type BomMaterialData,
} from "../offline/stores";
import { newId } from "../offline/stores";

export type TreeNodeType = "mat" | "item" | "set" | "divider";

export interface TreeNode {
  id?: string;
  type: TreeNodeType;
  name?: string;
  depth?: number;
  data?: BomMaterialData;
}

const DEMO_NODES: Omit<TreeNode, "id">[] = [
  { type: "mat", name: "이름 없음", depth: 0 },
  { type: "mat", name: "이름 없음", depth: 0 },
  { type: "divider" },
  { type: "set", name: "이름 없음", depth: 0 },
  { type: "item", name: "이름 없음", depth: 0 },
  { type: "mat", name: "이름 없음", depth: 1 },
  { type: "mat", name: "뒷판 A", depth: 1 },
  { type: "mat", name: "이름 없음", depth: 1 },
  { type: "divider" },
  { type: "set", name: "이름 없음", depth: 0 },
  { type: "item", name: "이름 없음", depth: 0 },
];

export const TREE_DEMO_INITIAL: TreeNode[] = DEMO_NODES.map((n) => ({
  ...n,
  id: newId("node"),
}));

function ensureIds(nodes: unknown[]): TreeNode[] {
  return (nodes as TreeNode[]).map((n) => ({
    ...n,
    id: n.id ?? newId("node"),
  }));
}

type Ctx = {
  treeNodes: TreeNode[];
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
  activeItem: number;
  setActiveItem: (idx: number) => void;
  lastSavedAt: number;
  updateNodeData: (nodeId: string, data: BomMaterialData) => void;
};

const TreeContext = createContext<Ctx | null>(null);

export function TreeProvider({ children }: { children: ReactNode }) {
  const { activeProjectId } = useProject();
  const isLoadingRef = useRef(true);
  const activePidRef = useRef(activeProjectId);
  activePidRef.current = activeProjectId;

  const [treeNodes, setTreeNodes] = useState<TreeNode[]>(() => {
    const pid = getActiveStorageProjectId();
    const saved = pid ? getBomTree(pid) : [];
    const initial = saved.length > 0 ? ensureIds(saved) : [...TREE_DEMO_INITIAL];
    // PR1 마이그레이션 — "단품 (미분류)" placeholder 제거
    return migrateRemoveUnclassifiedPlaceholders(initial).nodes;
  });
  const [activeItem, setActiveItem] = useState<number>(4);
  const [lastSavedAt, setLastSavedAt] = useState(0);

  // Reload tree when project switches
  useEffect(() => {
    if (!activeProjectId) return;
    isLoadingRef.current = true;
    const saved = getBomTree(activeProjectId);
    const base = saved.length > 0 ? ensureIds(saved) : ensureIds([...DEMO_NODES]);
    setTreeNodes(migrateRemoveUnclassifiedPlaceholders(base).nodes);
    setActiveItem(0);
  }, [activeProjectId]);

  // Save tree on change (skip loads)
  useEffect(() => {
    if (isLoadingRef.current) {
      isLoadingRef.current = false;
      return;
    }
    const pid = activePidRef.current;
    if (!pid) return;
    putBomTree(pid, treeNodes);
    setLastSavedAt(Date.now());
  }, [treeNodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateNodeData = (nodeId: string, data: BomMaterialData) => {
    setTreeNodes((nodes) =>
      nodes.map((n) => (n.id === nodeId ? { ...n, data } : n))
    );
  };

  return (
    <TreeContext.Provider
      value={{ treeNodes, setTreeNodes, activeItem, setActiveItem, lastSavedAt, updateNodeData }}
    >
      {children}
    </TreeContext.Provider>
  );
}

export function useTree() {
  const c = useContext(TreeContext);
  if (!c) throw new Error("useTree must be used within TreeProvider");
  return c;
}

/** Returns mat nodes directly under the item at itemIdx (depth > item's depth). */
export function getMaterialsForItem(nodes: TreeNode[], itemIdx: number): TreeNode[] {
  if (itemIdx < 0 || itemIdx >= nodes.length) return [];
  const item = nodes[itemIdx];
  if (!item || item.type !== "item") return [];
  const itemDepth = item.depth ?? 0;
  const result: TreeNode[] = [];
  for (let i = itemIdx + 1; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === "divider") break;
    if (n.type !== "mat" || (n.depth ?? 0) <= itemDepth) break;
    result.push(n);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// PR1 — 트리 단일 진실 헬퍼 / 자재 풀 / 자재 이동
// ─────────────────────────────────────────────────────────────

/** partId 로 단품의 자재 노드 목록 (트리상 단품 자식 mat) */
export function getMaterialsForPart(nodes: TreeNode[], partId: string): TreeNode[] {
  const idx = nodes.findIndex((n) => n.id === partId && n.type === "item");
  return getMaterialsForItem(nodes, idx);
}

/**
 * 자재 풀 = 어떤 단품(item)에도 속하지 않는 mat 노드들.
 * @param setIdx set 노드 인덱스 (없으면 -1 — 트리 전체에서 풀 mat 찾음)
 */
export function getMaterialsInPool(nodes: TreeNode[], setIdx: number): TreeNode[] {
  const start = setIdx < 0 ? 0 : setIdx + 1;
  const result: TreeNode[] = [];
  let inItem = false;
  let itemDepth = -1;
  for (let i = start; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === "divider") break;
    if (n.type === "set") break;
    if (n.type === "item") {
      inItem = true;
      itemDepth = n.depth ?? 0;
      continue;
    }
    if (n.type === "mat") {
      if (inItem && (n.depth ?? 0) > itemDepth) continue; // 단품 자식 → skip
      result.push(n);
    }
  }
  return result;
}

/**
 * mat 노드를 다른 단품으로 이동. targetPartId=null 이면 자재 풀로.
 * 트리 노드 배열을 새로 반환 (immutable).
 */
export function moveMaterialToPart(nodes: TreeNode[], materialId: string, targetPartId: string | null): TreeNode[] {
  const matIdx = nodes.findIndex((n) => n.id === materialId && n.type === "mat");
  if (matIdx < 0) return nodes;
  const matNode = nodes[matIdx];
  const without = [...nodes.slice(0, matIdx), ...nodes.slice(matIdx + 1)];

  if (targetPartId === null) {
    // 자재 풀로 — 가장 가까운 set 노드 직후에 삽입 (item 거치지 않게)
    const setIdx = without.findIndex((n) => n.type === "set");
    if (setIdx < 0) {
      return [...without, { ...matNode, depth: 0 }];
    }
    return [
      ...without.slice(0, setIdx + 1),
      { ...matNode, depth: 1 },
      ...without.slice(setIdx + 1),
    ];
  }

  // 특정 단품 자식 그룹 끝에 삽입
  const partIdx = without.findIndex((n) => n.id === targetPartId && n.type === "item");
  if (partIdx < 0) return nodes;
  const partDepth = without[partIdx].depth ?? 0;
  let insertAt = partIdx + 1;
  while (insertAt < without.length) {
    const n = without[insertAt];
    if (n.type === "divider" || n.type === "set" || n.type === "item") break;
    if (n.type === "mat" && (n.depth ?? 0) > partDepth) {
      insertAt++;
      continue;
    }
    break;
  }
  return [
    ...without.slice(0, insertAt),
    { ...matNode, depth: partDepth + 1 },
    ...without.slice(insertAt),
  ];
}

/**
 * 마이그레이션 — 기존 "단품 (미분류)" placeholder item 을 트리에서 제거.
 * 그 자식이었던 mat 들은 자동으로 set 직속(자재 풀) 이 됨.
 * 같은 트리에 미분류 item 이 여러 개 있어도 모두 처리.
 */
export function migrateRemoveUnclassifiedPlaceholders(nodes: TreeNode[]): { nodes: TreeNode[]; removedCount: number } {
  const out: TreeNode[] = [];
  let removed = 0;
  for (const n of nodes) {
    if (n.type === "item" && typeof n.name === "string" && n.name.includes("미분류")) {
      // placeholder 제거 — 자식 mat 들은 그대로 (다음 노드들이 그대로 따라옴)
      removed++;
      continue;
    }
    out.push(n);
  }
  // 제거 후 mat depth 정규화: 더 이상 단품 자식이 아닌 mat 의 depth 를 1 로 (set 직속)
  // — 자재 풀 mat 임을 트리상 명확히
  let curSetDepth = -1;
  let inItem = false;
  let itemDepth = -1;
  const normalized = out.map((n) => {
    if (n.type === "set") {
      curSetDepth = n.depth ?? 0;
      inItem = false;
      return n;
    }
    if (n.type === "divider") {
      inItem = false;
      return n;
    }
    if (n.type === "item") {
      inItem = true;
      itemDepth = n.depth ?? 0;
      return n;
    }
    if (n.type === "mat") {
      if (inItem && (n.depth ?? 0) > itemDepth) return n; // 단품 자식 그대로
      // 자재 풀 — set 직속 depth=1 로 통일
      return { ...n, depth: curSetDepth >= 0 ? curSetDepth + 1 : 0 };
    }
    return n;
  });
  return { nodes: normalized, removedCount: removed };
}
