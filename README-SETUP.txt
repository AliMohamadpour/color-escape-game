COLOR ESCAPE — Cloudflare Pages + Telegram Mini App

Contents:
- index.html
- functions/score.js                 Telegram-authenticated score endpoint (/score)
- functions/leaderboard.js            Public leaderboard endpoint (/leaderboard)
- functions/api/[[path]].js           Guest progress and health endpoints (/api/progress, /api/health)
- schema.sql

DEPLOY
1. Deploy the contents of this folder to the Cloudflare Pages project.
2. In Pages > Settings > Functions > D1 database bindings, bind the D1 database with variable name DB.
3. Add TELEGRAM_BOT_TOKEN as an encrypted production secret. It must belong to the game bot.
4. On a new D1 database, run schema.sql once. For an existing database, migrate missing columns before deploying.
5. Verify https://YOUR-PROJECT.pages.dev/api/health returns {"ok":true,"database":"connected"}.
6. Verify /leaderboard returns JSON, not the HTML game page.

API BEHAVIOR
- Telegram users post verified Telegram initData to /score.
- Browser guests post a device-specific guest ID to /api/progress.
- /leaderboard is read-only and returns the top 100 players.
- The client stores gameplay state locally; the server stores leaderboard progress.

IMPORTANT
- Never publish TELEGRAM_BOT_TOKEN in the repository or client-side JavaScript.
- Do not treat client-reported coins or progress as a prize or anti-cheat source without server-side game verification.
- The old admin=1 test shortcut has been removed from the client.
