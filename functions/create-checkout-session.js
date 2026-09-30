// functions/create-checkout-session.js
// Cloudflare Pages Function。
// public/app.js から呼ばれ、Stripe Checkout セッションを作って sessionId を返す。
// アクセスURL: https://あなたのサイト/create-checkout-session

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const stripe = Stripe(env.STRIPE_SECRET_KEY);
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { eventId, userId, userEmail } = await request.json();

    const { data: ev, error: evError } = await sb
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (evError || !ev) {
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 参加登録レコードを pending で先に作っておく（Webhookで paid に更新する）
    const { data: reg, error: regError } = await sb
      .from("registrations")
      .upsert(
        {
          event_id: eventId,
          user_id: userId,
          payment_status: "pending",
        },
        { onConflict: "event_id,user_id" }
      )
      .select()
      .single();

    if (regError) {
      return new Response(JSON.stringify({ error: regError.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: "jpy",
            product_data: { name: ev.title },
            unit_amount: ev.price_jpy,
          },
          quantity: 1,
        },
      ],
      metadata: {
        registration_id: reg.id,
        event_id: eventId,
        user_id: userId,
      },
      success_url: `${env.SITE_URL}/?checkout=success`,
      cancel_url: `${env.SITE_URL}/?checkout=cancelled`,
    });

    // どのセッションIDに紐づく登録か記録しておく（Webhook側の突き合わせ用）
    await sb
      .from("registrations")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", reg.id);

    return new Response(JSON.stringify({ sessionId: session.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
