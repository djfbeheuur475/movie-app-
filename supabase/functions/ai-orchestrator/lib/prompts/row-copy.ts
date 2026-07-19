// Row Copy Writer — writes a punchy heading + subheading from the ACTUAL fetched
// titles, not the source Trakt list's raw name. Trakt list names are often flat
// or generic ("Sci-Fi", "Comedy") and sometimes mislabelled, so copy written from
// the name alone reads dull or, worse, describes content that isn't really there.
// This runs once, after items are fetched, grounding both lines in real titles.

export interface RowCopyInput {
  id: string;
  listName: string;
  titles: string[];
}

export interface RowCopyOutput {
  heading?: string;
  subheading?: string;
}

export function buildRowCopyPrompt(
  rows: RowCopyInput[],
): { system: string; user: string } {
  const system = `/no_think
You write punchy row headings + one-line subheadings for a streaming app's homepage, based ONLY on the actual titles shown in each row — not on the row's source label, which may be generic or misleading.
Look at the real titles and write copy that captures what they actually have in common (genre, tone, era, theme).
heading: 2–5 words, evocative and specific — never a flat genre word like "Sci-Fi" or "Comedy" on its own. Think editorial magazine section title, not a database category.
subheading: one sentence, max 12 words, describing the actual titles.
Output ONLY valid JSON — no markdown, no explanation outside the JSON.`;

  const rowsBlock = rows
    .map((r) => `[${r.id}] source label: "${r.listName}" — titles: ${r.titles.join(", ")}`)
    .join("\n");

  const user = `ROWS (source label is just a raw category tag — write better copy from the titles):
${rowsBlock}

Return heading + subheading per row id.
{"rows":[{"id":"<exact id>","heading":"...","subheading":"..."},...]}`;

  return { system, user };
}

export function parseRowCopyResponse(raw: string): Record<string, RowCopyOutput> {
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    const parsed = JSON.parse(stripped);
    const out: Record<string, RowCopyOutput> = {};
    if (Array.isArray(parsed?.rows)) {
      // deno-lint-ignore no-explicit-any
      for (const r of parsed.rows as any[]) {
        if (typeof r?.id !== "string") continue;
        const entry: RowCopyOutput = {};
        if (typeof r.heading === "string" && r.heading.trim()) entry.heading = r.heading.trim();
        if (typeof r.subheading === "string" && r.subheading.trim()) entry.subheading = r.subheading.trim();
        if (entry.heading || entry.subheading) out[r.id] = entry;
      }
    }
    return out;
  } catch {
    return {};
  }
}
