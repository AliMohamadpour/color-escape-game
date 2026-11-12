CREATE TABLE IF NOT EXISTS players (
    telegram_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT 'Player',
    level INTEGER NOT NULL DEFAULT 0
        CHECK(level BETWEEN 0 AND 500),
    completed INTEGER NOT NULL DEFAULT 0
        CHECK(completed BETWEEN 0 AND 500),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_players_ranking
ON players(level DESC, completed DESC, updated_at ASC);
