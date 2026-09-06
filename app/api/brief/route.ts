import { NextResponse } from "next/server";
import { getEngineDeps, runBriefPipeline } from "../../../services/pipeline.service";
import { requireActor, requirePermission } from "../../../lib/server/auth/guard";
import { checkRateLimit } from "../../../lib/server/rate-limit";

/** Node.js runtime: the dataset loader reads from disk. */
export const runtime = "nodejs";

type BriefRequestBody = {
  readonly rawBrief?: unknown;
  readonly answers?: unknown;
};

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
}

export async function POST(request: Request): Promise<Response> {
  let body: BriefRequestBody;
  try {
    body = (await request.json()) as BriefRequestBody;
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "That request could not be read. Please try again." },
      { status: 400 }
    );
  }

  const gate = await requireActor(request);
  if (gate.denied) return gate.response;
  const perm = requirePermission(gate.actor, "brief:create");
  if (perm.denied) return perm.response;
  if (!checkRateLimit(gate.actor.userId, "brief", Date.now()).allowed) {
    return NextResponse.json({ status: "ERROR", message: "Give it a few seconds and try again." }, { status: 429 });
  }

  const rawBrief = typeof body.rawBrief === "string" ? body.rawBrief : "";
  if (rawBrief.trim().length === 0) {
    return NextResponse.json(
      { status: "ERROR", message: "Please describe what you'd like designed." },
      { status: 400 }
    );
  }

  const answers = isStringRecord(body.answers) ? body.answers : undefined;

  try {
    const result = await runBriefPipeline(getEngineDeps(), { rawBrief, answers });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { status: "ERROR", message: "Something went wrong on our end. Please try again." },
      { status: 500 }
    );
  }
}
