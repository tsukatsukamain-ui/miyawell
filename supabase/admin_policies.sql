-- MIYAWELL 管理画面用の追加ポリシー
-- Supabase の SQL Editor に貼り付けて実行してください。
-- これを実行すると、指定したメールアドレス（運営者）だけが
-- events テーブルを追加・編集・削除できるようになります。

-- 運営者のメールアドレスを自分のものに変更してから実行してください。
-- （すでに tsukatsukamain@gmail.com になっています）

create policy "admin can insert events"
  on public.events for insert
  with check (auth.jwt() ->> 'email' = 'tsukatsukamain@gmail.com');

create policy "admin can update events"
  on public.events for update
  using (auth.jwt() ->> 'email' = 'tsukatsukamain@gmail.com');

create policy "admin can delete events"
  on public.events for delete
  using (auth.jwt() ->> 'email' = 'tsukatsukamain@gmail.com');
