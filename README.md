# MIYAWELL セットアップ手順

Googleログイン・参加登録・Stripe決済・前日リマインドメールを備えたイベント管理サイトです。
構成: Supabase（DB・認証） + Cloudflare Pages（ホスティング・決済API） + Stripe（決済） + Resend（メール送信）

すべて無料枠の範囲で始められます。

---

## 0. 前提

- GitHubアカウント（Cloudflare Pagesとの連携に使う）
- Cloudflareアカウント（https://dash.cloudflare.com）
- Supabaseアカウント（https://supabase.com）
- Google Cloud Platformアカウント（OAuth設定用。既存のGoogleアカウントでOK）
- Stripeアカウント（https://stripe.com）
- Resendアカウント（https://resend.com。メール送信用）

---

## 1. Supabaseプロジェクトを作る

1. https://supabase.com で新規プロジェクトを作成
2. プロジェクトができたら「SQL Editor」を開き、`supabase/schema.sql` の中身を全部貼り付けて実行
   - `events` `registrations` `profiles` の3テーブルと、RLS（行レベルセキュリティ）、サンプルイベント2件が作られます
3. 「Project Settings > API」から以下をメモしておく
   - `Project URL` → `SUPABASE_URL`
   - `Publishable key`（旧 anon public キー） → `SUPABASE_ANON_KEY`（フロントに公開してOKな鍵）
   - `service_role` キー（`Reveal` で表示） → `SUPABASE_SERVICE_ROLE_KEY`（絶対に公開しない。Cloudflareの環境変数にのみ設定）

---

## 2. Google OAuthを設定する

1. https://console.cloud.google.com で新しいプロジェクトを作成（または既存を使用）
2. 「APIとサービス > OAuth同意画面」を設定（外部・アプリ名はMIYAWELLなど）
3. 「認証情報 > OAuthクライアントIDを作成」→ アプリケーションの種類は「ウェブアプリケーション」
4. 承認済みのリダイレクトURIに、SupabaseのAuth設定画面に表示される値を追加
   （Supabaseダッシュボード「Authentication > Sign In / Providers > Google」を開くと、コールバックURLが表示されます。それをそのままGoogle側に貼り付ける）
5. 発行された「クライアントID」「クライアントシークレット」を、Supabaseの同じGoogle設定画面に入力して保存
6. Supabaseの「Authentication > URL Configuration」で、サイトのURL（本番URL、まずはCloudflare PagesのURLでOK）を「Site URL」に登録

これで `sb.auth.signInWithOAuth({ provider: "google" })` が動くようになります。

---

## 3. Stripeを設定する

1. Stripeダッシュボードの「開発者 > APIキー」から
   - `公開可能キー(pk_...)` → `STRIPE_PUBLISHABLE_KEY`
   - `シークレットキー(sk_...)` → `STRIPE_SECRET_KEY`
2. デプロイ後、「開発者 > Webhook」でエンドポイントを追加
   - URL: `https://あなたのサイト.pages.dev/stripe-webhook`
   - イベント: `checkout.session.completed` を選択
   - 発行された署名シークレット(whsec_...) → `STRIPE_WEBHOOK_SECRET`

料金体系: Stripeは月額固定費なし、決済ごとに手数料（日本国内カードで概ね3.6%）のみ。

---

## 4. Resendを設定する（前日リマインドメール用）

1. https://resend.com でアカウント作成、APIキーを発行 → `RESEND_API_KEY`
2. 送信元アドレスは、最初は Resend が用意するテストドメインでも動作確認できます
   （本番でちゃんと届けるには、自分の独自ドメインをResendに登録してDNS認証するのがおすすめ）
3. Supabase CLIで Edge Function をデプロイ:
   ```
   supabase functions deploy send-reminders
   supabase secrets set RESEND_API_KEY=xxxx SUPABASE_SERVICE_ROLE_KEY=xxxx REMINDER_FROM_EMAIL="MIYAWELL <info@yourdomain.com>"
   ```
4. Supabaseダッシュボード「Database > Cron Jobs」で、毎日1回この関数を呼ぶジョブを設定
   （例: 毎日 JST 9:00 = UTC 0:00 に実行）

---

## 5. サイト本体をGitHub + Cloudflare Pagesにデプロイする

1. GitHubで新しいリポジトリを作成し、このフォルダの中身を全部push（GitHubのウェブ画面から「Add file > Upload files」でドラッグ＆ドロップでもOK。gitコマンドは不要）
2. Cloudflareダッシュボード → 「Workers & Pages」→「Create」→「Pages」タブ →「Connect to Git」
3. 先ほどのGitHubリポジトリを選択
4. ビルド設定:
   - フレームワークプリセット: 「None」
   - ビルドコマンド: `npm install`
   - ビルド出力ディレクトリ: `public`
5. 「Settings > Environment variables」に以下を追加（Production環境に設定）
   ```
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   STRIPE_SECRET_KEY=...
   STRIPE_WEBHOOK_SECRET=...
   SITE_URL=https://あなたのサイト.pages.dev
   ```
6. `public/config.example.js` を `public/config.js` としてコピーし、
   `SUPABASE_URL` `SUPABASE_ANON_KEY` `STRIPE_PUBLISHABLE_KEY`（すべて公開して問題ない値）を入力してリポジトリに含める
   - `config.js` は公開鍵しか入れないので `.gitignore` していません。秘密鍵(`service_role` `sk_...`)を絶対に入れないこと
7. デプロイが完了すると `https://ランダムな文字列.pages.dev` のようなURLが発行される。以後、GitHubにpushするたびに自動で再デプロイされる

---

## 動作確認の流れ

1. サイトを開く → 「Googleでログイン」→ Google認証 → ログイン状態になる
2. イベント一覧が表示される（サンプル2件が最初から入っている）
3. 無料イベントは「参加する」ボタンで即登録
4. 有料イベントは「¥500で参加」→ Stripeの決済ページへ → 支払い完了で「支払い済み」表示に変わる
5. 前日になるとEdge Functionがメールを送る（Cron Jobsで手動実行して即テストも可能）

## 次にやること候補

- 管理画面（イベントの追加・編集をSQL Editorではなく画面からできるように）
- キャンセル時のStripe返金処理
- LINE通知など、メール以外のリマインド手段
- 独自ドメイン（miyawell.jp など）をCloudflare Pagesに接続する
