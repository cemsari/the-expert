import { useEffect, useState } from "react";
import { useExpert } from "../store/useExpert";

export function KeyModal() {
  const { apiKey, setKey, disconnectKey } = useExpert();
  const [open, setOpen] = useState(!apiKey);
  const [val, setVal] = useState(apiKey);

  useEffect(() => {
    const h = () => { setVal(useExpert.getState().apiKey); setOpen(true); };
    document.addEventListener("open-key", h);
    return () => document.removeEventListener("open-key", h);
  }, []);

  if (!open) return null;
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget && apiKey) setOpen(false); }}>
      <div className="modalbox">
        <h2>🔑 Connect your Anthropic key</h2>
        <p>Bring your own key. It's stored only in this browser and sent directly to Anthropic — never to any other server.</p>
        <input type="password" placeholder="sk-ant-…" value={val} onChange={(e) => setVal(e.target.value)} autoComplete="off" />
        <div className="row">
          {apiKey && <button className="cancel" onClick={() => setOpen(false)}>Cancel</button>}
          <button className="save" onClick={() => { setKey(val.trim()); setOpen(false); }}>Save key</button>
        </div>
        {apiKey && (
          <div className="row" style={{ marginTop: 8 }}>
            <button className="cancel" style={{ color: "var(--opus)", borderColor: "var(--opus)" }}
              onClick={() => { if (confirm("Disconnect your key? Learning and savings stay.")) { disconnectKey(); setOpen(false); } }}>
              Disconnect this key
            </button>
          </div>
        )}
        <div className="disc">Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>. Your usage bills your own account.</div>
      </div>
    </div>
  );
}
