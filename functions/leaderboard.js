
export async function onRequestGet({ env }) {
  try {
    if (!env.DB) {
      return Response.json({
        success: false,
        error: "Database is not connected"
      }, { status: 500 });
    }

    const result = await env.DB.prepare(`
      SELECT
        telegram_id,
        name,
        level,
        completed,
        coins,
        best_moves,
        auth_type
      FROM players
      ORDER BY
        completed DESC,
        level DESC,
        coins DESC,
        CASE WHEN best_moves IS NULL THEN 1 ELSE 0 END,
        best_moves ASC,
        updated_at ASC
      LIMIT 100
    `).all();

    const players = (result.results || []).map((player, index) => ({
      rank: index + 1,
      ...player
    }));

    return Response.json({
      success: true,
      total: players.length,
      players
    }, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    return Response.json({
      success: false,
      error: "Could not load leaderboard"
    }, { status: 500 });
  }
}
