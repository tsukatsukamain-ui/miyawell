// public/config.example.js
// このファイルを public/config.js としてコピーし、実際の値を入れてください。
// config.js は .gitignore 済みなので、Git には公開鍵しか含まれません（秘密鍵は含めないこと）。

window.MIYAWELL_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",       // Supabase プロジェクト設定 > API から取得
  SUPABASE_ANON_KEY: "eyJ...",                          // 同上（anon / public キー。secretキーは絶対に使わない）
  STRIPE_PUBLISHABLE_KEY: "pk_test_xxxxxxxx",           // Stripe ダッシュボード > 開発者 > APIキー
};
