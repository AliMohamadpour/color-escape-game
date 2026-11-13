const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" }
});

async function sendTelegramMessage(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

function referralCodeFromText(text) {
  const match = String(text || "").trim().match(/^\/start(?:@[^\s]+)?\s+ref_([A-Z2-9]{10})$/i);
  return match ? match[1].toUpperCase() : null;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN) {
      return json({ ok: false, error: "Webhook is not configured" }, 500);
    }

    const expectedSecret = String(env.TELEGRAM_WEBHOOK_SECRET || "");
    if (expectedSecret) {
      const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (receivedSecret !== expectedSecret) {
        return json({ ok: false, error: "Invalid webhook secret" }, 401);
      }
    }

    const update = await request.json();
    const message = update?.message;
    const code = referralCodeFromText(message?.text);

    if (!message || !code || !message.from?.id) {
      return json({ ok: true, ignored: true });
    }

    const invitedId = String(message.from.id);
    const invitedName = [message.from.first_name || "", message.from.last_name || ""]
      .join(" ")
      .trim() || message.from.username || "Player";

    const codeRow = await env.DB.prepare(`
      SELECT telegram_id
      FROM referral_codes
      WHERE referral_code = ?
    `).bind(code).first();

    if (!codeRow) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, invitedId, "کد دعوت معتبر نیست.");
      return json({ ok: true, accepted: false, reason: "unknown_code" });
    }

    const inviterId = String(codeRow.telegram_id);
    if (inviterId === invitedId) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, invitedId, "نمی‌توانی از لینک دعوت خودت استفاده کنی.");
      return json({ ok: true, accepted: false, reason: "self_referral" });
    }

    await env.DB.prepare(`
      INSERT INTO players (telegram_id, name, auth_type, telegram_user_id)
      VALUES (?, ?, 'telegram', ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        name = excluded.name,
        auth_type = 'telegram',
        telegram_user_id = excluded.telegram_user_id,
        updated_at = CURRENT_TIMESTAMP
    `).bind(invitedId, invitedName.slice(0, 80), invitedId).run();

    const existing = await env.DB.prepare(`
      SELECT id FROM referrals WHERE invited_id = ?
    `).bind(invitedId).first();

    if (existing) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, invitedId, "دعوت شما قبلاً ثبت شده است.");
      return json({ ok: true, accepted: false, reason: "already_registered" });
    }

    await env.DB.prepare(`
      INSERT INTO referrals (inviter_id, invited_id, referral_code, status)
      VALUES (?, ?, ?, 'pending')
    `).bind(inviterId, invitedId, code).run();

    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      invitedId,
      "دعوت شما با موفقیت ثبت شد. پس از فعال‌شدن پاداش، شرایط جایزه اعلام می‌شود."
    );

    return json({ ok: true, accepted: true });
  } catch {
    return json({ ok: false, error: "Could not process webhook" }, 500);
  }
}
