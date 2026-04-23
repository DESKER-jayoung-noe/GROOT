import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createNewGroup as storeCreateGroup,
  createNewProject as storeCreateProject,
  deleteGroupById,
  deleteProjectById,
  duplicateGroupById,
  duplicateProjectById,
  initializeProjectsState,
  loadProjectsMeta,
  persistActiveProjectId,
  persistProjectGroups,
  persistProjectTree,
  readProjectTreeState,
  saveGrootProjects,
  setActiveStorageProjectId,
  updateGroupName as storeUpdateGroupName,
  updateProjectName as storeUpdateProjectName,
  type ProjectMeta,
  type ProjectTreeGroup,
  type ProjectTreeState,
} from "../offline/stores";

type Ctx = {
  projects: ProjectMeta[];
  groups: ProjectTreeGroup[];
  ungroupedProjectIds: string[];
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  addProject: (groupId?: string | null) => ProjectMeta | null;
  addGroup: (name?: string) => void;
  renameProject: (id: string, name: string) => void;
  renameGroup: (id: string, name: string) => void;
  setGroupsOrder: (groups: ProjectTreeGroup[]) => void;
  setProjectTree: (state: ProjectTreeState) => void;
  duplicateProject: (id: string) => void;
  deleteProject: (id: string) => void;
  duplicateGroup: (id: string) => void;
  deleteGroup: (id: string) => void;
};

const ProjectContext = createContext<Ctx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => initializeProjectsState());

  const setActiveProjectId = useCallback((id: string) => {
    setActiveStorageProjectId(id);
    persistActiveProjectId(id);
    setState((s) => ({ ...s, activeId: id }));
  }, []);

  const addProject = useCallback((groupId?: string | null): ProjectMeta | null => {
    let created: ProjectMeta | null = null;
    setState((s) => {
      const n = s.projects.length + 1;
      const p = storeCreateProject(`프로젝트 ${n}`, groupId != null && groupId !== "" ? groupId : null);
      created = p;
      setActiveStorageProjectId(p.id);
      persistActiveProjectId(p.id);
      const tree = readProjectTreeState();
      return {
        ...s,
        projects: [...s.projects, p],
        groups: tree.groups,
        ungroupedProjectIds: tree.ungroupedProjectIds,
        activeId: p.id,
      };
    });
    return created;
  }, []);

  const addGroup = useCallback((name?: string) => {
    setState((s) => {
      storeCreateGroup(name ?? `그룹 ${countRootGroups(s.groups) + 1}`);
      const tree = readProjectTreeState();
      return { ...s, groups: tree.groups, ungroupedProjectIds: tree.ungroupedProjectIds };
    });
  }, []);

  const renameProject = useCallback((id: string, name: string) => {
    storeUpdateProjectName(id, name);
    setState((s) => ({
      ...s,
      projects: s.projects.map((x) => (x.id === id ? { ...x, name: name.trim() || x.name } : x)),
    }));
  }, []);

  const renameGroup = useCallback((id: string, name: string) => {
    storeUpdateGroupName(id, name);
    const tree = readProjectTreeState();
    setState((s) => ({ ...s, groups: tree.groups, ungroupedProjectIds: tree.ungroupedProjectIds }));
  }, []);

  const setGroupsOrder = useCallback((groups: ProjectTreeGroup[]) => {
    const r = persistProjectGroups(groups);
    setState((s) => ({ ...s, groups: r.groups, ungroupedProjectIds: r.ungroupedProjectIds }));
  }, []);

  const setProjectTree = useCallback((next: ProjectTreeState) => {
    const r = persistProjectTree(next);
    setState((s) => ({ ...s, groups: r.groups, ungroupedProjectIds: r.ungroupedProjectIds }));
  }, []);

  const duplicateProject = useCallback((id: string) => {
    const r = duplicateProjectById(id);
    if (!r) return;
    setActiveStorageProjectId(r.newMeta.id);
    persistActiveProjectId(r.newMeta.id);
    setState((s) => ({
      ...s,
      projects: r.projects,
      groups: r.groups,
      activeId: r.newMeta.id,
    }));
  }, []);

  const deleteProject = useCallback((id: string) => {
    const r = deleteProjectById(id);
    setState((s) => ({
      ...s,
      projects: r.projects,
      groups: r.groups,
      ungroupedProjectIds: r.ungroupedProjectIds,
      activeId: r.activeId,
    }));
  }, []);

  const duplicateGroup = useCallback((id: string) => {
    const next = duplicateGroupById(id);
    if (!next) return;
    setState((s) => ({
      ...s,
      groups: next,
      projects: loadProjectsMeta(),
    }));
  }, []);

  const deleteGroup = useCallback((id: string) => {
    const r = deleteGroupById(id);
    if (!r) return;
    setState((s) => ({
      ...s,
      projects: r.projects,
      groups: r.groups,
      ungroupedProjectIds: r.ungroupedProjectIds,
      activeId: r.activeId,
    }));
  }, []);

  // Sync to groot_projects whenever project state changes
  useEffect(() => {
    const groups = state.groups.map((g) => ({
      id: g.id,
      name: g.name,
      projects: g.projectIds
        .map((pid) => state.projects.find((p) => p.id === pid))
        .filter((p): p is ProjectMeta => p != null)
        .map((p) => ({ id: p.id, name: p.name })),
    }));
    const ungroupedInDefault = state.ungroupedProjectIds
      .map((pid) => state.projects.find((p) => p.id === pid))
      .filter((p): p is ProjectMeta => p != null)
      .map((p) => ({ id: p.id, name: p.name }));
    if (ungroupedInDefault.length > 0) {
      groups.unshift({ id: "__ungrouped__", name: "미분류", projects: ungroupedInDefault });
    }
    saveGrootProjects({ currentProjectId: state.activeId, groups });
  }, [state.projects, state.groups, state.ungroupedProjectIds, state.activeId]);

  const value = useMemo<Ctx>(
    () => ({
      projects: state.projects,
      groups: state.groups,
      ungroupedProjectIds: state.ungroupedProjectIds,
      activeProjectId: state.activeId,
      setActiveProjectId,
      addProject,
      addGroup,
      renameProject,
      renameGroup,
      setGroupsOrder,
      setProjectTree,
      duplicateProject,
      deleteProject,
      duplicateGroup,
      deleteGroup,
    }),
    [
      state.projects,
      state.groups,
      state.ungroupedProjectIds,
      state.activeId,
      setActiveProjectId,
      addProject,
      addGroup,
      renameProject,
      renameGroup,
      setGroupsOrder,
      setProjectTree,
      duplicateProject,
      deleteProject,
      duplicateGroup,
      deleteGroup,
    ]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

function countRootGroups(groups: ProjectTreeGroup[]): number {
  return groups.length;
}

export function useProject() {
  const c = useContext(ProjectContext);
  if (!c) throw new Error("useProject must be used within ProjectProvider");
  return c;
}
