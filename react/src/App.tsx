import { useEffect, useRef } from "react";
import { useExpert } from "./store/useExpert";
import { Composer } from "./components/Composer";
import { Message } from "./components/Message";
import { SidePanel } from "./components/SidePanel/SidePanel";
import { KeyModal } from "./components/KeyModal";

export default function App() {
  const { apiKey, turns, newChat, resetAll, storageWarning, exportProfileJson, importProfileJson } = useExpert();
  const fileRef = useRef<HTMLInputElement>(null);

  function doExport() {
    const blob = new Blob([exportProfileJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `the-expert-profile-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function doImport(file: File) {
    const text = await file.text();
    const res = importProfileJson(text);
    alert(res.ok ? `Imported: ${res.summary}` : `Couldn't import: ${res.error}`);
  }
  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => { streamRef.current?.scrollTo(0, 1e9); }, [turns]);

  // Keyboard shortcuts (Phase 2)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); }
      if (mod && e.key === "/") {
        e.preventDefault();
        (document.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
      }
      if (e.key === "Escape") useExpert.getState().stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  return (
    <>
      <div className="topbar">
        <span className="logo"><span className="sloth">🦥</span> THE EXPERT</span>
        <span className="ver">v2.0</span>
        <span className="spacer" />
        <button className={"keybtn" + (apiKey ? " set" : "")} onClick={() => document.dispatchEvent(new CustomEvent("open-key"))}>
          {apiKey ? "Key connected ✓" : "Connect API key"}
        </button>
        <button className="keybtn" onClick={newChat} title="⌘K">New chat</button>
        <button className="keybtn" onClick={doExport} title="Download your learned profile">↓ Export</button>
        <button className="keybtn" onClick={() => fileRef.current?.click()} title="Load a profile">↑ Import</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ""; }} />
        <button className="keybtn" onClick={() => { if (confirm("Clear all learning, ratings and savings?")) resetAll(); }}>Reset</button>
      </div>
      {storageWarning && <div className="storage-warn">⚠️ browser storage full — old turns are being trimmed to keep going</div>}
      <div className="main">
        <div className="chat">
          <div className="stream" ref={streamRef}>
            {turns.length === 0 && <div className="empty">Ask anything to begin. I'll pick the right model and learn what you like.<br/><span style={{fontSize:11}}>⌘K new chat · ⌘/ focus · Esc stop</span></div>}
            {turns.map((t) => <Message key={t.id} turn={t} />)}
          </div>
          <Composer />
        </div>
        <SidePanel />
      </div>
      <KeyModal />
    </>
  );
}
