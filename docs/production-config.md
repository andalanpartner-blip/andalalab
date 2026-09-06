# Production configuration (P2.20)

Andala AI Visual Employee is a **private internal team workspace** — not a
public SaaS. There is no public signup, no public API, no public asset URLs.

## Required environment variables

| Var | Purpose | Notes |
| --- | --- | --- |
| `APP_ENV` | `development` \| `staging` \| `production` | Anything else is treated as `development`. |
| `SESSION_SECRET` | HMAC key for signed session cookies | **≥ 32 random chars.** Rotating it signs everyone out. Never commit it. |
| `GEMINI_API_KEY` | Server-side Gemini credential | Read only in `adapters/**` / `services/**`. Never sent to the browser, never logged. |
| `ANDALA_DATA_DIR` | Directory for the JSON store (`store.json`) | Must be on a **persistent** disk. |
| `NEXT_PUBLIC_APP_URL` | The deployment origin (https) | Used for absolute links only. |

### Must NOT be set in staging / production

- `GENERATION_PROVIDER=fake`
- `EVIDENCE_PROVIDER=replay`

`lib/env.ts#checkEnv` **throws on startup** in staging/production if a required
value is missing or a test provider is enabled — the process fails **closed**
rather than serving degraded.

## Seeding the team

No public registration. An operator runs:

```
ANDALA_DATA_DIR=/data \
ANDALA_SEED='[{"email":"…","name":"…","password":"…","role":"admin"},
              {"email":"…","name":"…","password":"…","role":"designer"},
              {"email":"…","name":"…","password":"…","role":"account"}]' \
pnpm tsx scripts/seed.ts
```

Roles: `admin` (full workflow + team + usage + settings), `designer` (full
creative workflow + approve), `account` (create projects + briefs + view final).

## Runtime

- **HTTPS required** (session cookies are `Secure` outside development).
- Server-side Gemini calls only — the browser never receives the key.
- Middleware sets `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
- Expensive endpoints (`/api/generate`, `/api/vision-loop`, …) are rate-limited
  per user (`lib/rate-limit.ts`).

## Deployment shape

Smallest production-safe target: a single Node instance with a persistent disk
(Fly.io / Railway / a VPS). It needs HTTPS termination, the env vars above, and
a writable `ANDALA_DATA_DIR`. Do **not** publish the repository publicly.

When one instance is no longer enough, swap `adapters/storage/json-file.ts` for
a Postgres adapter behind the same `StoragePort` and move the rate limiter to a
shared store — nothing else changes.
