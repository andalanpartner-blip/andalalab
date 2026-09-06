/**
 * Server-side role model (P2.20-C).
 *
 * Three roles for the internal Andala Creative team. Permissions are checked on
 * the server, never by hiding UI controls.
 */

export const ROLES = ["admin", "designer", "account"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export type Permission =
  | "project:create"
  | "project:read"
  | "brief:create"
  | "workflow:run" // generate / evidence / critique / correction
  | "decision:approve"
  | "final:view"
  | "team:manage"
  | "usage:view"
  | "settings:manage";

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    "project:create",
    "project:read",
    "brief:create",
    "workflow:run",
    "decision:approve",
    "final:view",
    "team:manage",
    "usage:view",
    "settings:manage"
  ]),
  designer: new Set<Permission>([
    "project:read",
    "brief:create",
    "workflow:run",
    "decision:approve",
    "final:view"
  ]),
  account: new Set<Permission>(["project:create", "project:read", "brief:create", "final:view"])
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.has(permission) ?? false;
}

/** Capabilities normal users must never have exposed. */
export const RESTRICTED_TO_ADMIN: readonly Permission[] = [
  "team:manage",
  "usage:view",
  "settings:manage"
];
