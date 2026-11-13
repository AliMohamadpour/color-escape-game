

const json = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
};

export async function onRequestGet({ env, params }) {
  const path = Array.isArray(params?.path) ? params.path.join("/") : String(params?.path || "");

  if (path !== "health") {
    return json({ success: false, error: "Not found" }, 404);
  }

  if (!env.DB) {
    return json({ ok: false, database: "disconnected" }, 500);
  }

  try {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true, database: "connected" });
  } catch {
    return json({ ok: false, database: "error" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({
        success: false,
        error: "Database is not connected"
      }, 500);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({
        success: false,
        error: "Invalid JSON"
      }, 400);
    }

    const telegramId = String(body.telegram_id || "").trim();
    const name = String(body.name || "Guest").trim();

    const level = Number(body.level);
    const completed = Number(body.completed);
    const coins = Number.isInteger(Number(body.coins))
      ? Math.max(0, Number(body.coins))
      : 0;
    const bestMoves = Number.isInteger(Number(body.bestMoves)) && Number(body.bestMoves) > 0
      ? Number(body.bestMoves)
      : null;

    if (
      !telegramId ||
      !telegramId.startsWith("guest-") ||
      telegramId.length > 100 ||
      !Number.isInteger(level) ||
      !Number.isInteger(completed) ||
      level < 1 ||
      level > 500 ||
      completed < 0 ||
      completed > 500 ||
      completed > level
    ) {
      return json({
        success: false,
        error: "Invalid player data"
      }, 400);
    }

    const isGuest = true;

    await env.DB.prepare(`
      INSERT INTO players (
        telegram_id,
        name,
        level,
        completed,
        coins,
        best_moves,
        auth_type,
        telegram_user_id,
        guest_id,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

      ON CONFLICT(telegram_id) DO UPDATE SET
        name = excluded.name,
        level = MAX(players.level, excluded.level),
        completed = MAX(players.completed, excluded.completed),
        coins = MAX(players.coins, excluded.coins),
        best_moves = CASE
          WHEN excluded.best_moves IS NULL THEN players.best_moves
          WHEN players.best_moves IS NULL THEN excluded.best_moves
          ELSE MIN(players.best_moves, excluded.best_moves)
        END,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      telegramId,
      name.slice(0, 80),
      level,
      completed,
      coins,
      bestMoves,
      isGuest ? "guest" : "telegram",
      isGuest ? null : telegramId,
      isGuest ? telegramId : null
    ).run();

    return json({
      success: true,
      message: "Progress saved"
    });

  } catch (error) {
    return json({
      success: false,
      error: "Could not save progress"
    }, 500);
  }
}
