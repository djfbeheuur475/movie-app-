# Jev knowledge-base experiment — outcome (2026-09-23)

Decision record for the NextUp Jev knowledge-base experiment. Design: [DESIGN.md](DESIGN.md). The full report (with personal viewing history) is kept locally in `kb/experiment/` and is not committed.

**Setup:** 2,211-title catalogue built around one household Trakt history, every title profiled with Jev-1.13 (framework v1.1, 82 dimensions + familiarity probe; $1.52 total). Four time-split folds × 20 hidden titles (history cleaned: one guest day excluded, duplicate scrobbles merged). Twelve blind side-by-side rounds answered by the viewer.

| system | hidden titles found in top 20 (of 80; chance ≈ 1) | blind win rate | comedy-TV share of picks | picks with < 500 TMDB votes |
|---|---|---|---|---|
| A · Jev KB only | 0 | 50% (2–2) | 80% | 63% |
| B · Jev KB + Qwen | 2 | 50% (3–3) | 80% | 68% |
| E2 · TMDB shortlist + Qwen | 0 | 50% (2–2, 1 tie) | 35% | 65% |
| E · Qwen over whole catalogue | 2 | 50% (3–3, 1 tie) | 13% | 37% |
| D · Most popular | 0 | 50% (1–1) | 0% | 0% |

Primary comparison B vs E2: hidden titles 2 vs 0 (inconclusive), blind 2–1 (too few rounds). Jev's 60-title shortlist held 4 hidden titles vs TMDB's 0 vs ≈3.1 for a random 60.

## Conclusion — is there evidence that Jev is worth keeping in the NextUp recommendation architecture?

**No — not on this evidence.** The Jev-based systems (A, B) did not produce recommendations that were measurably better than the simpler approaches (E2, E) on either test, and nothing distinguishes B from E2, the comparison that matters most. There is a small, noisy hint that Jev's ranking carries some taste signal for well-known older titles, but it is not strong enough to justify the architecture.

### What the evidence says, by category

**1. Jev improves candidate selection — weak, not established.**
- Jev's top 60 (B's candidates) contained 4 of the 80 hidden titles; TMDB's top 60 (E2's) contained 0; a random 60 would contain ≈3.1. Beating TMDB here is inconclusive (p ≈ 0.13), and Jev's shortlist was **no better than random**.
- For older (pre-2025) hidden titles, A placed 8 of 39 in its top 10% versus ≈3.9 by chance (binomial p ≈ 0.04). That is one test among many, so treat it as a **directional signal at most**. Head-to-head against popularity on the same titles it was a wash (A ranked the hidden title higher 19 times, popularity 20).
- The signal that exists is concentrated in titles Jev knows well (Spearman ρ = 0.44 between familiarity and A's ranking of the hidden title). It does not extend to 2025–26 releases, which are ~half of what was actually watched.

**2. Jev improves final recommendations when combined with Qwen — not supported.**
- Hidden titles in the final top 20: B 2, E 2, E2 0 (chance ≈ 1). Inconclusive in every direction.
- Blind preference: **B vs E2 2–1, B vs E 1–2**. Every system finished at exactly 50% across the blind rounds it appeared in. There is no preference for B over either simpler approach.
- Caveat: in the production run used for the blind rows, Qwen's re-rank inside B returned almost exactly the KB's own order, so the blind B rows mostly test Jev's shortlist rather than Qwen's re-ranking of it. In the four test folds Qwen did genuinely re-order (B shared only 8–12 of A's top 20), and it lifted 2 of Jev's 4 shortlisted hidden titles into the top 20 — too few to mean anything.

**3. Candidate retrieval itself is the main improvement — not supported.**
- E2 (TMDB shortlist + Qwen) found 0 hidden titles; E (Qwen over the whole ~1,550-title catalogue) found 2. Blind E2 vs E: 1–0 with 1 no-preference.
- The earlier worry that a small model can't choose from 1,500 titles did not translate into worse results here: E's lists were the most diverse and least clumped, and were preferred as often as anything else.

**4. Too weak or noisy to draw conclusions from.**
- Everything above: 80 hidden titles for one viewer (about half of them 2025–26 releases newer than the models), 12 blind rounds answered by one person with no stated reasons, and Qwen outputs that vary run to run (E found 1 hidden title in the interim run, 2 in the final). A real 65/35 preference would need ≈50+ blind rounds to show up reliably.

### What the Jev systems actually recommend (a product-quality concern, not a statistic)
- **Heavy clumping:** 80% of A's and B's picks were comedy TV (Friends, French & Saunders, Second City Television, Portlandia, Will & Grace…), versus 35% for E2 and 13% for E. Genre variety was lowest of all systems (A 1.3 bits vs E 3.3).
- **Skews obscure:** two-thirds of A/B picks have under 500 TMDB votes (E: 37%).
- **Viewer feedback:** the viewer reported that the KB's recommendations included shows they actively dislike — **Friends (A's #1) and The Big Bang Theory (A's #3)**. Jev profiles both as warm, friendship-driven, rewatchable comedies, which places them close to comedies the viewer did watch (Platonic, Colin from Accounts, Seinfeld, The Four Seasons, Planes, Trains and Automobiles). The attributes capture the broad category but not what separates the comedies this viewer likes from the ones they don't (comic sensibility, multi-cam laugh-track vs sharper single-cam), and the history has no explicit dislike signal to correct it. This is direct evidence that Jev's representation is too coarse to drive taste matching on its own.
- These are exactly the kind of lists a viewer finds samey. Fixing them would mean tuning (diversification, popularity priors), which was out of scope — and there's no evidence the underlying signal is strong enough to be worth tuning.

### Practical answers

1. **Should NextUp adopt the Jev knowledge-base architecture?** No. It did not beat simpler approaches on hidden-title recovery or blind preference.
2. **Which parts should be retained?** The data layer is cheap and reusable: the TMDB catalogue pipeline, the resumable batch queue, and the stored profiles (2,211 titles for ~$1.52). Keep them dormant as optional *features* — e.g. mood/content filters ("dark and tense", "no gore") or short "why" explanations — but do not put Jev on the recommendation path. That use was not tested here, so treat it as a hypothesis, not a finding.
3. **Candidate generation, ranking, or both?** Neither was demonstrated. If anything, the faint signal is in ranking well-known older titles — not enough to build on.
4. **Does Qwen materially improve the Jev results?** No evidence either way: B vs A 2 vs 0 hidden titles is within noise, and the blind B rows were effectively A's list.
5. **Is the current direct-AI implementation worth replacing?** Not with Jev. (C is reported only as a reference; see §5. Its known product issues — few unique titles per request, repeats, empty replies — are separate from this question and cheaper to fix directly.)
6. **Should the catalogue scale beyond 2,211 titles?** **No.** Scaling would multiply cost and clumping without evidence of benefit. Do not scale to 50k/100k.
7. **What is the next experiment, if any?** Only if you want to keep probing the recommender:
   - **More blind data before more architecture.** The blind test is the right instrument but 12 rounds from one person can't separate systems. More family members (Trakt exports) and ~50 rounds each would.
   - **Test the simplest strong baseline first:** E-style direct selection with a stronger model (the earlier model bake-off) — cheap, and E was as good as anything here.
   - **If Jev is revisited, test it where structure plausibly matters:** mood/constraint queries ("something like Slow Horses but lighter"), not general taste matching.

**Bottom line:** the Jev knowledge base did not make NextUp better at recommending things this viewer wanted to watch. Keep the cheap data pipeline, don't scale it, and don't build the recommendation path around it.
