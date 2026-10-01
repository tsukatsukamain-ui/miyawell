// functions/process-refund.js
// Cloudflare Pages Function。管理画面(admin.js)から呼ばれる。
// 返金リクエストを実際にStripeで処理する。
// アクセスURL: https://あなたのサイト/process-refund
//
// ポリシー: 開催日の前日まで（JST基準）にキャンセルされていれば全額返金、
// 当日以降のキャンセルはStripeの実際の決済手数料を差し引いた額を返金する。

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = "tsukatsukamain@gmail.com";

export async function onRequestPost(context) {
  const { request, env } = context;

  const stripe = Stripe(env.STRIPE_SECRET_KEY);
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 呼び出した人が本当に管理者か確認する
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return json({ error: "ログインが必要です" }, 401);
    }

    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "認証に失敗しました" }, 401);
    }
    if (userData.user.email !== ADMIN_EMAIL) {
      return json({ error: "権限がありません" }, 403);
    }

    const { registrationId } = await request.json();
    if (!registrationId) {
      return json({ error: "registrationId is required" }, 400);
    }

    const { data: reg, error: regErr } = await sb
      .from("registrations")
      .select("*, events!inner(starts_at, title)")
      .eq("id", registrationId)
      .single();

    if (regErr || !reg) {
      return json({ error: "登録が見つかりません" }, 404);
    }
    if (reg.refund_status === "refunded") {
      return json({ error: "すでに返金済みです" }, 400);
    }
    if (!reg.stripe_checkout_session_id) {
      return json({ error: "決済情報が見つかりません" }, 400);
    }

    const session = await stripe.checkout.sessions.retrieve(reg.stripe_checkout_session_id);
    const paymentIntentId = session.payment_intent;
    if (!paymentIntentId) {
      return json({ error: "支払い情報が見つかりません（未決済の可能性）" }, 400);
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    const charge = paymentIntent.latest_charge;
    const totalPaid = charge?.amount ?? session.amount_total ?? 0;
    const fee = charge?.balance_transaction?.fee ?? 0;

    const eventStartsAt = new Date(reg.events.starts_at);
    const cancelledAt = reg.cancelled_at ? new Date(reg.cancelled_at) : new Date();

    // JST基準の「日付」だけを比べて、開催日より前の日にキャンセルされていれば全額
    const jstDate = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
    const fullRefund = jstDate(cancelledAt) < jstDate(eventStartsAt);

    const refundAmount = fullRefund ? totalPaid : Math.max(totalPaid - fee, 0);

    if (refundAmount <= 0) {
      return json({ error: "返金額が0円のため処理できません" }, 400);
    }

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: refundAmount,
    });

    await sb
      .from("registrations")
      .update({
        refund_status: "refunded",
        refund_amount: refundAmount,
        stripe_refund_id: refund.id,
      })
      .eq("id", registrationId);

    return json({ refunded: refundAmount, full: fullRefund, fee });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
