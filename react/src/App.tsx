import { useEffect, useRef } from "react";
import { useExpert } from "./store/useExpert";
import { Composer } from "./components/Composer";
import { Message } from "./components/Message";
import { SidePanel } from "./components/SidePanel/SidePanel";
import { KeyModal } from "./components/KeyModal";

export default function App() {
  const { apiKey, turns, newChat, resetAll, storageWarning } = useExpert();
  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => { streamRef.current?.scrollTo(0, 1e9); }, [turns]);

  return (
    <>
      <div className="topbar">
        <span className="logo"><span className="sloth">🦥</span> THE EXPERT</span>
        <span className="ver">v2.0</span>
        <span className="spacer" />
        <button className={"keybtn" + (apiKey ? " set" : "")} onClick={() => document.dispatchEvent(new CustomEvent("open-key"))}>
          {apiKey ? "Key connected ✓" : "Connect API key"}
        </button>
        <button className="keybtn" onClick={newChat}>New chat</button>
        <button className="keybtn" onClick={() => { if (confirm("Clear all learning, ratings and savings?")) resetAll(); }}>Reset</button>
      </div>
      {storageWarning && <div className="storage-warn">⚠️ browser storage full — old turns are being trimmed to keep going</div>}
      <div className="main">
        <div className="chat">
          <div className="stream" ref={streamRef}>
            {turns.length === 0 && <div className="empty">Ask anything to begin. I'll pick the right model and learn what you like.</div>}
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
