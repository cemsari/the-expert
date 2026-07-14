// Tiny markdown -> HTML (escape-first), ported from the single-file edition.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function renderMd(t: string): string {
  t = esc(t);
  t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _l, c) => `<pre><code>${c}</code></pre>`);
  t = t.replace(/((?:^\|.*\|\s*\n?)+)/gm, (block) => {
    const rows = block.trim().split("\n").filter((r) => r.includes("|"));
    if (rows.length < 2) return block;
    const cells = (r: string) => r.split("|").slice(1, -1).map((c) => c.trim());
    let html = "<table><tr>" + cells(rows[0]).map((c) => `<th>${c}</th>`).join("") + "</tr>";
    rows.slice(2).forEach((r) => { html += "<tr>" + cells(r).map((c) => `<td>${c}</td>`).join("") + "</tr>"; });
    return html + "</table>";
  });
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  return t;
}

// CSV extraction for table answers (pipe tables), ported.
export function extractTables(md: string): string[][][] {
  const out: string[][][] = [];
  const lines = (md || "").split("\n");
  let cur: string[] = [];
  const flush = () => {
    if (cur.length >= 2) {
      out.push(cur
        .filter((r) => !/^\s*\|[\s:\-|]+\|\s*$/.test(r))
        .map((r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""))));
    }
    cur = [];
  };
  for (const ln of lines) { if (/^\s*\|.*\|\s*$/.test(ln)) cur.push(ln); else flush(); }
  flush();
  return out;
}
export function tablesToCsv(md: string): string | null {
  const tabs = extractTables(md);
  if (!tabs.length) return null;
  const escCell = (c: string) => (/[",\n;]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c);
  return "\uFEFF" + tabs.map((t) => t.map((r) => r.map(escCell).join(",")).join("\n")).join("\n\n");
}
