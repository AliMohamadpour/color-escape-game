const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(message)
    )
  );
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifyTelegram(initData, botToken) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmac(
    new TextEncoder().encode("WebAppData"),
    botToken
  );

  const calculatedHash = toHex(
    await hmac(secretKey, dataCheckString)
  );

  if (!safeEqual(calculatedHash, receivedHash)) return null;

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);

  if (!authDate || now - authDate > 86400 || authDate > now + 60) {
    return null;
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "{}");
  } catch {
    return null;
  }

  if (!user.id) return null;

  return user;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ success: false, error: "Database is not connected" }, 500);
    }

    if (!env.TELEGRAM_BOT_TOKEN) {
      return json({ success: false, error: "Bot token is not configured" }, 500);
    }

    const body = await request.json();

    const initData = String(body.initData || "");
    const level = Number(body.level);
    const completed = Number(body.completed);

    if (!initData) {
      return json({ success: false, error: "Telegram data is missing" }, 400);
    }

    if (
      !Number.isInteger(level) ||
      !Number.isInteger(completed) ||
      level < 0 ||
      level > 500 ||
      completed < 0 ||
      completed > 500
    ) {
      return json({ success: false, error: "Invalid score" }, 400);
    }

    const user = await verifyTelegram(
      initData,
      env.TELEGRAM_BOT_TOKEN
    );

    if (!user) {
      return json({ success: false, error: "Invalid Telegram authentication" }, 401);
    }

    const displayName = [
      user.first_name || "",
      user.last_name || ""
    ].join(" ").trim() || user.username || "Player";

    await env.DB.prepare(`
      INSERT INTO players (
        telegram_id,
        display_name,
        level,
        completed,
        updated_at
      )
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(telegram_id) DO UPDATE SET
        display_name = excluded.display_name,
        level = MAX(players.level, excluded.level),
        completed = MAX(players.completed, excluded.completed),
        updated_at = unixepoch()
    `)
      .bind(
        String(user.id),
        displayName.slice(0, 80),
        level,
        completed
      )
      .run();

    return json({
      success: true,
      message: "Score saved"
    });

  } catch (error) {
    return json({
      success: false,
      error: "Server error"
    }, 500);
  }
          }
