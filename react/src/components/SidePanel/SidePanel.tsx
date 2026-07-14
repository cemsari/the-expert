import { useExpert } from "../../store/useExpert";
import { modelShort } from "../../brain/models";
import { MIN_SAMPLES, EXPLORE_TRIAL } from "../../brain/learner";

const BUCKET_LABEL: Record<string, string> = {
  haiku: "easy questions", sonnet: "medium questions", opus: "hard questions",
};
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

export function SidePanel() {
  const { ledger, profile } = useExpert();
  const totalSaved = ledger.reduce((a, r) => a + (r.saved || 0), 0);
  const spent = ledger.reduce((a, r) => a + (r.cost || 0), 0);
  const base = ledger.reduce((a, r) => a + (r.baseline || 0), 0);
  const pct = base ? Math.round((100 * totalSaved) / base) : 0;
  const rated = ledger.filter((r) => r.rating);
  const avg = rated.length ? rated.reduce((a, r) => a + (r.rating || 0), 0) / rated.length : null;

  const counts: Record<string, number> = { haiku: 0, sonnet: 0, opus: 0, fable: 0 };
  ledger.forEach((r) => { const b = r.tier.split("-")[0]; counts[b] = (counts[b] || 0) + 1; });
  const tot = ledger.length || 1;

  const lessons: JSX.Element[] = [];
  for (const [b, tiers] of Object.entries(profile.buckets)) {
    const r = Object.entries(tiers).filter(([, s]) => s.n >= MIN_SAMPLES).sort((a, c) => c[1].sat / c[1].n - a[1].sat / a[1].n);
    if (r.length) {
      const [best, s] = r[0];
      lessons.push(<div className="lesson" key={"l" + b}>For <span className="k">{BUCKET_LABEL[b] || b}</span> → I use <b>{modelShort(best as any)}</b> <span style={{ color: "var(--muted)" }}>(liked {Math.round(100 * s.sat / s.n)}% of {s.n})</span></div>);
    }
  }
  for (const [b, dr] of Object.entries(profile.directives)) {
    const want = [dr.tier, dr.effort].filter(Boolean).join("/");
    lessons.push(<div className="lesson" key={"d" + b}>🧭 For <span className="k">{BUCKET_LABEL[b] || b}</span> → <b>{want}</b> <span style={{ color: "var(--muted)" }}>(your rule)</span></div>);
  }
  for (const [b, e] of Object.entries(profile.experiments)) {
    if (e.status === "running") lessons.push(<div className="lesson" key={"e" + b}>🧪 For <span className="k">{BUCKET_LABEL[b] || b}</span> → testing <b>{modelShort(e.trial)}</b> ({e.seen} of {EXPLORE_TRIAL})</div>);
    else if (e.status === "adopted") lessons.push(<div className="lesson" key={"e" + b}>✅ adopted <b>{modelShort(e.trial)}</b> for <span className="k">{BUCKET_LABEL[b] || b}</span></div>);
  }

  const notes = [...profile.noteLog].reverse().slice(0, 5);

  return (
    <div className="side">
      <div className="card">
        <h3>Saved vs always-Opus</h3>
        <div className="big save">${totalSaved.toFixed(4)}</div>
        <div className="sub">{ledger.length ? `${ledger.length} turns · ${pct}% under always-Opus · spent $${spent.toFixed(4)}` : "no turns yet · baseline: Opus 4.8 rates"}</div>
      </div>
      <div className="card">
        <h3>Average rating</h3>
        <div className="big">{avg ? avg.toFixed(1) + " / 5" : "—"}</div>
        <div className="sub">{rated.length ? `${rated.length} rated` : "rate answers to train me"}</div>
      </div>
      <div className="card">
        <h3>📝 Your notes</h3>
        {notes.length ? notes.map((n, i) => (
          <div className="lesson" key={i}><span className="k">{n.topic || BUCKET_LABEL[n.bucket] || n.bucket}:</span> “{n.text}”</div>
        )) : <div className="empty">Notes you add with ratings appear here.</div>}
      </div>
      <div className="card">
        <h3>What I've learned about you</h3>
        <div className="sub" style={{ marginTop: -4, marginBottom: 8 }}>I sort questions by difficulty and remember which model you liked best.</div>
        {lessons.length ? lessons : <div className="empty">Nothing yet. Rate a few answers and add notes like “too long, use haiku”.</div>}
      </div>
    </div>
  );
}
