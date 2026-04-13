CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   REAL    NOT NULL,
    body         TEXT    NOT NULL,
    recipient    TEXT    NOT NULL DEFAULT 'self',  -- 'person' | 'moment' | 'self'
    recipient_label TEXT,                           -- free-text name/label
    emotion      TEXT,
    resolved     INTEGER NOT NULL DEFAULT 0,        -- 0 = open, 1 = resolved
    resolved_at  REAL
);

CREATE TABLE IF NOT EXISTS closure_responses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    prompt     TEXT    NOT NULL,
    response   TEXT    NOT NULL,
    seq        INTEGER NOT NULL
);
