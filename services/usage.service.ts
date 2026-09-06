import { randomUUID } from "node:crypto";
import type { StoragePort } from "../ports/storage.port";
import { COLLECTIONS } from "../ports/storage.port";
import type { CostEvent } from "../ports/cost.port";
import type { Actor } from "./team.service";
import { can } from "../lib/server/auth/rbac";
import { AccessError } from "./project.service";

/**
 * Cost / usage tracking for the internal admin view (P2.20-H).
 *
 * The AUTHORITATIVE per-call accounting still happens in the cost ledger inside
 * each adapter (unchanged). This layer PERSISTS a copy of every booked event,
 * tagged with the project + user, so an admin can see spend by project and by
 * user. It is a control view, not a BI dashboard.
 */

export type StoredCostEvent = {
  id: string;
  workspace_id: string;
  project_id: string;
  user_id: string;
  stage: string;
  provider: string;
  model: string;
  estimated_cost_usd: number;
  status: "ok" | "repaired" | "failed";
  created_at: string;
};

export async function persistCostEvents(
  store: StoragePort,
  context: { workspaceId: string; projectId: string; userId: string },
  events: readonly CostEvent[]
): Promise<void> {
  for (const event of events) {
    await store.create<StoredCostEvent>(COLLECTIONS.costEvents, {
      id: `cost_${randomUUID()}`,
      workspace_id: context.workspaceId,
      project_id: context.projectId,
      user_id: context.userId,
      stage: event.stage,
      provider: event.provider,
      model: event.model_id,
      estimated_cost_usd: event.estimated_cost_usd,
      status: event.status,
      created_at: event.created_at
    });
  }
}

export type UsageSummary = {
  generation_count: number;
  evidence_count: number;
  failed_count: number;
  estimated_spend_usd: number;
  by_project: { project_id: string; spend_usd: number; calls: number }[];
  by_user: { user_id: string; spend_usd: number; calls: number }[];
};

export async function usageSummary(store: StoragePort, actor: Actor): Promise<UsageSummary> {
  if (!can(actor.role, "usage:view")) throw new AccessError("usage is admin-only");
  const events = await store.query<StoredCostEvent>(COLLECTIONS.costEvents, {
    workspace_id: actor.workspaceId
  });

  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
  const byProject = new Map<string, { spend: number; calls: number }>();
  const byUser = new Map<string, { spend: number; calls: number }>();
  let generation = 0;
  let evidence = 0;
  let failed = 0;
  let spend = 0;

  for (const e of events) {
    spend += e.estimated_cost_usd;
    if (e.stage === "visual_generate") generation += 1;
    if (e.stage === "visual_evidence") evidence += 1;
    if (e.status === "failed") failed += 1;
    const p = byProject.get(e.project_id) ?? { spend: 0, calls: 0 };
    byProject.set(e.project_id, { spend: p.spend + e.estimated_cost_usd, calls: p.calls + 1 });
    const u = byUser.get(e.user_id) ?? { spend: 0, calls: 0 };
    byUser.set(e.user_id, { spend: u.spend + e.estimated_cost_usd, calls: u.calls + 1 });
  }

  return {
    generation_count: generation,
    evidence_count: evidence,
    failed_count: failed,
    estimated_spend_usd: round(spend),
    by_project: [...byProject.entries()]
      .map(([project_id, v]) => ({ project_id, spend_usd: round(v.spend), calls: v.calls }))
      .sort((a, b) => b.spend_usd - a.spend_usd),
    by_user: [...byUser.entries()]
      .map(([user_id, v]) => ({ user_id, spend_usd: round(v.spend), calls: v.calls }))
      .sort((a, b) => b.spend_usd - a.spend_usd)
  };
}
