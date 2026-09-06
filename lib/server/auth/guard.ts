import { NextResponse } from "next/server";
import { readSession, SESSION_COOKIE } from "./session";
import { can, type Permission } from "./rbac";
import { getStorage } from "../../../services/storage.service";
import { actorFromSession, type Actor } from "../../../services/team.service";
import { requireProjectAccess, AccessError, type Project } from "../../../services/project.service";

/**
 * Server-side auth / authorization gate for API routes (P2.20-B/C/F/G).
 *
 * Every protected route calls `requireActor` (401 without a valid session),
 * then `requirePermission` / `requireProject` as needed. Failures return a
 * sanitized JSON error — never a stack trace.
 */

function cookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export type Denied = { readonly denied: true; readonly response: Response };
export type Allowed<T> = { readonly denied: false } & T;

const deny = (status: number, message: string): Denied => ({
  denied: true,
  response: NextResponse.json({ status: "ERROR", message }, { status })
});

/** The current authenticated team member, or a 401 response. */
export async function requireActor(request: Request): Promise<Denied | Allowed<{ actor: Actor }>> {
  const session = readSession(cookie(request, SESSION_COOKIE));
  if (!session) return deny(401, "Sign in to continue.");
  const actor = await actorFromSession(getStorage(), session.uid);
  if (!actor || actor.role !== session.role) return deny(401, "Your session is no longer valid. Sign in again.");
  return { denied: false, actor };
}

export function requirePermission(actor: Actor, permission: Permission): Denied | Allowed<Record<never, never>> {
  if (!can(actor.role, permission)) return deny(403, "You do not have permission to do that.");
  return { denied: false };
}

/** The project, only if `actor` is a member (or admin). */
export async function requireProject(
  actor: Actor,
  projectId: string | undefined | null
): Promise<Denied | Allowed<{ project: Project }>> {
  if (!projectId || typeof projectId !== "string") return deny(400, "A project is required.");
  try {
    const project = await requireProjectAccess(getStorage(), actor, projectId);
    return { denied: false, project };
  } catch (error) {
    if (error instanceof AccessError) return deny(error.status, "Project not found.");
    return deny(500, "Something went wrong.");
  }
}
