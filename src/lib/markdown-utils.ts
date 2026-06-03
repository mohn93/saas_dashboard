// A GFM table separator row, e.g. "| --- | :--: |" or "--- | ---" (requires >= 2 columns,
// so a horizontal rule "---" is NOT matched).
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

const isTableRow = (line: string): boolean => line.includes("|");

// Remove GFM pipe-table blocks from markdown. Used for the agent's narration, where the
// result table is already rendered below the message — so any table the model drew inline
// is redundant. Detects a header row immediately followed by a separator row, then drops
// that pair plus the contiguous body rows. Leaves non-table content (incl. "---" rules) intact.
export function stripMarkdownTables(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const isTableStart =
      i + 1 < lines.length && isTableRow(lines[i]) && TABLE_SEPARATOR_RE.test(lines[i + 1]);
    if (isTableStart) {
      i += 2; // skip header + separator
      while (i < lines.length && lines[i].trim() !== "" && isTableRow(lines[i])) i++; // body rows
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
