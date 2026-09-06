import { randomUUID } from "node:crypto";
import type { StoragePort } from "../ports/storage.port";
import { COLLECTIONS } from "../ports/storage.port";
import { ANDALA_WORKSPACE_ID, type Actor } from "./team.service";
import { can } from "../lib/server/auth/rbac";

/**
 * Project model + isolation (P2.20-E / P2.20-F).
 *
 * A Project belongs to the one Andala workspace and has an owner + a set of
 * members. Every read / write is checked against membership on the SERVER —
 * `requireProjectAccess` is the single gate.
 *
 * Project state references immutable artifact METADATA (hashes, ids, small
 * records), never image bytes.
 */

export type ProjectStatus = "brief" | "in_progress" | "in_review" | "approved" | "archived";

export type Project = {
  id: string;
  workspace_id: string;
  name: string;
  brand: string | null;
  owner_id: string;
  member_ids: string[];
  status: ProjectStatus;
  /** Latest design hashes for a quick freshness view. Metadata only. */
  latest: {
    recipe_hash: string | null;
    blueprint_hash: string | null;
    prompt_hash: string | null;
    generation_count: number;
    approved_artifact_hash: string | null;
  };
  created_at: string;
  updated_at: string;
};

/** An immutable artifact-metadata record kept for a project's lineage / history. */
export type ProjectArtifact = {
  id: string;
  project_id: string;
  kind: "recipe" | "blueprint" | "generation" | "evidence" | "critique" | "recommendation" | "cycle" | "decision" | "final";
  hash: string;
  parent_hash: string | null;
  /** A small JSON summary — never image bytes. */
  summary: Record<string, unknown>;
  created_by: string;
  created_at: string;
};

const now = () => new Date().toISOString();

export async function createProject(
  store: StoragePort,
  actor: Actor,
  input: { name: string; brand?: string | null }
): Promise<Project> {
  if (!can(actor.role, "project:create")) throw new AccessError("not permitted to create a project");
  const name = input.name.trim();
  if (name.length === 0) throw new Error("project name is required");
  const project: Project = {
    id: `prj_${randomUUID()}`,
    workspace_id: ANDALA_WORKSPACE_ID,
    name,
    brand: input.brand?.trim() || null,
    owner_id: actor.userId,
    member_ids: [actor.userId],
    status: "brief",
    latest: {
      recipe_hash: null,
      blueprint_hash: null,
      prompt_hash: null,
      generation_count: 0,
      approved_artifact_hash: null
    },
    created_at: now(),
    updated_at: now()
  };
  return store.create<Project>(COLLECTIONS.projects, project);
}

export class AccessError extends Error {
  readonly status = 403;
  constructor(message = "you do not have access to this project") {
    super(message);
    this.name = "AccessError";
  }
}

/**
 * The single server-side project gate. Returns the project only when `actor` is
 * a member (or an admin). Never trusts a project id from the client without
 * this check — read, generate, evidence, correction, approve and cost all use
 * it.
 */
export async function requireProjectAccess(
  store: StoragePort,
  actor: Actor,
  projectId: string
): Promise<Project> {
  const project = await store.get<Project>(COLLECTIONS.projects, projectId);
  if (!project || project.workspace_id !== actor.workspaceId) {
    throw new AccessError("project not found");
  }
  const isMember = project.member_ids.includes(actor.userId) || project.owner_id === actor.userId;
  if (!isMember && actor.role !== "admin") {
    throw new AccessError();
  }
  return project;
}

export async function listProjectsForActor(store: StoragePort, actor: Actor): Promise<Project[]> {
  const all = await store.query<Project>(COLLECTIONS.projects, { workspace_id: actor.workspaceId });
  if (actor.role === "admin") return all.sort(byUpdatedDesc);
  return all.filter((p) => p.member_ids.includes(actor.userId) || p.owner_id === actor.userId).sort(byUpdatedDesc);
}

const byUpdatedDesc = (a: Project, b: Project) => b.updated_at.localeCompare(a.updated_at);

export async function addMember(
  store: StoragePort,
  actor: Actor,
  projectId: string,
  userId: string
): Promise<Project> {
  const project = await requireProjectAccess(store, actor, projectId);
  if (project.owner_id !== actor.userId && actor.role !== "admin") {
    throw new AccessError("only the owner or an admin can add members");
  }
  if (project.member_ids.includes(userId)) return project;
  const next = { ...project, member_ids: [...project.member_ids, userId], updated_at: now() };
  return store.put<Project>(COLLECTIONS.projects, next);
}

/** Record an immutable artifact-metadata entry + advance the project's `latest`. */
export async function recordProjectArtifact(
  store: StoragePort,
  actor: Actor,
  projectId: string,
  entry: Omit<ProjectArtifact, "id" | "project_id" | "created_by" | "created_at">
): Promise<ProjectArtifact> {
  const project = await requireProjectAccess(store, actor, projectId);
  const record = await store.create<ProjectArtifact>(COLLECTIONS.artifacts, {
    id: `art_${randomUUID()}`,
    project_id: projectId,
    created_by: actor.userId,
    created_at: now(),
    ...entry
  });

  const latest = { ...project.latest };
  if (entry.kind === "recipe") latest.recipe_hash = entry.hash;
  if (entry.kind === "blueprint") latest.blueprint_hash = entry.hash;
  if (entry.kind === "generation") {
    latest.generation_count += 1;
    if (typeof entry.summary["prompt_hash"] === "string") latest.prompt_hash = entry.summary["prompt_hash"] as string;
  }
  let status: ProjectStatus = project.status;
  if (entry.kind === "generation") status = "in_review";
  if (entry.kind === "recipe" && project.status === "brief") status = "in_progress";
  const approvedDecision =
    entry.kind === "final" ||
    (entry.kind === "decision" && entry.summary["action"] === "approved");
  if (approvedDecision) {
    latest.approved_artifact_hash =
      typeof entry.summary["artifact_hash"] === "string"
        ? (entry.summary["artifact_hash"] as string)
        : entry.parent_hash ?? entry.hash;
    status = "approved";
  }
  await store.put<Project>(COLLECTIONS.projects, { ...project, latest, status, updated_at: now() });
  return record;
}

export async function projectHistory(store: StoragePort, actor: Actor, projectId: string): Promise<ProjectArtifact[]> {
  await requireProjectAccess(store, actor, projectId);
  const rows = await store.query<ProjectArtifact>(COLLECTIONS.artifacts, { project_id: projectId });
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
}
