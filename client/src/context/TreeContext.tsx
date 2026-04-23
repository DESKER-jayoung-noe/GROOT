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
    return saved.length > 0 ? ensureIds(saved) : [...TREE_DEMO_INITIAL];
  });
  const [activeItem, setActiveItem] = useState<number>(4);
  const [lastSavedAt, setLastSavedAt] = useState(0);

  // Reload tree when project switches
  useEffect(() => {
    if (!activeProjectId) return;
    isLoadingRef.current = true;
    const saved = getBomTree(activeProjectId);
    setTreeNodes(saved.length > 0 ? ensureIds(saved) : ensureIds([...DEMO_NODES]));
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
