import { useState } from "react";
import { decide } from "../brain/learner";
import { fableWorthy } from "../brain/router";
import { CORE_TIERS, DEFAULT_EFFORT, MODELS, modelShort, modelName, AnyTier, Effort } from "../brain/models";
import { useExpert } from "../store/useExpert";
import { historyStep, placeholders, fillTemplate } from "../brain/prompts";

export function Composer() {
  const { profile, apiKey, send, promptHistory, templates, saveTemplate, deleteTemplate } = useExpert();
  const [text, setText] = useState("");
  const [override, setOverride] = useState<{ tier?: AnyTier; effort?: Effort; effortExplicit?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [histIdx, setHistIdx] = useState(-1);
  const [showTpl, setShowTpl] = useState(false);

  function recall(dir: "up" | "down") {
    const i = historyStep(promptHistory.length, histIdx, dir);
    setHistIdx(i);
    setText(i === -1 ? "" : promptHistory[i]);
  }

  function useTemplate(body: string) {
    let filled = body;
    for (const name of placeholders(body)) {
      const v = window.prompt(`${name}?`);
      if (v == null) return;              // cancelled — don't paste a half-filled template
      filled = fillTemplate(filled, { [name]: v });
    }
    setText(filled);
    setShowTpl(false);
  }

  const trimmed = text.trim();
  const preview = trimmed ? decide(trimmed, profile).d : null;
  const effTier: AnyTier = (override?.tier ?? preview?.tier ?? "sonnet") as AnyTier;
  const effEffort: Effort = (override?.effort ?? (override?.tier ? DEFAULT_EFFORT[override.tier] : preview?.effort) ?? "medium") as Effort;

  async function doSend() {
    if (!trimmed) return;
    if (!apiKey) { useExpert.setState({}); document.dispatchEvent(new CustomEvent("open-key")); return; }
    setBusy(true);
    const ov = override ? { tier: effTier, effort: effEffort } : null;
    setText(""); setOverride(null); setHistIdx(-1);
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
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); return; }
            // Up/Down recall past prompts — only when the box is empty or already recalling,
            // so it never fights normal editing.
            if (e.key === "ArrowUp" && (text === "" || histIdx > -1)) { e.preventDefault(); recall("up"); }
            if (e.key === "ArrowDown" && histIdx > -1) { e.preventDefault(); recall("down"); }
          }}
        />
        <button className="send" disabled={busy} onClick={doSend}>Send</button>
      </div>
      <div className="tplbar">
        <span className="redo" onClick={() => setShowTpl((v) => !v)}>
          {showTpl ? "▾ templates" : "▸ templates"}
        </span>
        {trimmed && (
          <span className="redo" style={{ marginLeft: 12 }}
            onClick={() => { const n = window.prompt("Name this template:"); if (n) saveTemplate(n, trimmed); }}>
            + save this as a template
          </span>
        )}
        {promptHistory.length > 0 && (
          <span style={{ marginLeft: 12, color: "var(--muted)", fontSize: 11 }}>
            ↑ recall past prompts
          </span>
        )}
      </div>
      {showTpl && (
        <div className="tpllist">
          {templates.length === 0 && <span className="empty">No templates yet — write a prompt and save it.</span>}
          {templates.map((t) => (
            <span key={t.id} className="opt tpl" onClick={() => useTemplate(t.body)} title={t.body}>
              {t.name}
              <span className="tplx" title="Delete"
                onClick={(e) => { e.stopPropagation(); if (confirm(`Delete template “${t.name}”?`)) deleteTemplate(t.id); }}>×</span>
            </span>
          ))}
        </div>
      )}
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
