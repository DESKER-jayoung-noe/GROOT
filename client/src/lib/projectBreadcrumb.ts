import type { ProjectMeta, ProjectTreeGroup } from "../offline/stores";

/**
 * 프로젝트가 속한 그룹 경로(루트 → 직접 부모).
 * 그룹 밖(ungrouped)이면 빈 배열, 트리에 없으면 빈 배열(이름만 표시).
 */
export function getProjectGroupPath(
  projectId: string,
  ungroupedProjectIds: string[],
  groups: ProjectTreeGroup[]
): string[] {
  if (ungroupedProjectIds.includes(projectId)) {
    return [];
  }
  function search(nodes: ProjectTreeGroup[], ancestors: string[]): string[] | null {
    for (const g of nodes) {
      if (g.projectIds.includes(projectId)) {
        return [...ancestors, g.name];
      }
      const ch = g.groups ?? [];
      if (ch.length) {
        const sub = search(ch, [...ancestors, g.name]);
        if (sub) return sub;
      }
    }
    return null;
  }
  return search(groups, []) ?? [];
}

export function getProjectBreadcrumb(
  projectId: string,
  projects: ProjectMeta[],
  ungroupedProjectIds: string[],
  groups: ProjectTreeGroup[]
): { groupNames: string[]; projectName: string } | null {
  const meta = projects.find((p) => p.id === projectId);
  if (!meta) return null;
  const groupNames = getProjectGroupPath(projectId, ungroupedProjectIds, groups);
  const projectName = meta.name?.trim() || meta.name;
  return { groupNames, projectName };
}
