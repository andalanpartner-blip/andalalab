# Backup & recovery (P2.20-P)

Small internal team — not enterprise DR. The whole persistent state is one
file.

## What to back up

| Item | Where | How |
| --- | --- | --- |
| Database | `$ANDALA_DATA_DIR/store.json` | Copy the file on a schedule (cron `cp`, or the host's volume snapshots). It is written atomically (temp + rename), so a copy is always consistent. |
| Environment secrets | `SESSION_SECRET`, `GEMINI_API_KEY` | Keep in the host's secret manager. Record a sealed copy offline. |
| Artifact metadata | inside `store.json` (`artifacts`, `decisions`, `cycles`, `cost_events`) | Covered by the DB backup. Immutable — never edited in place. |

**Image bytes are not persisted** — there is nothing to back up there. A
generated image is transported once as a `data:` URL and then forgotten.

## Recovery

| Scenario | Steps |
| --- | --- |
| Corrupt `store.json` | The app refuses to start (`… is corrupt — restore from a backup`). Replace the file with the most recent backup and restart. |
| Lost `SESSION_SECRET` | Set a new ≥32-char value. Everyone is signed out and signs in again; no data is lost. |
| Lost `GEMINI_API_KEY` | Mint a new key in Google Cloud, set it, restart. |
| Project recovery | Restore `store.json`; the project + its full lineage (`artifacts` collection) come back with it. |
| User recovery | Restore `store.json`, or re-run `scripts/seed.ts` for the affected users (passwords are re-set to the seed values). |

## Retention

Keep at least 7 daily copies of `store.json`. Prune older ones. Test a restore
into a scratch `ANDALA_DATA_DIR` once a quarter.
