"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Workspace } from "../../../components/workspace/Workspace";

/**
 * The creative workspace, scoped to one project (P2.20-I). Auth is enforced by
 * middleware + the API routes; this page confirms membership before mounting.
 */
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
      if (cancelled) return;
      if (res.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(`/project/${id}`)}`);
        return;
      }
      setState(res.ok ? "ok" : "denied");
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  if (state === "loading") {
    return <main style={{ padding: 32, color: "#6b6459" }}>Loading project…</main>;
  }
  if (state === "denied") {
    return (
      <main style={{ padding: 32 }}>
        <p style={{ color: "#6b6459" }}>You do not have access to this project.</p>
        <a href="/dashboard" style={{ color: "#1c1a15" }}>Back to projects</a>
      </main>
    );
  }
  return <Workspace projectId={id} />;
}
