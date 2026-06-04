/// <reference types="vite/client" />

// Global leaderboard config (optional). When BOTH are present at build time the
// game submits/reads scores from Supabase; absent, the leaderboard degrades to an
// "offline" state and the game is otherwise unchanged. The anon key is the public,
// row-level-security-gated key — safe to ship in a static client bundle.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  // Optional crash/error beacon sink. When set, uncaught errors + unhandled rejections are POSTed
  // (navigator.sendBeacon) here as compact, PII-free JSON. Absent → errors log to the console only.
  readonly VITE_ERROR_BEACON_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
