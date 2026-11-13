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

function createCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN) {
      return json({ success: false, error: "Referral service is not configured" }, 500);
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
    const name = [user.first_name || "", user.last_name || ""]
      .join(" ")
      .trim() || user.username || "Player";

    await env.DB.prepare(`
      INSERT INTO players (
        telegram_id, name, auth_type, telegram_user_id
      ) VALUES (?, ?, 'telegram', ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        name = excluded.name,
        auth_type = 'telegram',
        telegram_user_id = excluded.telegram_user_id,
        updated_at = CURRENT_TIMESTAMP
    `).bind(telegramId, name.slice(0, 80), telegramId).run();

    let row = await env.DB.prepare(`
      SELECT referral_code
      FROM referral_codes
      WHERE telegram_id = ?
    `).bind(telegramId).first();

    if (!row) {
      for (let attempt = 0; attempt < 5 && !row; attempt++) {
        const code = createCode();
        try {
          await env.DB.prepare(`
            INSERT INTO referral_codes (telegram_id, referral_code)
            VALUES (?, ?)
          `).bind(telegramId, code).run();
          row = { referral_code: code };
        } catch {
          // Retry if a generated code collides with an existing code.
        }
      }
    }

    if (!row?.referral_code) {
      return json({ success: false, error: "Could not create referral code" }, 500);
    }

    const referralUrl = `https://t.me/ColorEscapeGameBot?start=ref_${row.referral_code}`;
    return json({
      success: true,
      code: row.referral_code,
      url: referralUrl
    });
  } catch {
    return json({ success: false, error: "Could not create referral link" }, 500);
  }
}
