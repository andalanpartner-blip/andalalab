# Local development

Andala AI Visual Employee is a **private team workspace** — there is no public
signup. Locally you create the first account yourself with `pnpm seed`.

The public marketing site is at `/`; everything else (`/dashboard`,
`/project/*`) is behind the login.

---

## 1. Install dependencies

```bash
pnpm install
```

Requires Node ≥ 20.11 and pnpm.

## 2. Create `.env.local`

`.env.local` is git-ignored. Create it with the values below — never commit it,
never paste real secret values into docs or issues.

## 3. Required local variables

| Var | Needed for | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | live generation / vision evidence | Only if you run the real providers (see step 9). Server-side only. |
| `ADMIN_EMAIL` | `pnpm seed` | The first admin's email. |
| `ADMIN_PASSWORD` | `pnpm seed` | At least 10 characters. Read by the seed, never printed or stored in plaintext. |

Optional:

| Var | Default (dev) | Notes |
| --- | --- | --- |
| `APP_ENV` | `development` | Leave unset locally. `staging` / `production` fail closed without full config. |
| `ANDALA_DATA_DIR` | `.andala-data/` | Directory for the JSON store. The default is git-ignored. |
| `SESSION_SECRET` | a fixed dev-only value | Set a ≥ 32-char value to mimic production cookie signing. |
| `GENERATION_PROVIDER` | *(real Gemini)* | `fake` → grey-placeholder generator, no API key or cost. |
| `EVIDENCE_PROVIDER` | *(real Gemini vision)* | `replay` → canned visual evidence, no API call. |

A minimal `.env.local` for UI work without touching the AI providers:

```
ADMIN_EMAIL=you@local.test
ADMIN_PASSWORD=change-me-locally
GENERATION_PROVIDER=fake
EVIDENCE_PROVIDER=replay
```

## 4. Run the seed

```bash
pnpm seed
```

Creates the **Andala Creative** workspace and one admin from `ADMIN_EMAIL` /
`ADMIN_PASSWORD`, with workspace membership. It is idempotent — running it again
does not duplicate the user. It prints the email and workspace only, never the
password:

```
Seed complete.
Admin: you@local.test
Workspace: Andala Creative
```

Seed a full team instead of a single admin with `ANDALA_SEED` (a JSON array of
`{ email, name, password, role }`, roles `admin | designer | account`) — see
[production-config.md](production-config.md).

## 5. Start the dev server

```bash
pnpm dev
```

## 6. Open the app

<http://localhost:3000> — the marketing site. Follow **Get Started** / **Sign in**
to `/login`.

## 7. Sign in

Use the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you seeded. On success you land on
`/dashboard`; open or create a project to reach the creative workspace.

If you try to sign in before seeding, the login returns:

> No development account exists yet. Run `pnpm seed`.

## 8. Reset the local store

The JSON store is a single directory. To wipe all local users, projects and
history and start clean:

```bash
rm -rf .andala-data      # or your $ANDALA_DATA_DIR
pnpm seed
```

## 9. Fake / replay providers for development

To develop without a Gemini key, API calls, or cost:

```
GENERATION_PROVIDER=fake     # generation returns a grey placeholder
EVIDENCE_PROVIDER=replay     # visual evidence is canned
```

These are **development-only** — `lib/server/env.ts#checkEnv` throws on startup
if either is set in `staging` / `production`.

---

## Production

None of the above changes production: no public signup, `pnpm seed` is the only
account-creation path, credentials always come from the environment, passwords
are scrypt-hashed, and the development login hint / helper only render when
`NODE_ENV` / `APP_ENV` is not production. See
[production-config.md](production-config.md).
