
const cors = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors
  });
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function createSession(env, playerId) {
  const token = crypto.randomUUID() + "." + crypto.randomUUID();
  const tokenHash = await hash(token);
  const expires = new Date(Date.now() + 30 * 86400000).toISOString();

  await env.DB.prepare(`
    INSERT INTO player_sessions
    (telegram_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).bind(playerId, tokenHash, expires).run();

  return { token, expires };
}

async function getPlayer(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : "";

  if (!token) return null;

  const tokenHash = await hash(token);

  const session = await env.DB.prepare(`
    SELECT p.*
    FROM player_sessions s
    JOIN players p ON p.telegram_id = s.telegram_id
    WHERE s.token_hash = ?
      AND s.expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();

  return session || null;
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyTelegram(initData, botToken) {
  if (!initData || !botToken) {
    throw new Error("Telegram authentication is not configured");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) throw new Error("Invalid Telegram data");

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const encoder = new TextEncoder();

  const secretKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const secret = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    encoder.encode(botToken)
  );

  const validationKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const calculated = bytesToHex(
    await crypto.subtle.sign(
      "HMAC",
      validationKey,
      encoder.encode(dataCheckString)
    )
  );

  if (calculated.length !== receivedHash.length) {
    throw new Error("Telegram signature mismatch");
  }

  let difference = 0;
  for (let i = 0; i < calculated.length; i++) {
    difference |= calculated.charCodeAt(i) ^ receivedHash.charCodeAt(i);
  }

  if (difference !== 0) {
    throw new Error("Telegram signature mismatch");
  }

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);

  if (!authDate || now - authDate > 86400 || authDate > now + 60) {
    throw new Error("Telegram login data expired");
  }

  const user = JSON.parse(params.get("user") || "{}");

  if (!user.id) throw new Error("Telegram user not found");

  return user;
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    if (!env.DB) {
      return reply({
        success: false,
        message: "Database is not connected"
      }, 500);
    }

    if (request.method === "GET") {
      const result = await env.DB
        .prepare("SELECT 1 AS connected")
        .first();

      return reply({
        success: true,
        api: "online",
        database: result ? "connected" : "error"
      });
    }

    if (request.method !== "POST") {
      return reply({
        success: false,
        message: "Method not allowed"
      }, 405);
    }

    const data = await request.json();
    const action = data.action;

    // 1. Create guest account
    if (action === "guest") {
      const guestId = crypto.randomUUID();
      const playerId = "guest:" + guestId;
      const name = String(data.name || "بازیکن").trim().slice(0, 30);

      await env.DB.prepare(`
        INSERT INTO players
        (telegram_id, name, auth_type, guest_id)
        VALUES (?, ?, 'guest', ?)
      `).bind(playerId, name || "بازیکن", guestId).run();

      const session = await createSession(env, playerId);

      return reply({
        success: true,
        player: {
          id: playerId,
          guest_id: guestId,
          name: name || "بازیکن",
          auth_type: "guest",
          level: 0,
          completed: 0
        },
        token: session.token,
        expires_at: session.expires
      }, 201);
    }

    // 2. Telegram login
    if (action === "telegram") {
      const user = await verifyTelegram(
        data.initData,
        env.TELEGRAM_BOT_TOKEN
      );

      const telegramUserId = String(user.id);
      const name = [
        user.first_name,
        user.last_name
      ].filter(Boolean).join(" ").slice(0, 60) || "بازیکن";

      let player = await env.DB.prepare(`
        SELECT * FROM players
        WHERE telegram_user_id = ?
      `).bind(telegramUserId).first();

      if (player) {
        await env.DB.prepare(`
          UPDATE players
          SET name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE telegram_id = ?
        `).bind(name, player.telegram_id).run();
      } else {
        const playerId = "tg:" + telegramUserId;

        await env.DB.prepare(`
          INSERT INTO players
          (telegram_id, telegram_user_id, name, auth_type)
          VALUES (?, ?, ?, 'telegram')
        `).bind(playerId, telegramUserId, name).run();
      }

      player = await env.DB.prepare(`
        SELECT * FROM players
        WHERE telegram_user_id = ?
      `).bind(telegramUserId).first();

      const session = await createSession(env, player.telegram_id);

      return reply({
        success: true,
        player,
        token: session.token,
        expires_at: session.expires
      });
    }

    // 3. Current player
    if (action === "me") {
      const player = await getPlayer(request, env);

      if (!player) {
        return reply({
          success: false,
          message: "Login required"
        }, 401);
      }

      return reply({
        success: true,
        player
      });
    }

    // 4. Save completed level
    if (action === "progress") {
      const player = await getPlayer(request, env);

      if (!player) {
        return reply({
          success: false,
          message: "Login required"
        }, 401);
      }

      const level = Number(data.level);

      if (!Number.isInteger(level) || level < 1 || level > 500) {
        return reply({
          success: false,
          message: "Invalid level"
        }, 400);
      }

      const isNewRecord = level > player.level;

      if (isNewRecord) {
        await env.DB.batch([
          env.DB.prepare(`
            UPDATE players
            SET level = MAX(level, ?),
                completed = completed + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?
          `).bind(level, player.telegram_id),

          env.DB.prepare(`
            INSERT INTO score_history (telegram_id, level)
            VALUES (?, ?)
          `).bind(player.telegram_id, level)
        ]);
      }

      const updated = await env.DB.prepare(`
        SELECT * FROM players WHERE telegram_id = ?
      `).bind(player.telegram_id).first();

      return reply({
        success: true,
        new_record: isNewRecord,
        player: updated
      });
    }

    // 5. Leaderboard
    if (action === "leaderboard") {
      const result = await env.DB.prepare(`
        SELECT name, level, completed, auth_type
        FROM players
        ORDER BY level DESC, completed DESC
        LIMIT 50
      `).all();

      return reply({
        success: true,
        players: result.results
      });
    }

    // 6. Logout
    if (action === "logout") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ")
        ? auth.slice(7)
        : "";

      if (token) {
        await env.DB.prepare(`
          DELETE FROM player_sessions WHERE token_hash = ?
        `).bind(await hash(token)).run();
      }

      return reply({ success: true, message: "Logged out" });
    }

    return reply({
      success: false,
      message: "Unknown action"
    }, 400);

  } catch (error) {
    return reply({
      success: false,
      message: error.message || "Server error"
    }, 500);
  }
}
