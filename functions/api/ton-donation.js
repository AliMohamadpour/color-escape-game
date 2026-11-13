const TON_DESTINATION = "UQCpT9QSPYMMqDvGkcgdtU6K0NzWPgfvQdk-lVz1l5sYFCJV";
const DONATION_NANO = 10_000_000;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
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
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message)
  ));
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
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
  const calculatedHash = toHex(await hmac(secretKey, dataCheckString));
  if (!safeEqual(calculatedHash, receivedHash.toLowerCase())) return null;

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || now - authDate > 86400 || authDate > now + 60) return null;

  try {
    const user = JSON.parse(params.get("user") || "{}");
    return user.id ? user : null;
  } catch {
    return null;
  }
}

function createOrderId(telegramId) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `ton_${telegramId}_${random}`;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN) {
      return json({ success: false, error: "TON donation service is not configured" }, 500);
    }

    const body = await request.json();
    const user = await verifyTelegram(
      String(body.initData || ""),
      env.TELEGRAM_BOT_TOKEN
    );
    if (!user) {
      return json({ success: false, error: "Invalid Telegram authentication" }, 401);
    }

    const telegramId = String(user.id);
    const orderId = createOrderId(telegramId);
    await env.DB.prepare(`
      INSERT INTO ton_donations (
        telegram_id, order_id, amount_nano, destination, status
      ) VALUES (?, ?, ?, ?, 'pending')
    `).bind(
      telegramId,
      orderId,
      DONATION_NANO,
      TON_DESTINATION
    ).run();

    return json({
      success: true,
      orderId,
      amountNano: DONATION_NANO,
      amountTon: "0.01",
      destination: TON_DESTINATION
    });
  } catch {
    return json({ success: false, error: "Could not create TON donation order" }, 500);
  }
}
