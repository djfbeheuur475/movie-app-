# NextUp Entertainment Knowledge Base — Design (Phase 1)

Status: 2026-09-23 · framework v1.0 · 106-title test set loaded · awaiting first Jev run.

**The one question this phase answers:** does a structured, Jev-scored profile
of each title let us produce *noticeably better personalised recommendations*
than a direct LLM prompt over the user's Trakt history? Everything here —
framework, schema, test plan — is built to answer that cheaply before scaling.

---

## 1. Architecture

```
            TMDB (metadata)                     Trakt (per-user behaviour — unchanged, app side)
                  │                                              │
   kb/ pipeline (Node, runs on the Pi)                           │
   ┌──────────────┴───────────────┐                              │
   │ catalogue  → kb_titles       │                              │
   │ state      ← stored fields   │                              │
   │ Jev-1.13   → kb_title_profiles (vals/conf arrays)           │
   │ queue/cost → kb_classification_runs, kb_batches             │
   └──────────────┬───────────────┘                              │
                  ▼                                              ▼
        Supabase Free (same project as the app, kb_* tables)   user_settings, trakt_history_cache
                  │                                              │
                  └─────────── Phase 2+: candidate retrieval ────┘
                               (attribute match; embeddings later)
                                         │
                                  Jev ranking (content ↔ user)
                                         │
                                  Qwen/LLM: intent + explanation
                                         │
                                       NextUp
```

- **Where it runs:** `kb/` is a standalone Node 22.18+ package, TypeScript run
  natively by Node (no build step), with one runtime dependency
  (`@supabase/supabase-js`). Same code on the Mac and the Pi.
- **Why no Edge Functions:** batch work runs on the Pi (free, no timeouts),
  writing through Supabase's REST API with the service-role key. Supabase only
  stores results.
- **Same Supabase project as the app:** the app will need to join KB profiles
  with users' Trakt history. At 15k titles the KB is ~20 MB, against a 500 MB
  limit. If it grows past ~150k titles, it moves to a second free project (see §8).
- **State is rebuilt from stored fields only**, so a new framework version can
  re-profile the whole catalogue without calling TMDB again.

## 2. Supabase schema

Migration: `supabase/migrations/20260924000000_entertainment_kb.sql`. All
tables are `kb_*`, with RLS on and no policies (so only the service role can
touch them for now).

| table | purpose | notes |
|---|---|---|
| `kb_titles` | core metadata | 30 fields listed in the brief; ~660 B/row (overview is most of it). `imdb_num` int, `vote_avg` ×10 smallint, ids/names as small arrays |
| `kb_keywords` | TMDB keyword id → name | normalised; titles hold `keyword_ids int[]` (≤15) |
| `kb_frameworks` | framework versions | `definition_hash` refuses silent edits to a frozen version |
| `kb_dimensions` | dimension definitions per version | `ordinal` (→ `conf[]`), `slot_start/slot_count` (→ `vals[]`), qtype, criteria |
| `kb_title_profiles` | **the intelligence** | `vals smallint[117]` (0–100) + `conf smallint[87]`, `model_id`, `framework_id`, `meta_version`, `classified_at` |
| `kb_models` | concrete Jev versions | e.g. `typesafe/jev-1.13-20260917` (taken from each response) |
| `kb_classification_runs` | queue + checkpoint + cost ledger | one row per (title, framework): status, attempts, error, tokens, billed cost, duration |
| `kb_batches` | per-invocation totals | host, succeeded/failed/retries, tokens, cost, timings |
| `kb_sets` | named title sets | the QC test set now; evaluation sets later |

**Why arrays instead of one row per title × dimension:** one row per value
would be 87 rows per title (22M rows at 250k titles, over 1 GB). Arrays cost
~0.5 KB per title. The layout of each version is defined in `kb_dimensions`,
so the framework can still change without code or schema changes. In SQL,
`vals[d.slot_start]` gets any dimension. Later, the arrays convert directly to
pgvector's `halfvec` for similarity search (pgvector is included free on
Supabase).

**`title_themes` is folded into the profile:** themes are noul dimensions,
each storing the probability that the theme is central. A separate
many-to-many table would duplicate that. If indexed "titles about revenge"
lookups turn out to be needed, a partial index or materialised view can be
added later.

**Embeddings (not built):** a future `kb_title_embeddings(title_id, model_id, embedding halfvec(n))`
table. Nothing in the current schema needs to change for it.

**Full probability distributions** are kept only for the test set, in
`kb/output/raw-v1.0.jsonl` (local, gitignored), for analysis. In production,
scores store the expected level plus confidence, and choice questions store
the full option distribution (it's small).

## 3. Framework v1.0 — 87 dimensions (117 stored values)

Source of truth: `kb/framework/v1.ts` (frozen once used; changes go in a new
version). Principles applied to the brief's list:

1. **Never ask Jev what TMDB already knows.** Format, runtime, year,
   language, animation and documentary come from metadata. That removed
   "animation" and "documentary" from genre.
2. **Opposites become one scale.** dark/light/bleak → `darkness` + `hopefulness`
   (these are genuinely different: a dark film can still be hopeful);
   tense/relaxed/intense → `tension`; gritty/slick/grimy → `grit`;
   grounded/realistic/stylised → `realism`; intimate/epic → `scope`;
   slow-burn/fast-paced → `pacing`; mainstream/arthouse → `arthouse`;
   warm/cold → `warmth`.
3. **Near-duplicates dropped:** predictability (the inverse of `twistiness`),
   easy-watch (covered by `comfort` and `intellectual_demand`), emotionally
   demanding (≈ `emotional_intensity`), accessibility (≈ `arthouse`),
   family-friendliness (derived from the content scores plus
   `age_suitability`), dreamlike (≈ `surrealism`), absurd (a `humour_style`
   option), romance-as-content (≈ `genre_romance`), themes crime/war/morality
   (covered by genre and `moral_ambiguity`).
4. **Choice questions only for genuinely either/or facets**, with the full
   distribution stored so blends survive (60% character-driven / 40%
   plot-driven).

| category | n | dimensions |
|---|---|---|
| genre (score, degree) | 17 | crime, thriller, mystery, drama, comedy, scifi, fantasy, horror, romance, action, adventure, war, western, musical, historical, biographical, sports |
| tone (score) | 11 | darkness, hopefulness, tension, adrenaline, humour, satire, sadness, emotional_intensity, warmth, unsettling, whimsy |
| narrative | 12 | plot_complexity, pacing, twistiness, worldbuilding, nonlinearity, serialization *(TV only)*, ensemble, dialogue_density, character_depth, moral_ambiguity · choice: **narrative_engine** (character/plot/atmosphere/ideas/spectacle/comedy), **ending** (uplifting/bittersweet/tragic/ambiguous/ongoing) |
| style | 13 | realism, grit, prestige, camp, quirkiness, cerebral, comfort, claustrophobia, scope, surrealism, arthouse, visual_ambition · choice: **setting** (9 options) |
| theme (noul, P(central)) | 20 | justice, revenge, power, family, friendship, love, betrayal, identity, society, class, ambition, survival, obsession, grief, redemption, coming_of_age, isolation, technology, conspiracy, mental_health |
| content (score) | 8 | violence, gore, sexual, profanity, drugs, disturbing, scariness · choice: **age_suitability** |
| audience | 6 | intellectual_demand, attention_required, rewatchability, originality · choice: **viewing_context** (solo/partner/friends/family — feeds "Watch Together"), **humour_style** (8 options) |

**Every score uses 5 levels**, each with a written description. Five is
consistent enough to be reliable and fine-grained enough to be useful; the
stored value is the probability-weighted level, so it's continuous from 0 to
100 anyway.

**Deliberately excluded for now:** quality/"is it good" (TMDB rating covers
it, and it's the least personal signal), protagonist demographics (low
recommendation value and sensitive), streaming availability (changes too
often to profile).

## 4. Jev request strategy

- **Endpoint:** `POST https://api.defapi.org/api/v1/decisions`,
  `Authorization: Bearer $DEFAPI_API_KEY`,
  body `{ model: "typesafe/jev-1.13", state, questions }`. Verified against
  the docs on 2026-09-23.
- **One request per title** with all applicable questions (86 for films, 87
  for TV), keyed by dimension key. This is the brief's "many questions
  against one state" approach.
- **State** is ~1.2 KB of plain text built from stored fields: an instruction
  line ("profile this title… use what you know about it"), title/year,
  format/runtime/rating/language/country, genres, director or creators, top 5
  cast, ≤15 TMDB keywords, and the overview. The keywords matter: TMDB's
  tags like "neo-noir", "slow burn" and "dark comedy" are strong signals.
- **Answer mapping:**
  - score → the expected level from the probability distribution, stored 0–100
    (computed ourselves rather than trusting Jev's own score scale); confidence
    ×100
  - noul → P(true) ×100; confidence taken as |2p−1|
  - choice → the probability of every option
- **Unknown until the probe (`npm run probe`):**
  - whether question text is billed once per request or re-billed per question
  - how many questions one request accepts (the docs give no limit)

  The probe sends 1, 10 and all questions and records `usage.input_tokens`.
  If the state turns out to be re-billed per question, the fix is fewer,
  richer questions; the framework is designed so dimensions can be merged
  without redesign.
- **Determinism:** Jev has no seed or temperature setting. It's measured
  instead: `npm run retest` re-classifies 20 titles, and the report shows how
  much each dimension changes (§7). Every profile records the concrete model
  version, framework version, `meta_version` and timestamp.

## 5. Token and cost model

Pricing from the docs (2026-09-23): **$0.084 per 1M input tokens list,
$0 output.** The billed `consumed` value in the doc examples works out to
**$0.042/M**, i.e. 50% off list. The pipeline always records the actual billed
`consumed` value, and estimates use observed $/token once real runs exist.

Estimated ~5,000 tokens per title (state ~300 plus ~87 questions × ~55). To
be confirmed by the probe.

| titles | tokens | list ($0.084/M) | billed (~$0.042/M) | if state re-billed per question (worst case) |
|---|---|---|---|---|
| 106 (test) | 0.5M | $0.04 | $0.02 | ~$0.40 |
| 15,000 | 75M | $6 | $3 | ~$55 |
| 50,000 | 250M | $21 | $11 | ~$185 |
| 100,000 | 500M | $42 | $21 | ~$370 |
| 250,000 | 1.25B | $105 | $53 | ~$920 |

Re-profiling after a framework change costs the same again. TMDB is free
(about 1 request per title). Supabase storage is ~1.35 KB per title in total:
15k ≈ 20 MB, 100k ≈ 135 MB, 250k ≈ 340 MB.

**Throughput:** Jev latency is unknown until the probe. Rate limits aren't
documented; the pipeline defaults to 2 in flight and ≥500 ms between request
starts, both tunable via `.env`.

## 6. Batch processing

- **Queue lives in Postgres:** `kb_enqueue(framework, set)` adds missing runs,
  and `kb_claim_runs(...)` claims work atomically (`FOR UPDATE SKIP LOCKED`),
  so it's resumable from any machine. Stale `processing` rows (from a worker
  that died) are reclaimed after 15 minutes. Nothing ever restarts from zero.
- **Resumable:** every title is committed on its own (profile row plus run
  row). Killing the Pi mid-batch loses at most the requests in flight.
- **Retries:** network errors, 429 and 5xx retry up to 3 times with
  exponential backoff and jitter; after that the run is marked `failed`.
  `npm run profile:failed` retries failed runs until `--max-attempts` (default
  3). A 400 or 401 stops the batch immediately so a bad key or schema doesn't
  burn through every title.
- **Commands:**
  - `profile:dry` estimates without calling Jev
  - `profile:test` runs 10 titles
  - `profile:batch -- --limit 100`
  - `profile:resume` picks up where it stopped
  - `profile:failed` retries failures
  - `--set <name>`, `--framework 1.1` (re-profiling under a new version
    creates new runs; old profiles are kept side by side)
- **Logs and costs:** every title and batch goes to stdout and
  `kb/logs/kb-YYYY-MM-DD.log`. Costs are recorded per title
  (`kb_classification_runs`) and per batch (`kb_batches`).

## 7. Test methodology

**Stage A — framework QC (the 106-title test set, now):** blockbusters,
prestige drama, comedy, horror, action, sci-fi, arthouse and foreign,
documentary, animation (kids and adult), films before 1980, obscure/indie, TV
drama, sitcoms, procedurals, anthology, reality, panel shows and docuseries.
A few are from your own history (Slow Horses, MobLand, Taskmaster, Last Week
Tonight) so the eyeball check means something.

`npm run report` → `kb/output/report-v1.0.md` covers:
1. **Low variance** (sd < 10): the dimension doesn't separate titles, so cut it.
2. **Low confidence** (mean < 50): Jev struggles with it, so reword or cut it.
3. **Redundancy** (|r| ≥ 0.75): merge or drop one of the pair.
4. **Consistency** (after `npm run retest`): mean absolute change per
   dimension between two runs. Target < 10 on the 0–100 scale.
5. **Choice sanity:** do all options ever win? Is one option swallowing
   everything?
6. **Title cards:** the 8 most distinctive traits, the dominant choices, and
   the 3 nearest neighbours. The human check: does Hereditary's card read like
   Hereditary? Is Hot Fuzz's nearest neighbour something like In Bruges rather
   than Die Hard?
7. **Knowledge probe:** re-run ~10 famous titles with the state reduced to
   title + year. If the profiles barely change, Jev is using its own knowledge
   of the title; if they collapse, profile quality depends on the overview,
   and obscure titles need richer state (e.g. a Wikipedia plot summary).

After review, freeze **v1.1** (cut, merge and reword), re-run the test set,
and compare.

**Stage B — the hypothesis test (after v1.1, ~2–3k titles):** build the
catalogue from the family's watched titles plus popular and critically
acclaimed candidates. Then, for each family member with Trakt history:
- **Hold out** their 10–20 most recent watches.
- **Build three recommenders:**
  - (A) direct LLM prompt over their history (today's approach)
  - (B) KB only: a taste vector (plays-weighted mean of watched profiles,
    with dropped shows counted as negatives), ranked by similarity
  - (C) hybrid: top 100 from (B) → Jev/LLM re-rank with explanations
- **Offline metric:** hit@20 and recall@50 of the held-out titles.
- **Blind human test (the real bar):** 10 rounds of two unlabeled rows (A vs
  B or C) per person: "which would you rather watch?"

**Success:** B or C beats A on the blind test by ≥60/40 without being worse
on hit@k. Explanations generated from profile evidence ("tense, morally grey,
dry humour, like Slow Horses") should also read as more specific than A's.

## 8. Risks and limitations

- **Jev's film knowledge is unknown.** It's described as a fast "System One"
  decision model. If it mostly reads the state rather than knowing the title,
  obscure titles with thin overviews will get generic profiles. The knowledge
  probe (§7.7) measures this; the fix is richer state (Wikipedia plot, more
  keywords) at a modest token cost.
- **Undocumented limits:** questions per request, rate limits, latency and
  whether question text is re-billed. The probe and a 10-title run answer
  these before any real spend.
- **No determinism controls:** measured by retest; mitigated by 5-level
  anchored scales and storing expected values.
- **Vendor and model drift:** defapi.org is an aggregator and the concrete
  model version changes (`-20260917`). The model version is stored per
  profile, and a drift check means re-running the retest subset after a
  version change.
- **Subjectivity:** dimensions like `prestige`, `originality` and
  `rewatchability` are opinion-shaped. They stay only if they're consistent
  and actually predict preference in Stage B.
- **Supabase Free:** 500 MB total. The KB is ~1.35 KB per title, fine to
  ~150k titles in the shared project. Beyond that, either move the KB to a
  second free project or pack arrays as `bytea`/`halfvec` and trim overviews
  (~2× smaller). Free projects pause after 7 days without traffic; the app's
  traffic keeps this one alive.
- **TMDB terms:** fine for a non-commercial family app; attribution is
  required in the app's about screen.
- **Pi:** SD-card wear from logs is minor (one line per title). Run under
  `tmux` or systemd so SSH drops don't matter, and it's resumable anyway.

## 9. Phase 1 plan

1. ✅ Schema, framework v1.0, pipeline, 106-title test set loaded (TMDB → Supabase).
2. ⏳ Add `DEFAPI_API_KEY` → `npm run probe` (billing structure, question capacity, latency).
3. `npm run profile:test` (10 titles) → check answers map cleanly and costs match.
4. `npm run profile:resume` (remaining 96) → `npm run retest` → `npm run report`.
5. Review the report together → framework **v1.1** → re-run the test set → compare.
6. Build a ~2–3k title evaluation catalogue → Stage B hypothesis test.
7. Only if B or C wins: scale to 15k (10k films + 5k TV), chosen by TMDB vote
   count with a popularity floor; beyond that, TMDB's free daily ID exports
   support 100k+.
