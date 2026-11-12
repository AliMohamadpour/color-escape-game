
export async function onRequestGet({ env }) {
  try {
    if (!env.DB) {
      return new Response(
        JSON.stringify({ success: false, error: "Database is not connected" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        }
      );
    }

    const result = await env.DB.prepare(`
      SELECT
        display_name AS name,
        level,
        completed
      FROM players
      ORDER BY
        level DESC,
        completed DESC,
        updated_at ASC
      LIMIT 100
    `).all();

    const players = result.results || [];

    return new Response(
      JSON.stringify({
        success: true,
        players,
        results: players
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: "Could not load leaderboard" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      }
    );
  }
}
