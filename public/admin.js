// public/admin.js
// MIYAWELL 管理画面。イベントの追加・編集・削除をSQLを書かずに行える。
// アクセス制御は見た目上はここでも行うが、本当の安全性はSupabaseのRLS
// （auth.jwt() ->> 'email' = 'ADMIN_EMAIL' のみ書き込み許可）が担っている。

const ADMIN_EMAIL = "tsukatsukamain@gmail.com";

const { createClient } = supabase;
const sb = createClient(
  window.MIYAWELL_CONFIG.SUPABASE_URL,
  window.MIYAWELL_CONFIG.SUPABASE_ANON_KEY
);

let currentUser = null;

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;
  renderAuthState();
  renderApp();

  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    renderAuthState();
    renderApp();
  });
}

function renderAuthState() {
  const authArea = document.getElementById("auth-area");
  if (currentUser) {
    authArea.innerHTML = `
      <span class="user-name">${escapeHtml(currentUser.email)}</span>
      <button id="logout-btn" class="btn btn-ghost btn-sm">ログアウト</button>
    `;
    document.getElementById("logout-btn").addEventListener("click", async () => {
      await sb.auth.signOut();
    });
  } else {
    authArea.innerHTML = `<button id="login-btn" class="btn btn-primary btn-sm">Googleでログイン</button>`;
    document.getElementById("login-btn").addEventListener("click", async () => {
      await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/admin.html" },
      });
    });
  }
}

function isAdmin() {
  return currentUser && currentUser.email === ADMIN_EMAIL;
}

async function renderApp() {
  const app = document.getElementById("app");

  if (!currentUser) {
    app.innerHTML = `<p class="locked">管理画面を見るにはログインしてください。</p>`;
    return;
  }
  if (!isAdmin()) {
    app.innerHTML = `<p class="locked">このアカウントには管理画面への権限がありません。</p>`;
    return;
  }

  app.innerHTML = `
    <h1>イベント管理</h1>
    <p class="sub">ここで追加・編集した内容は、すぐにサイトのイベント一覧に反映されます。</p>

    <div class="card">
      <h2>新しいイベントを追加</h2>
      <form id="new-event-form">${eventFormFields()}</form>
      <div class="form-actions">
        <button type="submit" form="new-event-form" class="btn btn-primary">追加する</button>
      </div>
      <div id="new-event-msg"></div>
    </div>

    <div class="card">
      <h2>既存のイベント</h2>
      <div id="event-list"><p class="locked">読み込み中...</p></div>
    </div>
  `;

  document.getElementById("new-event-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await createEvent(e.target);
  });

  loadEventList();
}

function eventFormFields(ev = {}) {
  const starts = ev.starts_at ? toLocalInputValue(ev.starts_at) : "";
  return `
    <div class="form-grid">
      <div class="field full">
        <label>イベント名</label>
        <input name="title" required value="${escapeAttr(ev.title ?? "")}">
      </div>
      <div class="field full">
        <label>説明</label>
        <textarea name="description">${escapeHtml(ev.description ?? "")}</textarea>
      </div>
      <div class="field">
        <label>開催日時</label>
        <input type="datetime-local" name="starts_at" required value="${starts}">
      </div>
      <div class="field">
        <label>集合場所</label>
        <input name="location" value="${escapeAttr(ev.location ?? "")}">
      </div>
      <div class="field">
        <label>定員（空欄なら無制限）</label>
        <input type="number" name="capacity" min="1" value="${ev.capacity ?? ""}">
      </div>
      <div class="field">
        <label>参加費（円、0なら無料）</label>
        <input type="number" name="price_jpy" min="0" value="${ev.price_jpy ?? 0}">
      </div>
      <div class="field">
        <label>ステータス</label>
        <select name="status">
          <option value="open" ${ev.status === "open" || !ev.status ? "selected" : ""}>受付中 (open)</option>
          <option value="full" ${ev.status === "full" ? "selected" : ""}>満員 (full)</option>
          <option value="closed" ${ev.status === "closed" ? "selected" : ""}>受付終了 (closed)</option>
        </select>
      </div>
    </div>
  `;
}

function readEventForm(form) {
  const fd = new FormData(form);
  const capacity = fd.get("capacity");
  return {
    title: fd.get("title").trim(),
    description: fd.get("description").trim() || null,
    location: fd.get("location").trim() || null,
    starts_at: new Date(fd.get("starts_at")).toISOString(),
    capacity: capacity ? Number(capacity) : null,
    price_jpy: Number(fd.get("price_jpy") || 0),
    status: fd.get("status"),
  };
}

async function createEvent(form) {
  const msg = document.getElementById("new-event-msg");
  const payload = readEventForm(form);
  const { error } = await sb.from("events").insert(payload);
  if (error) {
    msg.innerHTML = `<p class="msg error">追加に失敗しました: ${escapeHtml(error.message)}</p>`;
    return;
  }
  msg.innerHTML = `<p class="msg ok">追加しました。</p>`;
  form.reset();
  loadEventList();
}

async function loadEventList() {
  const listEl = document.getElementById("event-list");
  const { data: events, error } = await sb
    .from("events")
    .select("*")
    .order("starts_at", { ascending: true });

  if (error) {
    listEl.innerHTML = `<p class="msg error">読み込みに失敗しました: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!events || events.length === 0) {
    listEl.innerHTML = `<p class="locked">イベントがまだありません。</p>`;
    return;
  }

  listEl.innerHTML = events.map((ev) => renderEventItem(ev)).join("");

  events.forEach((ev) => {
    document.getElementById(`edit-btn-${ev.id}`).addEventListener("click", () => toggleEdit(ev));
    document.getElementById(`delete-btn-${ev.id}`).addEventListener("click", () => deleteEvent(ev));
  });
}

function renderEventItem(ev) {
  const date = new Date(ev.starts_at);
  const dateStr = date.toLocaleString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
  const priceStr = ev.price_jpy > 0 ? `¥${ev.price_jpy.toLocaleString()}` : "無料";
  return `
    <div class="event-item" id="item-${ev.id}">
      <div class="event-item-head">
        <div>
          <div class="event-item-title">${escapeHtml(ev.title)}</div>
          <div class="event-item-meta">${dateStr} ・ ${escapeHtml(ev.location ?? "場所未設定")} ・ ${priceStr} ・ ${escapeHtml(ev.status)}</div>
        </div>
        <div class="event-item-actions">
          <button id="edit-btn-${ev.id}" class="btn btn-ghost btn-sm">編集</button>
          <button id="delete-btn-${ev.id}" class="btn btn-danger btn-sm">削除</button>
        </div>
      </div>
      <div id="edit-area-${ev.id}"></div>
    </div>
  `;
}

function toggleEdit(ev) {
  const area = document.getElementById(`edit-area-${ev.id}`);
  if (area.dataset.open === "1") {
    area.innerHTML = "";
    area.dataset.open = "0";
    return;
  }
  area.dataset.open = "1";
  area.innerHTML = `
    <form id="edit-form-${ev.id}" style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);">
      ${eventFormFields(ev)}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-sm">保存する</button>
      </div>
      <div id="edit-msg-${ev.id}"></div>
    </form>
  `;
  document.getElementById(`edit-form-${ev.id}`).addEventListener("submit", async (e) => {
    e.preventDefault();
    await updateEvent(ev.id, e.target);
  });
}

async function updateEvent(id, form) {
  const msg = document.getElementById(`edit-msg-${id}`);
  const payload = readEventForm(form);
  const { error } = await sb.from("events").update(payload).eq("id", id);
  if (error) {
    msg.innerHTML = `<p class="msg error">保存に失敗しました: ${escapeHtml(error.message)}</p>`;
    return;
  }
  msg.innerHTML = `<p class="msg ok">保存しました。</p>`;
  loadEventList();
}

async function deleteEvent(ev) {
  if (!confirm(`「${ev.title}」を削除しますか？参加登録のデータも一緒に削除されます。`)) return;
  const { error } = await sb.from("events").delete().eq("id", ev.id);
  if (error) {
    alert("削除に失敗しました: " + error.message);
    return;
  }
  loadEventList();
}

// ---------- ユーティリティ ----------

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

function toLocalInputValue(isoString) {
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

init();
