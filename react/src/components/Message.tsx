import { useState } from "react";
import { Turn, useExpert } from "../store/useExpert";
import { MODELS, modelName, modelShort } from "../brain/models";
import { renderMd, tablesToCsv } from "./md";

export function Message({ turn }: { turn: Turn }) {
  const rate = useExpert((s) => s.rate);
  const [rated, setRated] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [rateAnyway, setRateAnyway] = useState(false);
  const tierBase = turn.tier.split("-")[0];

  function downloadCsv() {
    const csv = tablesToCsv(turn.answer);
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "expert-table.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function submitRating() {
    if (!stars && !comment.trim()) return;
    rate(turn.id, stars || 3, comment.trim());
    setRated(true);
  }

  return (
    <>
      <div className="msg you">{turn.prompt}</div>
      <div className="msg exp">
        <div className="who">
          <span className={"pill " + tierBase} title={modelName(turn.tier)}>{modelShort(turn.tier)}</span>
          <span>effort {turn.effort} · {turn.src}</span>
        </div>
        {turn.src !== "heuristic" && turn.src !== "override" && turn.reason && (
          <div className="note learn">{turn.reason}</div>
        )}
        <div className="answer">
          {turn.pending ? <><span className="spin" /> thinking…</>
            : turn.error ? <span style={{ color: "var(--opus)" }}>{turn.error}</span>
            : <span dangerouslySetInnerHTML={{ __html: renderMd(turn.answer) }} />}
        </div>

        {!turn.pending && !turn.error && tablesToCsv(turn.answer) && (
          <div><span className="redo" onClick={downloadCsv}>⬇ Download CSV — opens in Excel</span></div>
        )}

        {!turn.pending && !turn.error && turn.quip && (
          <div className="note">{turn.quip}</div>
        )}

        {!turn.pending && !turn.error && !rated && (
          turn.askedBack && !rateAnyway ? (
            <div className="rate">
              <span className="note">❔ I asked you a question — just type your answer below to continue.{" "}
                <span className="redo" onClick={() => setRateAnyway(true)}>rate anyway</span>
              </span>
            </div>
          ) : (
            <div className="rate">
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={"star" + (i <= stars ? " on" : "")} onClick={() => setStars(i)}>★</span>
              ))}
              <input placeholder="add a note e.g. “too long, use haiku next time”"
                value={comment} onChange={(e) => setComment(e.target.value)} />
              <button onClick={submitRating}>Save</button>
            </div>
          )
        )}
        {rated && <div className="note learn">Thanks — recorded. 🦥</div>}
      </div>
    </>
  );
}
