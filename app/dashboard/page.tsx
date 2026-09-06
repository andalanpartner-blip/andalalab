"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./dashboard.module.css";

type Me = { id: string; name: string; email: string; role: "admin" | "designer" | "account" };
type Project = {
  id: string;
  name: string;
  brand: string | null;
  status: string;
  updated_at: string;
  latest: { generation_count: number; approved_artifact_hash: string | null };
};
type Usage = {
  generation_count: number;
  evidence_count: number;
  failed_count: number;
  estimated_spend_usd: number;
  by_project: { project_id: string; spend_usd: number; calls: number }[];
  by_user: { user_id: string; spend_usd: number; calls: number }[];
};

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const meRes = await fetch("/api/auth/me");
    if (meRes.status === 401) {
      router.replace("/login");
      return;
    }
    const meData = (await meRes.json()) as { user: Me };
    setMe(meData.user);

    const pRes = await fetch("/api/projects");
    const pData = (await pRes.json()) as { projects: Project[] };
    setProjects(pData.projects ?? []);

    if (meData.user.role === "admin") {
      const uRes = await fetch("/api/admin/usage");
      if (uRes.ok) setUsage(((await uRes.json()) as { summary: Usage }).summary);
    }
    setLoaded(true);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const canCreate = me?.role === "admin" || me?.role === "account";

  async function createProject(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, brand: brand || null })
      });
      const data = (await res.json()) as { status: string; project?: Project; message?: string };
      if (data.status === "OK" && data.project) {
        setName("");
        setBrand("");
        setProjects((prev) => [data.project!, ...prev]);
      } else {
        setError(data.message ?? "Could not create the project.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (!loaded) return <main className={styles.main}><p className={styles.muted}>Loading…</p></main>;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>ANDALA · Visual Employee</p>
          <h1 className={styles.title}>Projects</h1>
        </div>
        <div className={styles.who}>
          <span>{me?.name} · {me?.role}</span>
          <button className={styles.linkBtn} onClick={() => void logout()}>Sign out</button>
        </div>
      </header>

      {canCreate ? (
        <form className={styles.create} onSubmit={createProject}>
          <input className={styles.input} placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          <input className={styles.input} placeholder="Brand (optional)" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={80} />
          <button className={styles.button} type="submit" disabled={busy || name.trim().length === 0}>Create</button>
        </form>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <ul className={styles.list}>
        {projects.length === 0 ? <li className={styles.muted}>No projects yet.</li> : null}
        {projects.map((p) => (
          <li key={p.id} className={styles.row}>
            <Link className={styles.projectLink} href={`/project/${p.id}`}>
              <span className={styles.projectName}>{p.name}</span>
              <span className={styles.projectMeta}>
                {p.brand ? `${p.brand} · ` : ""}{p.status}
                {p.latest.approved_artifact_hash ? " · approved" : p.latest.generation_count > 0 ? ` · ${p.latest.generation_count} render${p.latest.generation_count === 1 ? "" : "s"}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {usage ? (
        <section className={styles.usage}>
          <h2 className={styles.usageTitle}>Usage · cost control</h2>
          <div className={styles.usageGrid}>
            <div><dt>Generations</dt><dd>{usage.generation_count}</dd></div>
            <div><dt>Vision inspections</dt><dd>{usage.evidence_count}</dd></div>
            <div><dt>Failed calls</dt><dd>{usage.failed_count}</dd></div>
            <div><dt>Estimated spend</dt><dd>~${usage.estimated_spend_usd.toFixed(4)}</dd></div>
          </div>
          {usage.by_project.length > 0 ? (
            <table className={styles.table}>
              <thead><tr><th>Project</th><th>Calls</th><th>Spend</th></tr></thead>
              <tbody>
                {usage.by_project.map((r) => (
                  <tr key={r.project_id}><td>{r.project_id}</td><td>{r.calls}</td><td>~${r.spend_usd.toFixed(4)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
