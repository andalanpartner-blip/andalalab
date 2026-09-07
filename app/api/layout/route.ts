import { NextResponse } from "next/server";
import { getEngineDeps, runLayoutRetargetPipeline } from "../../../services/pipeline.service";
import { requireActor, requirePermission } from "../../../lib/server/auth/guard";
import { checkRateLimit } from "../../../lib/server/rate-limit";

/**
 * Layout template retarget (P2.10 additive).
 *
 * Re-derives an existing design onto a different canonical layout and returns
 * a fresh recipe / blueprint / prompt. It does NOT generate an image, call the
 * vision loop, run a correction or record an approval — see
 * `runLayoutRetargetPipeline`. Shares the Node runtime + dataset loader with
 * /api/recipe.
 */
export const runtime = "nodejs";

type LayoutRequestBody = {
  readonly contract?: unknown;
  readonly direction?: unknown;
  readonly concept?: unknown;
  readonly parentRecipe?: unknown;
  readonly layoutId?: unknown;
  readonly promptLanguage?: "en" | "id";
};

export async function POST(request: Request): Promise<Response> {
  let body: LayoutRequestBody;
  try {
    body = (await request.json()) as LayoutRequestBody;
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "That request could not be read. Please try again." },
      { status: 400 }
    );
  }

  const gate = await requireActor(request);
  if (gate.denied) return gate.response;
  const perm = requirePermission(gate.actor, "workflow:run");
  if (perm.denied) return perm.response;
  if (!checkRateLimit(gate.actor.userId, "recipe", Date.now()).allowed) {
    return NextResponse.json({ status: "ERROR", message: "Give it a few seconds and try again." }, { status: 429 });
  }

  if (!body.contract || !body.direction || !body.parentRecipe || typeof body.layoutId !== "string") {
    return NextResponse.json(
      { status: "ERROR", message: "That layout change is incomplete. Please reopen the layout stage." },
      { status: 400 }
    );
  }

  try {
    const { datasets, ids, clock } = getEngineDeps();
    const result = runLayoutRetargetPipeline(
      { datasets, ids, clock },
      {
        contract: body.contract,
        direction: body.direction,
        concept: body.concept,
        parentRecipe: body.parentRecipe,
        layoutId: body.layoutId,
        promptLanguage: body.promptLanguage
      }
    );
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "Something went wrong on our end. Please try again." },
      { status: 500 }
    );
  }
}
