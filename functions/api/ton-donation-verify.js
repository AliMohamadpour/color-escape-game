const TON_DESTINATION = "UQCpT9QSPYMMqDvGkcgdtU6K0NzWPgfvQdk-lVz1l5sYFCJV";
const DONATION_NANO = 10_000_000;
const TONCENTER_URL = "https://toncenter.com/api/v2";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  }
});

async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)));
}

function toHex(bytes) {
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyTelegram(initData, botToken) {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return null;
  params.delete("hash");
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const calculated = toHex(await hmac(secret, checkString));
  if (!safeEqual(calculated, receivedHash.toLowerCase())) return null;
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

function normalizeAddress(address) {
  const value = String(address || "").trim();
  const raw = value.match(/^(-?\d+):([0-9a-fA-F]{64})$/);
  if (raw) return `${Number(raw[1])}:${raw[2].toLowerCase()}`;

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
    if (bytes.length < 34) return null;
    const workchain = bytes[1] === 255 ? -1 : bytes[1];
    return `${workchain}:${toHex(bytes.slice(2, 34))}`;
  } catch {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN) {
      return json({ success: false, error: "TON verification service is not configured" }, 500);
    }

    const body = await request.json();
    const user = await verifyTelegram(String(body.initData || ""), env.TELEGRAM_BOT_TOKEN);
    if (!user) return json({ success: false, error: "Invalid Telegram authentication" }, 401);

    const orderId = String(body.orderId || "");
    const order = await env.DB.prepare(`
      SELECT * FROM ton_donations
      WHERE order_id = ? AND telegram_id = ?
    `).bind(orderId, String(user.id)).first();

    if (!order) return json({ success: false, error: "Donation order not found" }, 404);
    if (order.status === "confirmed") return json({ success: true, status: "confirmed", txHash: order.tx_hash });
    if (order.status !== "pending") return json({ success: false, error: "Donation order is not pending" }, 409);

    const senderAddress = String(body.senderAddress || "");
    if (!senderAddress) return json({ success: false, error: "Sender wallet is required" }, 400);

    await env.DB.prepare(`
      UPDATE ton_donations
      SET sender_address = ?
      WHERE order_id = ? AND status = 'pending'
    `).bind(senderAddress, orderId).run();

    const from = Math.max(0, Number(order.created_at) - 60);
    const url = `${TONCENTER_URL}/getTransactions?address=${encodeURIComponent(TON_DESTINATION)}&limit=20&archival=true&to_utime=${Math.floor(Date.now() / 1000) + 60}`;
    const response = await fetch(url);
    const data = await response.json();
    const transactions = Array.isArray(data?.result) ? data.result : [];
    const expectedSender = normalizeAddress(senderAddress);

    const match = transactions.find(tx => {
      const incoming = tx?.in_msg;
      const source = normalizeAddress(incoming?.source);
      const amount = Number(incoming?.value || 0);
      const txTime = Number(tx?.utime || 0);
      return source && expectedSender && source === expectedSender &&
        amount === DONATION_NANO && txTime >= from && txTime <= Math.floor(Date.now() / 1000) + 60;
    });

    if (!match) return json({ success: true, status: "pending" });

    const txHash = String(match?.transaction_id?.hash || match?.hash || "");
    const update = await env.DB.prepare(`
      UPDATE ton_donations
      SET status = 'confirmed', tx_hash = ?, confirmed_at = unixepoch(), sender_address = ?
      WHERE order_id = ? AND status = 'pending'
    `).bind(txHash || null, senderAddress, orderId).run();

    if (Number(update.meta?.changes || 0) !== 1) {
      return json({ success: true, status: "confirmed", txHash });
    }
    return json({ success: true, status: "confirmed", txHash });
  } catch {
    return json({ success: false, error: "Could not verify TON donation" }, 502);
  }
}
