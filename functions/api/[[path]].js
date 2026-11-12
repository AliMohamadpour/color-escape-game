
export async function onRequest(context) {
  const { request, env } = context;

  return new Response(JSON.stringify({
    success: true,
    message: "Game API is running 🚀"
  }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
