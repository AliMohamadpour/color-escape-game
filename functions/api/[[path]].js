
export async function onRequest(context) {
  const { request, env } = context;

  if (!env.DB) {
    return Response.json(
      { success: false, error: "Database binding DB not found" },
      { status: 500 }
    );
  }

  const url = new URL(request.url);

  if (url.pathname !== "/api/progress") {
    return Response.json(
      { success: false, error: "Not found" },
      { status: 404 }
    );
  }

  if (request.method !== "POST") {
    return Response.json(
      { success: false, error: "Method not allowed" },
      { status: 405 }
    );
  }

  try {
    const body = await request.json();

    const telegram_id = String(body.telegram_id || "").trim();
    const name = String(body.name || "Guest").trim();
    const level = Number(body.level);
    const completed = Number(body.completed || 1);

    if (!telegram_id || !Number.isInteger(level) || level < 1) {
      return Response.json(
        { success: false, error: "Invalid data" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO Players
        (telegram_id, name, level, completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        name = excluded.name,
        level = MAX(Players.level, excluded.level),
        completed = Players.completed + excluded.completed,
        updated_at = excluded.updated_at
    `).bind(
      telegram_id,
      name,
      level,
      completed,
      now,
      now
    ).run();

    await env.DB.prepare(`
      INSERT INTO Score_history (telegram_id, level, created_at)
      VALUES (?, ?, ?)
    `).bind(telegram_id, level, now).run();

    return Response.json({
      success: true,
      message: "Progress saved"
    });

  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
