import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createNewProject as storeCreateProject,
  initializeProjectsState,
  persistActiveProjectId,
  setActiveStorageProjectId,
  updateProjectName as storeUpdateProjectName,
  type ProjectMeta,
} from "../offline/stores";

type Ctx = {
  projects: ProjectMeta[];
  activeProjectId: string;
  setActiveProjectId: (id: string) => void;
  addProject: () => void;
  renameProject: (id: string, name: string) => void;
};

const ProjectContext = createContext<Ctx | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => initializeProjectsState());

  const setActiveProjectId = useCallback((id: string) => {
    setActiveStorageProjectId(id);
    persistActiveProjectId(id);
    setState((s) => ({ ...s, activeId: id }));
  }, []);

  const addProject = useCallback(() => {
    const n = state.projects.length + 1;
    const p = storeCreateProject(`프로젝트 ${n}`);
    setState((s) => ({
      projects: [...s.projects, p],
      activeId: p.id,
    }));
    setActiveStorageProjectId(p.id);
    persistActiveProjectId(p.id);
  }, [state.projects.length]);

  const renameProject = useCallback((id: string, name: string) => {
    storeUpdateProjectName(id, name);
    setState((s) => ({
      ...s,
      projects: s.projects.map((x) => (x.id === id ? { ...x, name: name.trim() || x.name } : x)),
    }));
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      projects: state.projects,
      activeProjectId: state.activeId,
      setActiveProjectId,
      addProject,
      renameProject,
    }),
    [state.projects, state.activeId, setActiveProjectId, addProject, renameProject]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const c = useContext(ProjectContext);
  if (!c) throw new Error("useProject must be used within ProjectProvider");
  return c;
}
