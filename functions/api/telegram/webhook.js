const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" }
});

async function telegramCall(token, method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function sendTelegramMessage(token, chatId, text) {
  await telegramCall(token, "sendMessage", { chat_id: chatId, text });
}

function referralCodeFromText(text) {
  const match = String(text || "").trim().match(/^\/start(?:@[^\s]+)?\s+ref_([A-Z2-9]{10})$/i);
  return match ? match[1].toUpperCase() : null;
}

async function answerPreCheckout(env, query) {
  const payload = String(query.invoice_payload || "");
  const payment = await env.DB.prepare(`
    SELECT telegram_id, stars, status
    FROM payments
    WHERE payload = ?
  `).bind(payload).first();

  const valid = Boolean(
    payment &&
    payment.status === "pending" &&
    String(payment.telegram_id) === String(query.from?.id) &&
    String(query.currency) === "XTR" &&
    Number(query.total_amount) === Number(payment.stars)
  );

  await telegramCall(env.TELEGRAM_BOT_TOKEN, "answerPreCheckoutQuery", {
    pre_checkout_query_id: query.id,
    ok: valid,
    ...(valid ? {} : { error_message: "پرداخت معتبر نیست یا منقضی شده است." })
  });
}

async function handleSuccessfulPayment(env, message) {
  const paymentInfo = message.successful_payment;
  const payload = String(paymentInfo.invoice_payload || "");
  const telegramId = String(message.from?.id || message.chat?.id || "");

  const payment = await env.DB.prepare(`
    SELECT * FROM payments
    WHERE payload = ? AND telegram_id = ? AND status = 'pending'
  `).bind(payload, telegramId).first();

  if (!payment || String(paymentInfo.currency) !== "XTR" ||
      Number(paymentInfo.total_amount) !== Number(payment.stars)) {
    return { accepted: false, reason: "invalid_payment" };
  }

  const update = await env.DB.prepare(`
    UPDATE payments
    SET status = 'paid',
        telegram_payment_charge_id = ?,
        provider_payment_charge_id = ?,
        paid_at = unixepoch()
    WHERE payload = ? AND status = 'pending'
  `).bind(
    paymentInfo.telegram_payment_charge_id || null,
    paymentInfo.provider_payment_charge_id || null,
    payload
  ).run();

  if (Number(update.meta?.changes || 0) !== 1) {
    return { accepted: false, reason: "already_processed" };
  }

  if (payment.product_code === "coins50") {
    await env.DB.prepare(`
      UPDATE players
      SET coins = coins + 50, updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = ?
    `).bind(telegramId).run();
  }

  const messages = {
    hint: "پرداخت راهنما با موفقیت ثبت شد. بازی را باز کن تا راهنما فعال شود.",
    coins50: "پرداخت موفق بود و ۵۰ سکه به حساب تو اضافه شد.",
    golden: "پرداخت پوستهٔ طلایی با موفقیت ثبت شد. بازی را دوباره باز کن."
  };
  await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    messages[payment.product_code] || "پرداخت با موفقیت ثبت شد."
  );

  return { accepted: true, product: payment.product_code };
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

    if (update?.pre_checkout_query) {
      await answerPreCheckout(env, update.pre_checkout_query);
      return json({ ok: true, type: "pre_checkout_query" });
    }

    if (update?.message?.successful_payment) {
      const result = await handleSuccessfulPayment(env, update.message);
      return json({ ok: true, type: "successful_payment", ...result });
    }

    const message = update?.message;
    const code = referralCodeFromText(message?.text);
    if (!message || !code || !message.from?.id) {
      return json({ ok: true, ignored: true });
    }

    const invitedId = String(message.from.id);
    const invitedName = [message.from.first_name || "", message.from.last_name || ""]
      .join(" ").trim() || message.from.username || "Player";

    const codeRow = await env.DB.prepare(`
      SELECT telegram_id FROM referral_codes WHERE referral_code = ?
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

    const existing = await env.DB.prepare(
      "SELECT id FROM referrals WHERE invited_id = ?"
    ).bind(invitedId).first();

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
      "دعوت شما با موفقیت ثبت شد. با تکمیل مرحلهٔ اول، ۱۰ سکه پاداش می‌گیری."
    );

    return json({ ok: true, accepted: true });
  } catch {
    return json({ ok: false, error: "Could not process webhook" }, 500);
  }
}
