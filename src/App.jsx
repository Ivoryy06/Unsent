// Unsent — write messages you'll never send.
// Hold the feeling until you're ready to let go.
// Stack: React + Vite, Flask backend, SQLite, offline-first (IndexedDB cache).

import { useState, useEffect, useCallback, useRef } from "react";

// ── Config ────────────────────────────────────────────────────────────────────

const API_BASE    = import.meta.env.VITE_API_BASE ?? "";
const IS_WEB_MODE = !API_BASE || import.meta.env.VITE_WEB_MODE === "true";
const GEMINI_MODEL = "gemini-2.0-flash";

const EMOTIONS = ["joy","sadness","anger","fear","disgust","surprise","anxiety","love","grief","hope","shame","pride","longing","regret","neutral"];

const EMOTION_COLOR = {
  joy:"#c9a84c", sadness:"#5b7aaa", anger:"#a05050", fear:"#7a5a8a",
  disgust:"#4a7a5a", surprise:"#8a6a3a", anxiety:"#8a4a4a", love:"#9a5070",
  grief:"#4a5a6a", hope:"#4a7a8a", shame:"#6a5040", pride:"#8a6a30",
  longing:"#5a5a8a", regret:"#6a5a4a", neutral:"#5a5258",
};

const RECIPIENTS = [
  { key: "person",  label: "a person" },
  { key: "moment",  label: "a moment" },
  { key: "self",    label: "myself"   },
];

// Closure prompts — quiet, not clinical. User-initiated only.
const CLOSURE_PROMPTS = [
  "Why did this go unsent?",
  "What did you most hope they — or you — would understand?",
  "What has carrying this felt like?",
  "What would it mean if they never knew?",
  "Is there anything you'd want to say now, just for yourself?",
];

// ── Color theme ──────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex, pct) {
  const [r, g, b] = hexToRgb(hex);
  const m = (c) => Math.round(c + (255 - c) * pct).toString(16).padStart(2, "0");
  return `#${m(r)}${m(g)}${m(b)}`;
}

function applyAccent(hex) {
  const r = document.documentElement;
  r.style.setProperty("--accent",       hex);
  r.style.setProperty("--seal",         hex);
  r.style.setProperty("--accent-soft",  mix(hex, 0.88));
  r.style.setProperty("--border",       mix(hex, 0.55));
  r.style.setProperty("--border-soft",  mix(hex, 0.72));
  r.style.setProperty("--resolved",     mix(hex, 0.82));
  r.style.setProperty("--resolved-text",mix(hex, 0.35));
}

// ── IndexedDB (offline cache) ─────────────────────────────────────────────────

const IDB_NAME  = "unsent_offline";
const IDB_STORE = "pending_messages";

function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(IDB_STORE, { keyPath: "local_id", autoIncrement: true });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e);
  });
}

async function idbAdd(entry) {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).add(entry);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function idbGetAll() {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function idbClear() {
  const db = await openIDB();
  return new Promise((res, rej) => {
    const req = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).clear();
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

// ── Gemini (web mode — emotion tagging only) ──────────────────────────────────

async function callGemini(apiKey, prompt) {
  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
  const data = await resp.json();
  return data.candidates[0].content.parts[0].text.trim();
}

async function tagEmotion(apiKey, body) {
  const result = await callGemini(apiKey,
    `Identify the single dominant emotion in this unsent message. Choose exactly one from: ${EMOTIONS.join(", ")}. Reply with only the emotion word.\n\n${body}`
  );
  const e = result.toLowerCase().trim();
  return EMOTIONS.includes(e) ? e : "neutral";
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ── Tiny shared components ────────────────────────────────────────────────────

const Spinner = () => (
  <span style={{ display:"inline-block", width:14, height:14, border:"1.5px solid var(--accent)", borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.7s linear infinite", verticalAlign:"middle" }}/>
);

const EmotionDot = ({ emotion, size=8 }) => (
  <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background: EMOTION_COLOR[emotion] ?? "#5a5258", flexShrink:0 }} title={emotion}/>
);

const Toast = ({ msg, onDone }) => {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)", background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:6, padding:"9px 18px", fontSize:12, color:"var(--text-dim)", zIndex:999 }}>
      {msg}
    </div>
  );
};

// ── Closure Mode ──────────────────────────────────────────────────────────────
// Entirely user-initiated. The app never suggests, reminds, or nudges.
// A short guided flow of quiet prompts. At the end the message is sealed,
// not deleted — it moves to the resolved archive, still fully readable.

function ClosureMode({ message, onComplete, onCancel }) {
  const [step,      setStep]      = useState(0);   // 0 = intro, 1–5 = prompts, 6 = done
  const [responses, setResponses] = useState(Array(CLOSURE_PROMPTS.length).fill(""));
  const [saving,    setSaving]    = useState(false);
  const taRef = useRef(null);

  useEffect(() => { taRef.current?.focus(); }, [step]);

  const totalSteps = CLOSURE_PROMPTS.length;
  const isPrompt   = step >= 1 && step <= totalSteps;
  const promptIdx  = step - 1;

  function updateResponse(val) {
    setResponses(r => { const n = [...r]; n[promptIdx] = val; return n; });
  }

  async function finish() {
    setSaving(true);
    try {
      if (API_BASE) {
        await fetch(`${API_BASE}/api/messages/${message.id}/closure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ responses }),
        });
      }
      onComplete(responses);
    } finally {
      setSaving(false);
    }
  }

  const s = {
    overlay: { position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:"1.5rem", animation:"fadeIn 0.25s ease" },
    box:     { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:12, padding:"2rem", maxWidth:520, width:"100%", display:"flex", flexDirection:"column", gap:"1.5rem" },
    label:   { fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em", color:"var(--muted)" },
    prompt:  { fontSize:17, lineHeight:1.7, color:"var(--text)", fontStyle:"italic" },
    ta:      { width:"100%", background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 14px", fontSize:14, lineHeight:1.8, color:"var(--text)", resize:"vertical", minHeight:100 },
    btn:     (primary) => ({ padding:"9px 20px", fontSize:13, borderRadius:6, border:"1px solid", cursor:"pointer", background: primary ? "var(--seal)" : "none", color: primary ? "var(--text)" : "var(--muted)", borderColor: primary ? "var(--border)" : "var(--border-soft)" }),
    row:     { display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 },
  };

  // Intro screen
  if (step === 0) return (
    <div style={s.overlay}>
      <div style={s.box}>
        <div>
          <div style={s.label}>Closure Mode</div>
          <p style={{ marginTop:10, fontSize:14, lineHeight:1.9, color:"var(--text-dim)" }}>
            This is a short, quiet conversation — just for you. A few gentle questions about this message. There are no right answers. You can skip any prompt you're not ready for.
          </p>
          <p style={{ marginTop:10, fontSize:14, lineHeight:1.9, color:"var(--text-dim)" }}>
            At the end, the message won't disappear. It will be sealed — still here, still yours, but set down.
          </p>
        </div>
        <div style={s.row}>
          <button style={s.btn(false)} onClick={onCancel}>Not yet</button>
          <button style={s.btn(true)}  onClick={() => setStep(1)}>Begin</button>
        </div>
      </div>
    </div>
  );

  // Prompt steps
  if (isPrompt) return (
    <div style={s.overlay}>
      <div style={s.box}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={s.label}>{step} / {totalSteps}</span>
          <div style={{ display:"flex", gap:4 }}>
            {CLOSURE_PROMPTS.map((_, i) => (
              <span key={i} style={{ width:6, height:6, borderRadius:"50%", background: i < step ? "var(--accent)" : "var(--border)", display:"inline-block" }}/>
            ))}
          </div>
        </div>
        <p style={s.prompt}>{CLOSURE_PROMPTS[promptIdx]}</p>
        <textarea
          ref={taRef}
          style={s.ta}
          value={responses[promptIdx]}
          onChange={e => updateResponse(e.target.value)}
          placeholder="Write as little or as much as you need…"
          rows={4}
        />
        <div style={s.row}>
          <button style={s.btn(false)} onClick={() => setStep(prev => prev - 1)}>Back</button>
          <div style={{ display:"flex", gap:8 }}>
            <button style={s.btn(false)} onClick={() => step < totalSteps ? setStep(prev => prev + 1) : finish()}>
              Skip
            </button>
            <button style={s.btn(true)} onClick={() => step < totalSteps ? setStep(prev => prev + 1) : finish()}>
              {step < totalSteps ? "Next" : (saving ? <Spinner/> : "Seal this message")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Done — this screen is never shown; onComplete fires immediately after finish()
  return null;
}

// ── Message Card ──────────────────────────────────────────────────────────────

function MessageCard({ message, onDelete, onResolved }) {
  const [expanded,    setExpanded]    = useState(false);
  const [inClosure,   setInClosure]   = useState(false);
  const [closureData, setClosureData] = useState(null); // loaded on expand if resolved
  const [loadingClosure, setLoadingClosure] = useState(false);

  const resolved = !!message.resolved;
  const date = new Date(message.created_at * 1000).toLocaleString(undefined, {
    month:"short", day:"numeric", year:"numeric", hour:"2-digit", minute:"2-digit"
  });

  const recipientLabel = message.recipient_label
    ? `to ${message.recipient_label}`
    : message.recipient === "self" ? "to myself"
    : message.recipient === "moment" ? "to a moment"
    : "to a person";

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && resolved && !closureData && API_BASE) {
      setLoadingClosure(true);
      try {
        const r = await fetch(`${API_BASE}/api/messages/${message.id}/closure`);
        const d = await r.json();
        if (d.length) setClosureData(d);
      } finally {
        setLoadingClosure(false);
      }
    }
  }

  function handleClosureComplete(responses) {
    setInClosure(false);
    onResolved(message.id, responses);
  }

  const cardStyle = {
    background:   resolved ? "var(--resolved)"  : "var(--surface)",
    border:       `1px solid ${resolved ? "var(--border-soft)" : "var(--border)"}`,
    borderRadius: 10,
    padding:      "14px 16px",
    marginBottom: 8,
    opacity:      resolved ? 0.72 : 1,
    transition:   "opacity 0.3s",
    animation:    "fadeIn 0.2s ease",
  };

  return (
    <>
      {inClosure && (
        <ClosureMode
          message={message}
          onComplete={handleClosureComplete}
          onCancel={() => setInClosure(false)}
        />
      )}
      <div style={cardStyle}>
        {/* Header row */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
          <EmotionDot emotion={message.emotion} size={8}/>
          <span style={{ fontSize:12, color: resolved ? "var(--resolved-text)" : "var(--text-dim)", flex:1 }}>
            {recipientLabel} · {date}
          </span>
          {resolved && (
            <span style={{ fontSize:10, letterSpacing:"0.08em", textTransform:"uppercase", color:"var(--muted)", padding:"2px 7px", border:"1px solid var(--border-soft)", borderRadius:20 }}>
              sealed
            </span>
          )}
          <button
            onClick={() => onDelete(message.id)}
            style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:13, padding:2, lineHeight:1 }}
            title="Delete"
          >✕</button>
        </div>

        {/* Body */}
        <p style={{ fontSize:14, lineHeight:1.85, color: resolved ? "var(--resolved-text)" : "var(--text)", margin:0, whiteSpace:"pre-wrap", fontFamily:"'Lora', Georgia, serif" }}>
          {message.body}
        </p>

        {/* Footer actions */}
        <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:10 }}>
          {resolved && (
            <button onClick={toggleExpand} style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:"var(--muted)", padding:0 }}>
              {expanded ? "▲ hide" : "▼ what you wrote"}
            </button>
          )}
          {!resolved && (
            <button
              onClick={() => setInClosure(true)}
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:"var(--muted)", padding:0 }}
            >
              begin closure
            </button>
          )}
        </div>

        {/* Closure responses (resolved messages, expanded) */}
        {expanded && resolved && (
          <div style={{ marginTop:12, borderTop:"1px solid var(--border-soft)", paddingTop:12, display:"flex", flexDirection:"column", gap:12 }}>
            {loadingClosure && <span style={{ fontSize:12, color:"var(--muted)" }}><Spinner/></span>}
            {closureData && closureData.map((item, i) => (
              <div key={i}>
                <div style={{ fontSize:11, color:"var(--muted)", marginBottom:3, fontStyle:"italic" }}>{item.prompt}</div>
                <p style={{ fontSize:13, lineHeight:1.8, color:"var(--resolved-text)", whiteSpace:"pre-wrap" }}>{item.response}</p>
              </div>
            ))}
            {!loadingClosure && !closureData && (
              <p style={{ fontSize:12, color:"var(--muted)", fontStyle:"italic" }}>No responses recorded.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [tab,          setTab]          = useState("write");
  const [body,         setBody]         = useState("");
  const [recipient,    setRecipient]    = useState("self");
  const [recipLabel,   setRecipLabel]   = useState("");
  const [messages,     setMessages]     = useState(() => lsGet("unsent_messages", []));
  const [loading,      setLoading]      = useState(false);
  const [toast,        setToast]        = useState(null);
  const [apiKey,       setApiKey]       = useState(() => localStorage.getItem("unsent_gemini_key") || "");
  const [showKey,      setShowKey]      = useState(false);
  const [accentHex,    setAccentHex]    = useState(() => localStorage.getItem("unsent_accent") || "");

  useEffect(() => { if (accentHex) applyAccent(accentHex); }, []);
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);
  const [backendOk,    setBackendOk]    = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Filters for the timeline
  const [filterEmotion,   setFilterEmotion]   = useState("");
  const [filterRecipient, setFilterRecipient] = useState("");
  const [filterResolved,  setFilterResolved]  = useState("open"); // "open" | "resolved" | "all"

  // ── online/offline ──
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── backend health ──
  useEffect(() => {
    if (IS_WEB_MODE) { setBackendOk(false); return; }
    fetch(`${API_BASE}/api/health`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setBackendOk(!!d))
      .catch(() => setBackendOk(false));
  }, []);

  // ── load messages from backend ──
  useEffect(() => {
    if (!backendOk) return;
    fetch(`${API_BASE}/api/messages`)
      .then(r => r.json())
      .then(data => { setMessages(data); lsSet("unsent_messages", data); })
      .catch(() => {});
  }, [backendOk]);

  // ── pending offline count ──
  useEffect(() => {
    idbGetAll().then(items => setPendingCount(items.length)).catch(() => {});
  }, []);

  // ── sync offline cache when back online ──
  useEffect(() => {
    if (!isOnline || !backendOk) return;
    idbGetAll().then(async items => {
      if (!items.length) return;
      const resp = await fetch(`${API_BASE}/api/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: items }),
      });
      if (resp.ok) {
        await idbClear();
        setPendingCount(0);
        setToast(`Synced ${items.length} offline ${items.length === 1 ? "message" : "messages"}`);
        fetch(`${API_BASE}/api/messages`).then(r => r.json()).then(data => { setMessages(data); lsSet("unsent_messages", data); });
      }
    }).catch(() => {});
  }, [isOnline, backendOk]);

  // ── submit message ──
  const submit = useCallback(async () => {
    if (!body.trim()) return;
    setLoading(true);
    try {
      const payload = { body: body.trim(), recipient, recipient_label: recipLabel.trim() };

      if (backendOk) {
        const resp = await fetch(`${API_BASE}/api/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await resp.json();
        const updated = [data, ...messages];
        setMessages(updated);
        lsSet("unsent_messages", updated);
      } else if (isOnline && apiKey) {
        const emotion = await tagEmotion(apiKey, body.trim());
        const entry   = { id: Date.now(), created_at: Date.now() / 1000, ...payload, emotion, resolved: 0 };
        const updated = [entry, ...messages];
        setMessages(updated);
        lsSet("unsent_messages", updated);
      } else {
        await idbAdd({ ...payload, created_at: Date.now() / 1000 });
        const entry   = { id: Date.now(), created_at: Date.now() / 1000, ...payload, emotion: "neutral", resolved: 0 };
        const updated = [entry, ...messages];
        setMessages(updated);
        lsSet("unsent_messages", updated);
        setPendingCount(c => c + 1);
        setToast("Saved offline — will sync when connected");
      }

      setBody("");
      setRecipLabel("");
      setTab("timeline");
    } catch (e) {
      setToast("Something went wrong: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [body, recipient, recipLabel, messages, backendOk, isOnline, apiKey]);

  // ── delete ──
  const deleteMessage = useCallback(async (id) => {
    if (backendOk) {
      await fetch(`${API_BASE}/api/messages/${id}`, { method: "DELETE" }).catch(() => {});
    }
    const updated = messages.filter(m => m.id !== id);
    setMessages(updated);
    lsSet("unsent_messages", updated);
  }, [messages, backendOk]);

  // ── mark resolved (after closure) ──
  const markResolved = useCallback((id) => {
    const updated = messages.map(m => m.id === id ? { ...m, resolved: 1, resolved_at: Date.now() / 1000 } : m);
    setMessages(updated);
    lsSet("unsent_messages", updated);
  }, [messages]);

  // ── filtered timeline ──
  const filtered = messages.filter(m => {
    if (filterResolved === "open"     && m.resolved)  return false;
    if (filterResolved === "resolved" && !m.resolved) return false;
    if (filterEmotion   && m.emotion   !== filterEmotion)   return false;
    if (filterRecipient && m.recipient !== filterRecipient) return false;
    return true;
  });

  const usedEmotions   = [...new Set(messages.map(m => m.emotion).filter(Boolean))];
  const canSubmit      = body.trim().length >= 3 && !loading && (backendOk || (isOnline && apiKey) || !isOnline);
  const webMode        = !backendOk;

  const s = {
    tab: (id) => ({
      padding:"8px 16px", fontSize:13, border:"none", cursor:"pointer", borderBottom:"2px solid",
      background:"none", fontFamily:"inherit",
      color:       tab===id ? "var(--text)"   : "var(--muted)",
      borderColor: tab===id ? "var(--accent)" : "transparent",
      fontWeight:  tab===id ? 500 : 400,
    }),
    filterBtn: (active) => ({
      padding:"4px 12px", fontSize:12, borderRadius:20, border:"1px solid", cursor:"pointer",
      background: active ? "var(--seal)" : "none",
      color:      active ? "var(--text)" : "var(--muted)",
      borderColor: active ? "var(--border)" : "var(--border-soft)",
    }),
    select: { background:"var(--surface-2)", border:"1px solid var(--border-soft)", borderRadius:6, padding:"4px 8px", fontSize:12, color:"var(--text-dim)", cursor:"pointer" },
  };

  return (
    <div style={{ fontFamily:"system-ui, -apple-system, sans-serif", maxWidth:640, margin:"0 auto", padding:"2.5rem 1.25rem", minHeight:"100vh" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:"2.5rem" }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:600, margin:0, color:"var(--text)", letterSpacing:"-0.2px" }}>Unsent</h1>
          <p style={{ fontSize:12, color:"var(--muted)", margin:"3px 0 0", fontStyle:"italic" }}>hold the feeling until you're ready to let go</p>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {pendingCount > 0 && (
            <span style={{ fontSize:11, padding:"3px 8px", borderRadius:20, background:"var(--surface-2)", color:"var(--text-dim)", border:"1px solid var(--border-soft)" }}>
              {pendingCount} pending
            </span>
          )}
          <span style={{ fontSize:11, padding:"3px 10px", borderRadius:20, border:"1px solid var(--border-soft)", color:"var(--muted)" }}>
            {isOnline ? (backendOk ? "local" : "web") : "offline"}
          </span>
          {webMode && (
            <button onClick={() => setShowKey(v => !v)} style={{ fontSize:12, padding:"4px 10px", borderRadius:6, border:"1px solid var(--border-soft)", background:"var(--surface)", cursor:"pointer", color:"var(--text-dim)" }}>
              {apiKey ? "key set" : "API key"}
            </button>
          )}
          <input
            type="color"
            title="Accent color"
            value={accentHex || "#111111"}
            onChange={e => {
              const hex = e.target.value;
              setAccentHex(hex);
              localStorage.setItem("unsent_accent", hex);
              applyAccent(hex);
            }}
            style={{ width:28, height:28, padding:2, border:"1px solid var(--border-soft)", borderRadius:6, cursor:"pointer", background:"var(--surface)" }}
          />
        </div>
      </div>

      {/* API key input (web mode) */}
      {webMode && showKey && (
        <div style={{ marginBottom:"1.5rem", padding:"12px 16px", background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8 }}>
          <label style={{ fontSize:11, color:"var(--muted)", display:"block", marginBottom:6 }}>Gemini API Key — stored in this browser only, never sent anywhere else</label>
          <input type="password" value={apiKey}
            onChange={e => { setApiKey(e.target.value); localStorage.setItem("unsent_gemini_key", e.target.value); }}
            placeholder="AIza…"
            style={{ width:"100%", padding:"8px 10px", fontSize:13, border:"1px solid var(--border)", borderRadius:6, fontFamily:"monospace", background:"var(--bg)", color:"var(--text)", boxSizing:"border-box" }}
          />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:"1px solid var(--border-soft)", marginBottom:"1.75rem", gap:2 }}>
        {[["write","Write"],["timeline","Timeline"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={s.tab(id)}>{label}</button>
        ))}
      </div>

      {/* ── WRITE ── */}
      {tab === "write" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>

          {/* Recipient */}
          <div>
            <div style={{ fontSize:11, textTransform:"uppercase", letterSpacing:"0.08em", color:"var(--muted)", marginBottom:8 }}>This message is for</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {RECIPIENTS.map(r => (
                <button key={r.key} onClick={() => setRecipient(r.key)} style={{
                  padding:"7px 16px", fontSize:13, borderRadius:6, border:"1px solid", cursor:"pointer",
                  background:   recipient === r.key ? "var(--seal)"        : "none",
                  color:        recipient === r.key ? "var(--text)"        : "var(--muted)",
                  borderColor:  recipient === r.key ? "var(--border)"      : "var(--border-soft)",
                }}>
                  {r.label}
                </button>
              ))}
            </div>
            {recipient !== "self" && (
              <input
                value={recipLabel}
                onChange={e => setRecipLabel(e.target.value)}
                placeholder={recipient === "person" ? "their name (optional)" : "describe the moment (optional)"}
                style={{ marginTop:8, width:"100%", padding:"8px 12px", fontSize:13, background:"var(--surface-2)", border:"1px solid var(--border-soft)", borderRadius:6, color:"var(--text)", boxSizing:"border-box" }}
              />
            )}
          </div>

          {/* Message body */}
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write what you couldn't say…"
            rows={9}
            style={{ width:"100%", padding:"16px", fontSize:15, lineHeight:1.9, border:"1px solid var(--border)", borderRadius:10, fontFamily:"'Lora', Georgia, serif", color:"var(--text)", background:"var(--surface)", resize:"vertical", boxSizing:"border-box" }}
          />

          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:12, color:"var(--muted)" }}>{body.trim().split(/\s+/).filter(Boolean).length} words</span>
            <button onClick={submit} disabled={!canSubmit} style={{
              padding:"9px 22px", fontSize:13, fontWeight:500, borderRadius:7, border:"1px solid", cursor: canSubmit ? "pointer" : "not-allowed",
              background:  canSubmit ? "var(--seal)"        : "none",
              color:       canSubmit ? "var(--text)"        : "var(--muted)",
              borderColor: canSubmit ? "var(--border)"      : "var(--border-soft)",
              display:"flex", alignItems:"center", gap:8,
            }}>
              {loading ? <><Spinner/> Saving…</> : "Keep this"}
            </button>
          </div>
        </div>
      )}

      {/* ── TIMELINE ── */}
      {tab === "timeline" && (
        <div>
          {/* Filters */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:"1.25rem", alignItems:"center" }}>
            {/* Resolved filter */}
            {[["open","open"],["resolved","sealed"],["all","all"]].map(([val, label]) => (
              <button key={val} onClick={() => setFilterResolved(val)} style={s.filterBtn(filterResolved === val)}>
                {label}
              </button>
            ))}

            <div style={{ flex:1 }}/>

            {/* Emotion filter */}
            <select value={filterEmotion} onChange={e => setFilterEmotion(e.target.value)} style={s.select}>
              <option value="">all emotions</option>
              {usedEmotions.map(em => <option key={em} value={em}>{em}</option>)}
            </select>

            {/* Recipient filter */}
            <select value={filterRecipient} onChange={e => setFilterRecipient(e.target.value)} style={s.select}>
              <option value="">all recipients</option>
              {RECIPIENTS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <p style={{ color:"var(--muted)", fontSize:14, fontStyle:"italic" }}>
              {messages.length === 0 ? "Nothing here yet." : "No messages match these filters."}
            </p>
          ) : (
            filtered.map(m => (
              <MessageCard
                key={m.id}
                message={m}
                onDelete={deleteMessage}
                onResolved={markResolved}
              />
            ))
          )}
        </div>
      )}

      {toast && <Toast msg={toast} onDone={() => setToast(null)}/>}
    </div>
  );
}
