import { NextResponse } from "next/server";
import { requireActor, requirePermission, requireProject } from "./guard";
import { can, type Permission } from "./rbac";
import { checkRateLimit } from "../rate-limit";
import { getStorage } from "../../../services/storage.service";
import { persistCostEvents } from "../../../services/usage.service";
import { recordProjectArtifact, type Project } from "../../../services/project.service";
import { newRequestId, logAi } from "../logger";
import { createCostLedger } from "../../../services/cost.service";
import { systemClock } from "../../../ports/clock.port";
import type { CostLedgerPort } from "../../../ports/cost.port";
import type { Actor } from "../../../services/team.service";

/**
 * Shared gate for the expensive AI routes (P2.20-G/M/Q).
 *
 * auth → permission → project membership → rate limit. Returns a per-request
 * cost ledger the caller passes into the service; `finish()` persists its
 * events (tagged with project + user), records an optional artifact-metadata
 * entry, and writes ONE structured log line. Secrets stay server-side; the
 * provider / model / hashes are derived by the service, never trusted from the
 * request body.
 */

export type AiRouteContext = {
  readonly actor: Actor;
  readonly project: Project;
  readonly requestId: string;
  readonly ledger: CostLedgerPort;
  finish(outcome: {
    operation: string;
    status: "ok" | "failed";
    provider?: string;
    model?: string;
    latencyMs?: number;
    failureCode?: string;
    artifact?: Parameters<typeof recordProjectArtifact>[3];
  }): Promise<void>;
};

export async function openAiRoute(
  request: Request,
  opts: { permission: Permission; route: string; projectId: unknown }
): Promise<{ denied: true; response: Response } | { denied: false; ctx: AiRouteContext }> {
  const gate = await requireActor(request);
  if (gate.denied) return { denied: true, response: gate.response };

  const perm = requirePermission(gate.actor, opts.permission);
  if (perm.denied) return { denied: true, response: perm.response };

  const proj = await requireProject(gate.actor, typeof opts.projectId === "string" ? opts.projectId : null);
  if (proj.denied) {
    logAi({ request_id: newRequestId(), user_id: gate.actor.userId, operation: opts.route, status: "denied", failure_code: "project" });
    return { denied: true, response: proj.response };
  }

  const rl = checkRateLimit(`${gate.actor.userId}`, opts.route, Date.now());
  if (!rl.allowed) {
    const res = NextResponse.json(
      { status: "ERROR", message: "You're going a bit fast — give it a few seconds." },
      { status: 429 }
    );
    res.headers.set("Retry-After", String(rl.retryAfterSeconds));
    logAi({ request_id: newRequestId(), user_id: gate.actor.userId, project_id: proj.project.id, operation: opts.route, status: "denied", failure_code: "rate_limited" });
    return { denied: true, response: res };
  }

  const requestId = newRequestId();
  const ledger = createCostLedger({ clock: systemClock });
  const store = getStorage();
  const actor = gate.actor;
  const project = proj.project;

  return {
    denied: false,
    ctx: {
      actor,
      project,
      requestId,
      ledger,
      async finish(outcome) {
        try {
          await persistCostEvents(
            store,
            { workspaceId: actor.workspaceId, projectId: project.id, userId: actor.userId },
            ledger.list()
          );
          if (outcome.artifact) {
            await recordProjectArtifact(store, actor, project.id, outcome.artifact);
          }
        } catch {
          /* persistence best-effort — never fail the response on a logging write */
        }
        logAi({
          request_id: requestId,
          user_id: actor.userId,
          project_id: project.id,
          operation: outcome.operation,
          provider: outcome.provider,
          model: outcome.model,
          latency_ms: outcome.latencyMs,
          estimated_cost_usd: ledger.totalUsd(),
          status: outcome.status,
          failure_code: outcome.failureCode
        });
      }
    }
  };
}

export function isWorkflowPermission(role: Actor["role"]): boolean {
  return can(role, "workflow:run");
}
