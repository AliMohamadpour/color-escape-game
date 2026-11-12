
export async function onRequest({ request, env }) {
  const corsHeaders = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    if (!env.DB) {
      throw new Error("Database binding DB is not connected");
    }

    if (request.method === "GET") {
      const result = await env.DB
        .prepare("SELECT 1 AS connected")
        .first();

      return new Response(JSON.stringify({
        success: true,
        api: "online",
        database: "connected",
        result,
        message: "Game API is ready!"
      }), {
        status: 200,
        headers: corsHeaders
      });
    }

    if (request.method === "POST") {
      const data = await request.json();

      return new Response(JSON.stringify({
        success: true,
        message: "Data received successfully",
        received: data
      }), {
        status: 200,
        headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({
      success: false,
      message: "Method not allowed"
    }), {
      status: 405,
      headers: corsHeaders
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      message: error.message || "Internal server error"
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
}
