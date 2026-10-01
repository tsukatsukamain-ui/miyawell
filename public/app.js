// public/app.js
// MIYAWELL フロントエンドのロジック。
// Supabase Auth（Googleログイン）、イベント一覧、参加登録、Stripe決済を扱う。

const { createClient } = supabase;
const sb = createClient(
  window.MIYAWELL_CONFIG.SUPABASE_URL,
  window.MIYAWELL_CONFIG.SUPABASE_ANON_KEY
);

const stripe = Stripe(window.MIYAWELL_CONFIG.STRIPE_PUBLISHABLE_KEY);

const ADMIN_EMAIL = "tsukatsukamain@gmail.com";

let currentUser = null;

// ---------- 認証まわり ----------

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;
  renderAuthState();

  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    renderAuthState();
    loadEvents(); // ログイン状態が変わったら参加ボタンの表示も更新する
  });
}

function renderAuthState() {
  const authArea = document.getElementById("auth-area");
  if (!authArea) return;

  if (currentUser) {
    const name = currentUser.user_metadata?.full_name || currentUser.email;
    const adminLink = currentUser.email === ADMIN_EMAIL
      ? `<a href="admin.html" class="btn btn-ghost">管理画面</a>`
      : "";
    authArea.innerHTML = `
      <span class="user-name">${escapeHtml(name)}</span>
      ${adminLink}
      <button id="logout-btn" class="btn btn-ghost">ログアウト</button>
    `;
    document.getElementById("logout-btn").addEventListener("click", async () => {
      await sb.auth.signOut();
    });
  } else {
    authArea.innerHTML = `<button id="login-btn" class="btn btn-primary">Googleでログイン</button>`;
    document.getElementById("login-btn").addEventListener("click", async () => {
      await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
    });
  }
}

// ---------- イベント一覧 ----------

async function loadEvents() {
  const listEl = document.getElementById("event-list");
  if (!listEl) return;

  const { data: events, error } = await sb
    .from("events")
    .select("*")
    .order("starts_at", { ascending: true });

  if (error) {
    listEl.innerHTML = `<p class="error">イベントの読み込みに失敗しました。</p>`;
    console.error(error);
    return;
  }

  let myRegistrations = [];
  if (currentUser) {
    const { data } = await sb
      .from("registrations")
      .select("event_id, payment_status, status")
      .eq("user_id", currentUser.id)
      .eq("status", "confirmed");
    myRegistrations = data ?? [];
  }

  listEl.innerHTML = events.map((ev) => renderEventRow(ev, myRegistrations)).join("");

  // ボタンのイベントを後付け
  events.forEach((ev) => {
    const freeBtn = document.getElementById(`register-free-${ev.id}`);
    if (freeBtn) freeBtn.addEventListener("click", () => registerFree(ev.id));

    const payBtn = document.getElementById(`register-paid-${ev.id}`);
    if (payBtn) payBtn.addEventListener("click", () => registerPaid(ev.id));

    const cancelBtn = document.getElementById(`cancel-${ev.id}`);
    if (cancelBtn) cancelBtn.addEventListener("click", () => cancelRegistration(ev.id));
  });
}

function renderEventRow(ev, myRegistrations) {
  const date = new Date(ev.starts_at);
  const dateStr = date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
  const timeStr = date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

  const myReg = myRegistrations.find((r) => r.event_id === ev.id);
  const isFree = ev.price_jpy === 0;

  let actionHtml;
  if (!currentUser) {
    actionHtml = `<span class="event-status">ログインして参加</span>`;
  } else if (myReg) {
    const paidLabel = isFree ? "参加登録済み" : myReg.payment_status === "paid" ? "支払い済み" : "支払い待ち";
    actionHtml = `
      <span class="event-status open">${paidLabel}</span>
      <button id="cancel-${ev.id}" class="btn-link">キャンセル</button>
    `;
  } else if (ev.status !== "open") {
    actionHtml = `<span class="event-status">受付終了</span>`;
  } else if (isFree) {
    actionHtml = `<button id="register-free-${ev.id}" class="btn btn-primary btn-sm">参加する</button>`;
  } else {
    actionHtml = `<button id="register-paid-${ev.id}" class="btn btn-primary btn-sm">¥${ev.price_jpy.toLocaleString()}で参加</button>`;
  }

  return `
    <div class="event-row">
      <div class="event-date"><strong>${dateStr}</strong>${timeStr}</div>
      <div>
        <div class="event-name">${escapeHtml(ev.title)}</div>
        <div class="event-place">${escapeHtml(ev.location ?? "")}</div>
      </div>
      <div class="event-action">${actionHtml}</div>
    </div>
  `;
}

// ---------- 参加登録（無料） ----------

async function registerFree(eventId) {
  if (!currentUser) return;
  const { error } = await sb.from("registrations").insert({
    event_id: eventId,
    user_id: currentUser.id,
    payment_status: "not_required",
  });
  if (error) {
    alert("登録に失敗しました。すでに登録済みの可能性があります。");
    console.error(error);
  }
  loadEvents();
}

// ---------- 参加登録（有料 / Stripe） ----------

async function registerPaid(eventId) {
  if (!currentUser) return;

  const res = await fetch("/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId,
      userId: currentUser.id,
      userEmail: currentUser.email,
    }),
  });

  if (!res.ok) {
    alert("決済ページの作成に失敗しました。");
    return;
  }

  const { sessionId } = await res.json();
  await stripe.redirectToCheckout({ sessionId });
}

// ---------- キャンセル ----------

async function cancelRegistration(eventId) {
  if (!currentUser) return;
  const { error } = await sb
    .from("registrations")
    .update({ status: "cancelled" })
    .eq("event_id", eventId)
    .eq("user_id", currentUser.id);
  if (error) console.error(error);
  loadEvents();
}

// ---------- ユーティリティ ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- 起動 ----------

initAuth().then(loadEvents);
