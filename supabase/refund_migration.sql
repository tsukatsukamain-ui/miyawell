-- MIYAWELL 返金機能用の追加カラム
-- Supabase の SQL Editor に貼り付けて実行してください。

alter table public.registrations
  add column if not exists cancelled_at timestamptz,
  add column if not exists refund_status text not null default 'none'
    check (refund_status in ('none','requested','refunded','denied')),
  add column if not exists refund_amount int,
  add column if not exists stripe_refund_id text,
  add column if not exists user_email text;

-- 管理者（運営者）は、他の人の返金リクエストも一覧で見れるようにする
create policy "admin can view all registrations"
  on public.registrations for select
  using (auth.jwt() ->> 'email' = 'tsukatsukamain@gmail.com');
