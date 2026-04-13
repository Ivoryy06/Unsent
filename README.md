[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# Unsent

> *Hold the feeling until you're ready to let go.*

A private space to write messages you'll never send — to people, moments, or yourself. No AI mirrors them back. No suggestions. No nudges. The app just holds them until you decide what to do.

## What it is

Some things go unsaid not because they don't matter, but because sending them would change something you're not ready to change. Unsent gives those things a place to live.

You write a message. You tag it with a recipient — a person, a moment, yourself. It gets stored. That's it. The timeline is a quiet, chronological drawer of everything you've kept. You can filter by emotion, by recipient, by whether something has been resolved or is still open.

Emotion tagging happens silently in the background via Gemini and is used only for filtering. It is never shown as feedback, never reflected back at you.

## Closure Mode

The most significant feature, and the one the app is most careful about.

Closure Mode is entirely user-initiated. The app never suggests it, never reminds you, never surfaces a badge or a count. When you're ready — and only when you're ready — you open a message and choose to begin.

It walks you through five quiet prompts:

1. *Why did this go unsent?*
2. *What did you most hope they — or you — would understand?*
3. *What has carrying this felt like?*
4. *What would it mean if they never knew?*
5. *Is there anything you'd want to say now, just for yourself?*

You can skip any of them. There are no right answers.

At the end, the message doesn't disappear. It gets **sealed** — visually muted, moved to a resolved archive that's still fully readable. Your responses to the prompts are stored alongside it and can be read back at any time. The transformation is the point, not the erasure. The message goes from something unfinished and heavy to something acknowledged and set down.

## Project structure

```
Unsent/
├── server/
│   ├── app.py            # Flask API — messages, emotion tagging, closure
│   ├── schema.sql        # SQLite schema (messages + closure_responses)
│   └── requirements.txt
├── src/
│   ├── App.jsx           # React app — Write, Timeline, Closure Mode
│   ├── index.css         # Dark palette, no light mode
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
└── .env.example
```

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Flask + SQLite (WAL) |
| Offline cache | IndexedDB |
| Emotion tagging | Gemini 2.0 Flash — server-side in local mode, direct from browser in web mode |

Same dual local/web mode and offline-first pattern as [Echo](https://github.com/Ivoryy06/Echo).

## Running locally

```bash
# 1. Backend
cd server
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
echo "GEMINI_API_KEY=your_key_here" > .env
python app.py
# → http://localhost:5051

# 2. Frontend (separate terminal)
cd ..
npm install
echo "VITE_API_BASE=http://localhost:5051" > .env
npm run dev
# → http://localhost:5173
```

The SQLite database is created automatically at `server/unsent.db` on first run.

## Web mode (no backend)

Leave `VITE_API_BASE` empty in `.env`. Open the app, click **API key**, and enter your Gemini key. Everything stores in `localStorage` and `IndexedDB` in your browser. Nothing leaves your machine except the Gemini tagging call.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/messages` | List messages (`?resolved=0/1`, `?emotion=`, `?recipient=`) |
| POST | `/api/messages` | Create a message |
| DELETE | `/api/messages/:id` | Delete a message |
| GET | `/api/messages/:id/closure/prompts` | Get the five closure prompts |
| POST | `/api/messages/:id/closure` | Save closure responses + mark resolved |
| GET | `/api/messages/:id/closure` | Read back closure responses |
| POST | `/api/sync` | Sync offline-cached messages |

## Privacy

Everything is local-only. No accounts, no external sync, no analytics. The Gemini API key is read from your local `.env` in local mode and stored only in `localStorage` in web mode — it is never sent to any server other than Google's API directly.

## License

MIT
