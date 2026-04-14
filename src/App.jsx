// Unsent — write messages you'll never send.
// Hold the feeling until you're ready to let go.
// Stack: React + Vite, Flask backend, SQLite, offline-first (IndexedDB cache).

import { useState, useEffect, useCallback, useRef } from "react";

// ── Config ────────────────────────────────────────────────────────────────────

const API_BASE    = import.meta.env.VITE_API_BASE ?? "";
const IS_WEB_MODE = !API_BASE || import.meta.env.VITE_WEB_MODE === "true";
const GROQ_MODEL = "llama3-8b-8192";


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
  const [rv, g, b] = hexToRgb(hex);
  const lum = (0.299 * rv + 0.587 * g + 0.114 * b) / 255;
  const onAccent = lum > 0.55 ? "#1a1a18" : "#fafaf8";
  r.style.setProperty("--accent",       hex);
  r.style.setProperty("--seal",         hex);
  r.style.setProperty("--on-accent",    onAccent);
  r.style.setProperty("--bg",           mix(hex, 0.94));
  r.style.setProperty("--surface",      mix(hex, 0.88));
  r.style.setProperty("--surface-2",    mix(hex, 0.82));
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

// ── Groq (web mode — emotion tagging only) ───────────────────────────────────

async function tagEmotion(apiKey, body) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: `Identify the single dominant emotion in this unsent message. Choose exactly one from: ${EMOTIONS.join(", ")}. Reply with only the emotion word.\n\n${body}` }],
      max_tokens: 10,
    }),
  });
  if (!resp.ok) throw new Error(`Groq ${resp.status}`);
  const data = await resp.json();
  const e = data.choices[0].message.content.trim().toLowerCase();
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
  <span style={{ display:"inline-block", width:14, height:14, border:"2px solid rgba(13,13,15,0.3)", borderTopColor:"#0d0d0f", borderRadius:"50%", animation:"spin 0.7s linear infinite", verticalAlign:"middle" }}/>
);

const EmotionDot = ({ emotion, size=8 }) => (
  <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background: EMOTION_COLOR[emotion] ?? "#4a4a5a", flexShrink:0 }} title={emotion}/>
);

const Toast = ({ msg, onDone }) => {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return <div className="toast">{msg}</div>;
};

// ── Closure Mode ──────────────────────────────────────────────────────────────

function ClosureMode({ message, onComplete, onCancel }) {
  const [step,      setStep]      = useState(0);
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

  if (step === 0) return (
    <div className="closure-overlay">
      <div className="closure-box">
        <div>
          <div className="closure-step-label">Closure Mode</div>
          <p style={{ marginTop:10, fontSize:14, lineHeight:1.9, color:"var(--text-dim)" }}>
            A short, quiet conversation — just for you. A few gentle questions about this message. No right answers. Skip anything you're not ready for.
          </p>
          <p style={{ marginTop:10, fontSize:14, lineHeight:1.9, color:"var(--text-dim)" }}>
            At the end, the message won't disappear. It will be sealed — still here, still yours, but set down.
          </p>
        </div>
        <div className="closure-row">
          <button className="closure-btn" onClick={onCancel}>Not yet</button>
          <button className="closure-btn primary" onClick={() => setStep(1)}>Begin</button>
        </div>
      </div>
    </div>
  );

  if (isPrompt) return (
    <div className="closure-overlay">
      <div className="closure-box">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span className="closure-step-label">{step} / {totalSteps}</span>
          <div className="closure-dots">
            {CLOSURE_PROMPTS.map((_, i) => (
              <span key={i} className={`closure-dot ${i < step ? "done" : ""}`}/>
            ))}
          </div>
        </div>
        <p className="closure-prompt">{CLOSURE_PROMPTS[promptIdx]}</p>
        <textarea
          ref={taRef}
          className="closure-textarea"
          value={responses[promptIdx]}
          onChange={e => updateResponse(e.target.value)}
          placeholder="Write as little or as much as you need…"
          rows={4}
        />
        <div className="closure-row">
          <button className="closure-btn" onClick={() => setStep(p => p - 1)}>Back</button>
          <div style={{ display:"flex", gap:8 }}>
            <button className="closure-btn" onClick={() => step < totalSteps ? setStep(p => p + 1) : finish()}>Skip</button>
            <button className="closure-btn primary" onClick={() => step < totalSteps ? setStep(p => p + 1) : finish()}>
              {step < totalSteps ? "Next" : (saving ? <Spinner/> : "Seal this message")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return null;
}

// ── Message Card ──────────────────────────────────────────────────────────────

function MessageCard({ message, onDelete, onResolved }) {
  const [expanded,       setExpanded]       = useState(false);
  const [inClosure,      setInClosure]      = useState(false);
  const [closureData,    setClosureData]    = useState(null);
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

  return (
    <>
      {inClosure && (
        <ClosureMode
          message={message}
          onComplete={(responses) => { setInClosure(false); onResolved(message.id, responses); }}
          onCancel={() => setInClosure(false)}
        />
      )}
      <div className={`message-card ${resolved ? "resolved" : ""}`}>
        <div className="message-meta">
          <EmotionDot emotion={message.emotion}/>
          <span className="message-to">{recipientLabel} · {date}</span>
          {resolved && <span className="sealed-tag">sealed</span>}
          <button className="delete-btn" onClick={() => onDelete(message.id)} title="Delete">✕</button>
        </div>

        <p className="message-body">{message.body}</p>

        <div className="message-actions">
          {resolved && (
            <button className="action-btn" onClick={toggleExpand}>
              {expanded ? "▲ hide" : "▼ what you wrote"}
            </button>
          )}
          {!resolved && (
            <button className="action-btn" onClick={() => setInClosure(true)}>
              begin closure
            </button>
          )}
        </div>

        {expanded && resolved && (
          <div className="closure-responses">
            {loadingClosure && <span style={{ fontSize:12, color:"var(--muted)" }}><Spinner/></span>}
            {closureData && closureData.map((item, i) => (
              <div key={i}>
                <div className="closure-prompt-label">{item.prompt}</div>
                <p className="closure-response-text">{item.response}</p>
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
  const [apiKey,       setApiKey]       = useState(() => localStorage.getItem("unsent_groq_key") || "");
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
      padding:"9px 18px", fontSize:13, border:"none", cursor:"pointer", borderBottom:"2px solid",
      background:"none", fontFamily:"inherit",
      color:       tab===id ? "var(--text)"   : "var(--muted)",
      borderColor: tab===id ? "var(--accent)" : "transparent",
      fontWeight:  tab===id ? 500 : 400,
    }),
    filterBtn: (active) => ({
      padding:"5px 14px", fontSize:12, borderRadius:20, border:"1px solid", cursor:"pointer",
      background: active ? "var(--seal)" : "none",
      color:      active ? "var(--on-accent)"   : "var(--muted)",
      borderColor: active ? "var(--seal)" : "var(--border-soft)",
    }),
    select: { background:"var(--surface)", border:"1px solid var(--border-soft)", borderRadius:10, padding:"5px 10px", fontSize:12, color:"var(--text-dim)", cursor:"pointer" },
  };

  return (
    <>
      {/* ── Topbar ── */}
      <header className="topbar">
        <div className="topbar-brand">
          <h1>Unsent</h1>
          <span>hold the feeling until you're ready to let go</span>
        </div>

        <nav className="topbar-nav">
          {[["write","Write"],["timeline","Timeline"]].map(([id, label]) => (
            <button key={id} className={`topbar-btn ${tab===id?"active":""}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>

        <div className="topbar-right">
          {pendingCount > 0 && (
            <span style={{ fontSize:11, padding:"3px 9px", borderRadius:20, background:"rgba(251,191,36,0.1)", color:"#fbbf24", border:"1px solid rgba(251,191,36,0.25)" }}>
              {pendingCount} pending
            </span>
          )}
          <span className="status-pill" style={{
            background:  isOnline ? "var(--green-bg)" : "var(--red-bg)",
            color:       isOnline ? "var(--green)"    : "var(--red)",
            borderColor: isOnline ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)",
          }}>
            ● {isOnline ? (backendOk ? "local" : "web") : "offline"}
          </span>
          {webMode && (
            <button onClick={() => setShowKey(v => !v)} style={{ fontSize:12, padding:"5px 10px", borderRadius:7, border:"1px solid var(--border)", background:"var(--surface)", cursor:"pointer", color:"var(--text-dim)" }}>
              {apiKey ? "🔑 key set" : "🔑 API key"}
            </button>
          )}
        </div>
      </header>

      {/* ── Page ── */}
      <div className="page">

        {webMode && showKey && (
          <div className="api-key-panel">
            <label>Groq API Key — stored in this browser only</label>
            <input type="password" value={apiKey}
              onChange={e => { setApiKey(e.target.value); localStorage.setItem("unsent_groq_key", e.target.value); }}
              placeholder="gsk_…"
            />
          </div>
        )}

        {/* ── WRITE ── */}
        {tab === "write" && (
          <div>
            <h2 className="write-heading">Write what you couldn't say.</h2>

            <div className="recipient-label">This message is for</div>
            <div className="recipient-tabs">
              {RECIPIENTS.map(r => (
                <button key={r.key} className={`recipient-tab ${recipient===r.key?"active":""}`} onClick={() => setRecipient(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>

            {recipient !== "self" && (
              <input className="recipient-input" value={recipLabel}
                onChange={e => setRecipLabel(e.target.value)}
                placeholder={recipient === "person" ? "their name (optional)" : "describe the moment (optional)"}
              />
            )}

            <textarea className="journal-textarea" value={body} onChange={e => setBody(e.target.value)}
              placeholder="Start writing…"
              rows={10}
            />

            <div className="write-footer">
              <span className="word-count">{body.trim().split(/\s+/).filter(Boolean).length} words</span>
              <button className="submit-btn" onClick={submit} disabled={!canSubmit}>
                {loading ? <><Spinner/> Saving…</> : "Keep this"}
              </button>
            </div>
          </div>
        )}

        {/* ── TIMELINE ── */}
        {tab === "timeline" && (
          <div>
            <div className="filters">
              {[["open","open"],["resolved","sealed"],["all","all"]].map(([val, label]) => (
                <button key={val} className={`filter-btn ${filterResolved===val?"active":""}`} onClick={() => setFilterResolved(val)}>
                  {label}
                </button>
              ))}
              <div style={{ flex:1 }}/>
              <select className="filter-select" value={filterEmotion} onChange={e => setFilterEmotion(e.target.value)}>
                <option value="">all emotions</option>
                {usedEmotions.map(em => <option key={em} value={em}>{em}</option>)}
              </select>
              <select className="filter-select" value={filterRecipient} onChange={e => setFilterRecipient(e.target.value)}>
                <option value="">all recipients</option>
                {RECIPIENTS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>

            {filtered.length === 0
              ? <p className="empty-state">{messages.length === 0 ? "Nothing here yet." : "No messages match these filters."}</p>
              : filtered.map(m => (
                  <MessageCard key={m.id} message={m} onDelete={deleteMessage} onResolved={markResolved}/>
                ))
            }
          </div>
        )}

      </div>

      {toast && <Toast msg={toast} onDone={() => setToast(null)}/>}
    </>
  );
}
