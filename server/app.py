"""
Unsent — Flask backend
Handles: message storage, silent emotion tagging (Gemini), closure mode.
No AI is ever shown to the user. Gemini only tags emotions.
"""

import json, os, sqlite3, time
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app  = Flask(__name__)
CORS(app)

ROOT       = Path(__file__).parent
DB_PATH    = ROOT / "unsent.db"
SCHEMA     = ROOT / "schema.sql"
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.0-flash"

EMOTIONS = ["joy","sadness","anger","fear","disgust","surprise","anxiety","love","grief","hope","shame","pride","longing","regret","neutral"]

# Closure prompts — written to be quiet, not clinical.
# Each is a gentle open question. The user answers in their own time.
CLOSURE_PROMPTS = [
    "Why did this go unsent?",
    "What did you most hope they — or you — would understand?",
    "What has carrying this felt like?",
    "What would it mean if they never knew?",
    "Is there anything you'd want to say now, just for yourself?",
]

# ── DB ────────────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript(SCHEMA.read_text())

# ── Gemini ────────────────────────────────────────────────────────────────────

def gemini(prompt: str) -> str:
    if not GEMINI_KEY:
        return ""
    import urllib.request
    url  = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_KEY}"
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
    req  = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception:
        return ""

def tag_emotion(body: str) -> str:
    result = gemini(
        f"Identify the single dominant emotion in this unsent message. "
        f"Choose exactly one from: {', '.join(EMOTIONS)}. Reply with only the emotion word.\n\n{body}"
    ).lower().strip()
    return result if result in EMOTIONS else "neutral"

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    return jsonify({"ok": True, "gemini": bool(GEMINI_KEY)})

@app.route("/api/messages", methods=["GET"])
def list_messages():
    resolved = request.args.get("resolved")  # "0", "1", or omitted for all
    emotion  = request.args.get("emotion")
    recipient = request.args.get("recipient")

    query  = "SELECT * FROM messages WHERE 1=1"
    params = []
    if resolved is not None:
        query += " AND resolved=?"; params.append(int(resolved))
    if emotion:
        query += " AND emotion=?"; params.append(emotion)
    if recipient:
        query += " AND recipient=?"; params.append(recipient)
    query += " ORDER BY created_at DESC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/messages", methods=["POST"])
def create_message():
    data      = request.get_json()
    body      = data.get("body", "").strip()
    recipient = data.get("recipient", "self")
    label     = data.get("recipient_label", "")
    if not body:
        return jsonify({"error": "body required"}), 400

    emotion = tag_emotion(body)
    now     = time.time()

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO messages (created_at, body, recipient, recipient_label, emotion) VALUES (?,?,?,?,?)",
            (now, body, recipient, label, emotion)
        )
        msg_id = cur.lastrowid

    return jsonify({"id": msg_id, "created_at": now, "body": body,
                    "recipient": recipient, "recipient_label": label,
                    "emotion": emotion, "resolved": 0})

@app.route("/api/messages/<int:mid>", methods=["DELETE"])
def delete_message(mid):
    with get_db() as conn:
        conn.execute("DELETE FROM messages WHERE id=?", (mid,))
    return jsonify({"deleted": mid})

# ── Closure ───────────────────────────────────────────────────────────────────

@app.route("/api/messages/<int:mid>/closure/prompts", methods=["GET"])
def get_closure_prompts(mid):
    """Return the ordered closure prompts. No AI, just the fixed list."""
    return jsonify({"prompts": CLOSURE_PROMPTS})

@app.route("/api/messages/<int:mid>/closure", methods=["POST"])
def complete_closure(mid):
    """
    Receives the user's responses to all closure prompts and marks the message resolved.
    Body: { "responses": ["...", "...", ...] }
    """
    data      = request.get_json()
    responses = data.get("responses", [])
    now       = time.time()

    with get_db() as conn:
        msg = conn.execute("SELECT id FROM messages WHERE id=?", (mid,)).fetchone()
        if not msg:
            return jsonify({"error": "not found"}), 404

        # Store each response
        for i, (prompt, response) in enumerate(zip(CLOSURE_PROMPTS, responses)):
            if response.strip():
                conn.execute(
                    "INSERT INTO closure_responses (message_id, prompt, response, seq) VALUES (?,?,?,?)",
                    (mid, prompt, response.strip(), i)
                )

        conn.execute(
            "UPDATE messages SET resolved=1, resolved_at=? WHERE id=?",
            (now, mid)
        )

    return jsonify({"resolved": True, "resolved_at": now})

@app.route("/api/messages/<int:mid>/closure", methods=["GET"])
def get_closure(mid):
    """Return the closure responses for a resolved message."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT prompt, response, seq FROM closure_responses WHERE message_id=? ORDER BY seq",
            (mid,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])

# ── Offline sync ──────────────────────────────────────────────────────────────

@app.route("/api/sync", methods=["POST"])
def sync():
    entries = request.get_json().get("messages", [])
    synced  = []
    for e in entries:
        body      = e.get("body", "").strip()
        recipient = e.get("recipient", "self")
        label     = e.get("recipient_label", "")
        if not body:
            continue
        emotion = tag_emotion(body)
        now     = e.get("created_at") or time.time()
        with get_db() as conn:
            cur = conn.execute(
                "INSERT INTO messages (created_at, body, recipient, recipient_label, emotion) VALUES (?,?,?,?,?)",
                (now, body, recipient, label, emotion)
            )
            synced.append(cur.lastrowid)
    return jsonify({"synced": len(synced), "ids": synced})

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5051))
    print(f"  Unsent API → http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
