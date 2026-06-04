/**
 * Crash / error beacon — launch-day visibility on the long tail of devices.
 *
 * A 3D browser game can white-screen on a weak/blocked GPU, or throw a runtime error that the type
 * gate never sees (a bad shader, a missing API on an old WebView). Today the only field signal is
 * Cloudflare's aggregate pageview count — we can't tell a 2% crash rate from a 40% one. This catches
 * uncaught errors + unhandled promise rejections and reports a compact, PII-free record.
 *
 * Privacy + cost posture (matching the leaderboard's env-gated, degrade-gracefully model):
 *   - No PII. We send the error name/message, a trimmed stack, the path (not query), the WebGL
 *     availability, the viewport, and the user-agent string — nothing that identifies a person.
 *   - The sink is OPT-IN via `VITE_ERROR_BEACON_URL`. Unset (the default) → we log to the console
 *     only and never touch the network. Point it at any JSON-accepting endpoint when ready.
 *   - Self-throttled: identical errors are sent once, and the whole session is capped, so a render
 *     loop that throws every frame can't hammer the endpoint or the console.
 *   - The handler NEVER throws (an error reporter that crashes is worse than none).
 */

const ENDPOINT = (import.meta.env.VITE_ERROR_BEACON_URL ?? '').trim();
const MAX_PER_SESSION = 8; // backstop against a per-frame thrower flooding the sink

let installed = false;
const seen = new Set<string>(); // de-dupe identical errors within a session
let sent = 0;

/** Extra context to attach to every report, evaluated lazily (only when an error actually fires, so
 *  building it — e.g. a WebGL capability probe — costs nothing on the happy path). */
type MetaFn = () => Record<string, unknown>;

/** Install the global error + unhandledrejection listeners once. Safe to call before anything else
 *  in `main.ts` so it also catches failures during renderer/world construction. */
export function installErrorBeacon(meta: MetaFn = () => ({})): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e: ErrorEvent) => report(e.error ?? e.message, 'error', meta));
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) =>
    report(e.reason, 'unhandledrejection', meta),
  );
}

function report(err: unknown, kind: string, meta: MetaFn): void {
  try {
    const o = (typeof err === 'object' && err ? err : null) as { name?: string; message?: string; stack?: string } | null;
    const name = o?.name ?? 'Error';
    const message = (typeof err === 'string' ? err : o?.message ?? String(err)).slice(0, 300);
    const key = `${name}:${message}`;
    if (seen.has(key) || sent >= MAX_PER_SESSION) return;
    seen.add(key);
    sent++;

    const stack = (o?.stack ? o.stack.split('\n').slice(0, 4).join(' | ') : '').slice(0, 800);
    const payload: Record<string, unknown> = {
      kind,
      name,
      message,
      stack,
      path: location.pathname, // path only — never the query (which can carry deep-link state)
      ua: navigator.userAgent,
      ...safeMeta(meta),
    };

    // Always surface in the console (free, and the only signal when no endpoint is configured).
    console.error('[bmf:error]', payload);

    if (!ENDPOINT) return;
    // CROSS-ORIGIN NOTE: the sink lives on another origin (e.g. *.supabase.co). We send the body as
    // `text/plain` — a CORS "simple" content type — so the browser fires it WITHOUT a preflight that
    // sendBeacon can't satisfy (an `application/json` beacon is silently dropped cross-origin). The
    // endpoint parses the text as JSON. sendBeacon is fire-and-forget; a keepalive fetch is the
    // fallback where sendBeacon is unavailable or refuses the payload.
    try {
      const body = JSON.stringify(payload);
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
      if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(ENDPOINT, blob)) return;
      void fetch(ENDPOINT, {
        method: 'POST',
        body,
        keepalive: true,
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      }).catch(() => {});
    } catch {
      /* a blocked / oversized beacon must never escalate into another error */
    }
  } catch {
    /* an error reporter that throws is worse than none — swallow everything */
  }
}

function safeMeta(meta: MetaFn): Record<string, unknown> {
  try {
    return meta();
  } catch {
    return {};
  }
}
