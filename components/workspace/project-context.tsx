"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The current project id, provided by the workspace shell so every stage's
 * `fetch("/api/...")` can include it. The SERVER still enforces membership —
 * this only carries the id, it grants nothing.
 */
const ProjectContext = createContext<string | null>(null);

export function ProjectProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  return <ProjectContext.Provider value={projectId}>{children}</ProjectContext.Provider>;
}

/** The current project id, or null when the workspace is mounted outside a project. */
export function useProjectId(): string | null {
  return useContext(ProjectContext);
}
