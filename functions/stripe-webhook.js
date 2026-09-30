// functions/stripe-webhook.js
// Cloudflare Pages Function。
// Stripeからの決済完了通知を受け取り、registrations.payment_status を paid に更新する。
// アクセスURL: https://あなたのサイト/stripe-webhook
// Stripeダッシュボードの「開発者 > Webhook」でこのURLを登録し、
// checkout.session.completed イベントを選択してください。

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function onRequestPost(context) {
  const { request, env } = context;

  const stripe = Stripe(env.STRIPE_SECRET_KEY);
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const sig = request.headers.get("stripe-signature");
  const body = await request.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const registrationId = session.metadata?.registration_id;

    if (registrationId) {
      const { error } = await sb
        .from("registrations")
        .update({ payment_status: "paid" })
        .eq("id", registrationId);

      if (error) console.error("Failed to update registration:", error);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
