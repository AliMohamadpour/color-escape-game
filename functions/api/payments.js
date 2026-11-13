const PRODUCTS = {
  hint: {
    name: "راهنمای حرکت",
    description: "یک راهنمای حرکت برای مرحلهٔ فعلی",
    stars: 3
  },
  coins50: {
    name: "۵۰ سکه",
    description: "۵۰ سکه برای استفاده در بازی",
    stars: 5
  },
  golden: {
    name: "پوستهٔ طلایی",
    description: "فعال‌سازی پوستهٔ طلایی بازی",
    stars: 10
  }
};

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

function createPayload(telegramId) {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `stars_${telegramId}_${random}`;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN) {
      return json({ success: false, error: "Payment service is not configured" }, 500);
    }

    const body = await request.json();
    const product = PRODUCTS[String(body.product || "")];
    if (!product) {
      return json({ success: false, error: "Invalid product" }, 400);
    }

    const user = await verifyTelegram(
      String(body.initData || ""),
      env.TELEGRAM_BOT_TOKEN
    );
    if (!user) {
      return json({ success: false, error: "Invalid Telegram authentication" }, 401);
    }

    const telegramId = String(user.id);
    const payload = createPayload(telegramId);
    const result = await env.DB.prepare(`
      INSERT INTO payments (
        telegram_id, product_code, product_name, stars, payload, status
      ) VALUES (?, ?, ?, ?, ?, 'pending')
    `).bind(
      telegramId,
      String(body.product),
      product.name,
      product.stars,
      payload
    ).run();

    if (!result.success) {
      return json({ success: false, error: "Could not create payment record" }, 500);
    }

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/createInvoiceLink`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: product.name,
          description: product.description,
          payload,
          currency: "XTR",
          prices: [{ label: product.name, amount: product.stars }]
        })
      }
    );

    const telegramData = await telegramResponse.json();
    if (!telegramResponse.ok || !telegramData.ok || !telegramData.result) {
      await env.DB.prepare("DELETE FROM payments WHERE payload = ?").bind(payload).run();
      return json({ success: false, error: "Could not create Telegram invoice" }, 502);
    }

    return json({
      success: true,
      product: String(body.product),
      stars: product.stars,
      invoiceLink: telegramData.result
    });
  } catch {
    return json({ success: false, error: "Could not start payment" }, 500);
  }
}
