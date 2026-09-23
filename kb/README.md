# NextUp Knowledge Base pipeline

Builds structured Jev-1.13 profiles of films and TV shows into Supabase.
Design, framework rationale and test plan: [DESIGN.md](DESIGN.md).

## Setup (Mac or Raspberry Pi)

Needs Node **22.18+** (runs TypeScript directly, no build step). On a Pi:
`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`.

```bash
git clone https://github.com/djfbeheuur475/movie-app-.git nextup && cd nextup/kb
npm ci
cp .env.example .env   # fill in: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TMDB_API_KEY, DEFAPI_API_KEY
```

`.env` is gitignored. Never commit keys.

## Commands

| command | what it does |
|---|---|
| `npm run framework:sync` | register the framework version in Supabase (refuses edits to a frozen version) |
| `npm run testset:load` | resolve `testset/v1.json` on TMDB and store the titles |
| `npm run probe` | 3 tiny Jev calls: how billing scales with question count |
| `npm run profile:dry` | estimate tokens and cost without calling Jev |
| `npm run profile:test` | profile 10 test-set titles |
| `npm run profile:batch -- --limit 100 [--set test]` | profile N titles |
| `npm run profile:resume` | carry on from where the last run stopped |
| `npm run profile:failed` | retry failed titles (up to 3 attempts) |
| `npm run retest` | re-classify 20 titles without saving, to measure consistency |
| `npm run report` | QC report → `output/report-v1.0.md` |

Everything is resumable: the queue and checkpoints live in Supabase
(`kb_classification_runs`), so a crash, Ctrl-C or reboot never loses more than
the requests in flight. For long runs on the Pi, use `tmux`.

## Changing the framework

Never edit `framework/v1.ts` once it's been used. Copy it to `framework/v1_1.ts`,
bump `version`, register it in `src/framework.ts`, run `framework:sync`, then
`profile --framework 1.1`. Old profiles stay alongside for comparison.
