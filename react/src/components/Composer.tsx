import { useState } from "react";
import { decide } from "../brain/learner";
import { fableWorthy } from "../brain/router";
import { CORE_TIERS, DEFAULT_EFFORT, MODELS, modelShort, modelName, AnyTier, Effort } from "../brain/models";
import { useExpert } from "../store/useExpert";

export function Composer() {
  const { profile, apiKey, send } = useExpert();
  const [text, setText] = useState("");
  const [override, setOverride] = useState<{ tier?: AnyTier; effort?: Effort; effortExplicit?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = text.trim();
  const preview = trimmed ? decide(trimmed, profile).d : null;
  const effTier: AnyTier = (override?.tier ?? preview?.tier ?? "sonnet") as AnyTier;
  const effEffort: Effort = (override?.effort ?? (override?.tier ? DEFAULT_EFFORT[override.tier] : preview?.effort) ?? "medium") as Effort;

  async function doSend() {
    if (!trimmed) return;
    if (!apiKey) { useExpert.setState({}); document.dispatchEvent(new CustomEvent("open-key")); return; }
    setBusy(true);
    const ov = override ? { tier: effTier, effort: effEffort } : null;
    setText(""); setOverride(null);
    await send(trimmed, ov);
    setBusy(false);
  }

  const rank = ({ haiku: 1, sonnet: 2, opus: 3, fable: 3 } as Record<string, number>)[effTier] || 2;

  return (
    <div className="composer">
      <div className="verdict" style={{ opacity: trimmed ? 1 : 0 }}>
        <div className="gauge">
          {[0, 1, 2].map((i) => (
            <span key={i} className={"tick" + (i < rank ? " " + effTier.split("-")[0] : "")} />
          ))}
        </div>
        {preview && (
          <span>
            <b style={{ color: `var(--${effTier.split("-")[0]})` }} title={modelName(effTier)}>{modelShort(effTier)}</b>
            {" · "}{effEffort} effort <span className="why">— {override ? "your override" : preview.reason}</span>
            {effTier === "opus" && fableWorthy(trimmed) && (
              <span style={{ color: "var(--fable)" }}> · 🔮 Fable-grade? tap Fable</span>
            )}
          </span>
        )}
      </div>
      <div className="composerRow">
        <textarea
          rows={1}
          placeholder="Ask anything. I'll weigh it as you type…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } }}
        />
        <button className="send" disabled={busy} onClick={doSend}>Send</button>
      </div>
      {trimmed && (
        <div className="override">
          <span>model:</span>
          {CORE_TIERS.map((t) => (
            <span key={t} className={"opt" + (effTier === t ? " on" : "")} title={modelName(t)}
              onClick={() => setOverride((o) => ({ ...o, tier: t, effort: o?.effortExplicit ? o.effort : DEFAULT_EFFORT[t] }))}>
              {modelShort(t)}
            </span>
          ))}
          <span style={{ marginLeft: 12 }}>effort:</span>
          {(["low", "medium", "high"] as Effort[]).map((e) => (
            <span key={e} className={"opt" + (effEffort === e ? " on" : "")}
              onClick={() => setOverride((o) => ({ ...o, effort: e, effortExplicit: true }))}>{e}</span>
          ))}
        </div>
      )}
    </div>
  );
}
