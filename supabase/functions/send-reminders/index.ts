// supabase/functions/send-reminders/index.ts
// 翌日開催のイベントに参加登録している人へ、リマインドメールを送るEdge Function。
// Resend（https://resend.com）のAPIを使う。無料枠は月3,000通まで。
//
// デプロイ: supabase functions deploy send-reminders
// 環境変数: supabase secrets set RESEND_API_KEY=xxxx SUPABASE_SERVICE_ROLE_KEY=xxxx
// 定時実行: Supabaseダッシュボード > Database > Cron Jobs で
//   毎日決まった時刻にこの関数を呼ぶジョブを設定する（例: 毎日9:00 JST = 0:00 UTC）

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("REMINDER_FROM_EMAIL") ?? "MIYAWELL <noreply@miyawell.example.com>";

Deno.serve(async () => {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000); // 23時間後
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);   // 25時間後

  // 「明日開催」かつ「まだリマインド未送信」の参加登録を取得
  const { data: registrations, error } = await sb
    .from("registrations")
    .select("id, user_id, events!inner(title, starts_at, location)")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gte("events.starts_at", windowStart.toISOString())
    .lt("events.starts_at", windowEnd.toISOString());

  if (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0;

  for (const reg of registrations ?? []) {
    // auth.users からメールアドレスを取得
    const { data: userData, error: userError } = await sb.auth.admin.getUserById(reg.user_id);
    if (userError || !userData?.user?.email) continue;

    const ev = reg.events as unknown as { title: string; starts_at: string; location: string };
    const dateStr = new Date(ev.starts_at).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: userData.user.email,
        subject: `【明日開催】${ev.title}`,
        html: `
          <p>${dateStr}〜「${ev.title}」開催です。</p>
          <p>集合場所: ${ev.location}</p>
          <p>お待ちしています。</p>
        `,
      }),
    });

    await sb
      .from("registrations")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", reg.id);

    sent++;
  }

  return new Response(JSON.stringify({ sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
