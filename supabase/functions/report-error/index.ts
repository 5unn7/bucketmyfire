// report-error — public crash/error ingest for bucketmyfire.
//
// The game's error beacon (src/three/telemetry/errorBeacon.ts) POSTs a small, PII-free JSON record
// of any uncaught error / unhandled rejection here via navigator.sendBeacon. This function validates
// + clamps the payload and inserts it into the locked `public.client_errors` table using the service
// role (the table denies anon/authenticated direct access — this function is the only writer).
//
// Deployed with verify_jwt = FALSE on purpose: a sendBeacon from an unauthenticated game client
// cannot attach an Authorization header, so this is a deliberately public, write-only telemetry
// sink. Abuse is bounded here — body size cap, field clamps, no reads exposed — not by auth.
//
// Deploy:  supabase functions deploy report-error --no-verify-jwt --project-ref wnorrtfkfqrgipmggfwh

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The beacon is sent as text/plain (a CORS "simple" type, so no preflight). These headers are still
// returned so a future fetch()-based caller works too; sendBeacon ignores the response either way.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

const MAX_BODY = 8192; // bytes — a single error record is tiny; anything larger is junk/abuse

function clamp(v: unknown, n: number): string | null {
  return typeof v === 'string' ? v.slice(0, n) : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: CORS });

  try {
    const raw = await req.text();
    if (raw && raw.length <= MAX_BODY) {
      let d: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') d = parsed as Record<string, unknown>;
      } catch {
        /* malformed body — drop quietly */
      }
      if (d) {
        await admin.from('client_errors').insert({
          kind: clamp(d.kind, 40) ?? 'error',
          name: clamp(d.name, 120) ?? 'Error',
          message: clamp(d.message, 500) ?? '',
          stack: clamp(d.stack, 2000),
          path: clamp(d.path, 200),
          ua: clamp(d.ua, 400),
          meta: { webgl2: bool(d.webgl2), dpr: num(d.dpr), vw: num(d.vw), vh: num(d.vh) },
        });
      }
    }
  } catch {
    // Telemetry must never fail back at the client — always 204.
  }

  // 204 with no body; sendBeacon doesn't read it, but keep it clean for any other caller.
  return new Response(null, { status: 204, headers: CORS });
});
