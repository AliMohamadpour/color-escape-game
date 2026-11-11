COLOR ESCAPE — Cloudflare Pages starter

Contents:
- index.html
- functions/api/[[path]].js (Pages Function catch-all)
- schema.sql

DEPLOY:
1. Upload the contents of this folder to the existing Cloudflare Pages project using Direct Upload.
2. In Pages > Settings > Functions > D1 database bindings, bind database `color-escape-db` with variable name `DB`.
3. In D1 > Console, run the contents of schema.sql (only if the tables do not already exist).
4. Deploy and open https://YOUR-PROJECT.pages.dev/api/health. Expected: {"ok":true,"database":"connected"}

IMPORTANT:
- The game runs locally in the browser and stores the current level in localStorage.
- The API provides health, leaderboard, and progress endpoints. The UI in this starter does not yet submit progress automatically.
- Do not delete the existing D1 database. This schema is compatible with the players and score_history tables described in the setup conversation.
- Telegram identity is not cryptographically verified in this starter. Before using saved progress as a prize/anti-cheat system, add Telegram initData validation with a server-side bot token secret.
\nWhen a level is completed, the browser now posts progress to /api/progress. Telegram ID is used when opened in Telegram; otherwise a local guest ID is used. Guest IDs are device-specific.\n