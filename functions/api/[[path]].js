
const json = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
};

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({
        success: false,
        error: "Database is not connected"
      }, 500);
    }

    const body = await request.json();

    const telegramId = String(body.telegram_id || "").trim();
    const name = String(body.name || "Guest").trim();
    const level = Number(body.level);
    const completed = Number(body.completed);

    if (
      !telegramId ||
      telegramId.length > 100 ||
      !Number.isInteger(level) ||
      !Number.isInteger(completed) ||
      level < 1 || level > 500 ||
      completed < 0 || completed > 500
    ) {
      return json({
        success: false,
        error: "Invalid player data"
      }, 400);
    }

    const isGuest = telegramId.startsWith("guest-");

    await env.DB.prepare(`
      INSERT INTO players (
        telegram_id,
        name,
        level,
        completed,
        auth_type,
        telegram_user_id,
        guest_id,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

      ON CONFLICT(telegram_id) DO UPDATE SET
        name = excluded.name,
        level = MAX(players.level, excluded.level),
        completed = MAX(players.completed, excluded.completed),
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      telegramId,
      name.slice(0, 80),
      level,
      completed,
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
