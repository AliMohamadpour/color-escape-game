-- Fresh schema for the Color Escape leaderboard and progress APIs.
-- Apply this on a new D1 database. For an existing database, add the
-- missing columns with ALTER TABLE before deploying the API changes.

CREATE TABLE IF NOT EXISTS players (
    telegram_id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Player',
    level INTEGER NOT NULL DEFAULT 0
        CHECK(level BETWEEN 0 AND 500),
    completed INTEGER NOT NULL DEFAULT 0
        CHECK(completed BETWEEN 0 AND 500),
    coins INTEGER NOT NULL DEFAULT 0
        CHECK(coins >= 0),
    best_moves INTEGER,
    auth_type TEXT NOT NULL DEFAULT 'guest'
        CHECK(auth_type IN ('guest', 'telegram')),
    telegram_user_id TEXT,
    guest_id TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_players_ranking
ON players(completed DESC, level DESC, coins DESC, best_moves ASC, updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_players_telegram_user
ON players(telegram_user_id);
