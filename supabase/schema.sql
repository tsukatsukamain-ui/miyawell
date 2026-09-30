-- MIYAWELL データベーススキーマ
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。

-- ============================================
-- 1. events（開催イベント）
-- ============================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  starts_at timestamptz not null,
  capacity int,                    -- null なら定員なし
  price_jpy int not null default 0, -- 0 = 無料イベント
  stripe_price_id text,            -- 有料イベントのみ使用
  status text not null default 'open' check (status in ('open','full','closed')),
  created_at timestamptz not null default now()
);

-- ============================================
-- 2. registrations（参加登録）
-- ============================================
create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  payment_status text not null default 'not_required' check (payment_status in ('not_required','pending','paid','failed')),
  stripe_checkout_session_id text,
  reminder_sent_at timestamptz,    -- 前日リマインドを送ったら記録（二重送信防止）
  created_at timestamptz not null default now(),
  unique (event_id, user_id)       -- 同じイベントに二重登録できないようにする
);

-- ============================================
-- 3. profiles（表示名など、auth.users を補う任意情報）
-- ============================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- 新規ユーザー登録時に profiles を自動作成
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================
-- 4. Row Level Security（RLS）
-- ============================================
alter table public.events enable row level security;
alter table public.registrations enable row level security;
alter table public.profiles enable row level security;

-- events: 誰でも閲覧可、書き込みはservice_roleのみ（管理画面 or SQL Editorから運用）
create policy "events are viewable by everyone"
  on public.events for select
  using (true);

-- registrations: 本人の登録だけ見える・作れる・キャンセルできる
create policy "users can view own registrations"
  on public.registrations for select
  using (auth.uid() = user_id);

create policy "users can insert own registrations"
  on public.registrations for insert
  with check (auth.uid() = user_id);

create policy "users can update own registrations"
  on public.registrations for update
  using (auth.uid() = user_id);

-- profiles: 本人だけ更新可、閲覧は全員可（表示名を出す用途があるため）
create policy "profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ============================================
-- 5. サンプルイベント（動作確認用。不要なら削除してください）
-- ============================================
insert into public.events (title, description, location, starts_at, capacity, price_jpy)
values
  ('姿川 モーニングラン', '泉が丘公園集合・5〜8km、走力不問', '泉が丘公園', now() + interval '14 days', 20, 0),
  ('大谷資料館 ナイトウォーク＋ラン', '地下採掘場跡を見学後、周辺を軽く走ります', '大谷資料館前', now() + interval '21 days', 15, 500)
on conflict do nothing;
