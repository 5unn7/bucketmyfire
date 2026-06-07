/**
 * BMF Gear landing page (shop.html) — the standalone merch site's only script. It wires the
 * email-capture forms to the SAME hardened Supabase leads pipeline the game uses: `submitLead` posts
 * to the `submit_lead` SECURITY DEFINER RPC, which validates + dedupes + throttles server-side. No
 * Three.js, no game boot — this is just the website's form behaviour, so its bundle stays tiny
 * (`leaderboard/client.ts` pulls in only the dependency-free `ui/callsign.ts`).
 *
 * Leads from here are tagged `source: 'shop-page'` (vs the in-game overlay's `'shop'`) so the
 * standalone site is attributable. Degrades to a quiet "offline" note when Supabase isn't configured.
 */
import { submitLead, isConfigured } from '../three/leaderboard/client';
import { injectFonts } from '../three/ui/fonts';

// Same self-hosted brand type as the game (Saira display + JetBrains Mono), so the merch site and the
// game read as one product. shop.html's `--font` var points at 'Saira Variable'; this loads the woff2.
injectFonts();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ONLINE = isConfigured();
const OFFLINE_MSG = "Sign-up's offline right now — check back soon.";

type Tone = 'dim' | 'ok' | 'warn';

function setMsg(node: HTMLElement | null, text: string, tone: Tone): void {
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

function wire(form: HTMLFormElement): void {
  const input = form.querySelector('input');
  const btn = form.querySelector('button');
  const msg = form.parentElement?.querySelector<HTMLElement>('.msg') ?? null;
  if (!input || !btn) return;

  if (!ONLINE) setMsg(msg, OFFLINE_MSG, 'dim'); // tell cold visitors up front (dev without .env / mis-config)

  let busy = false;
  let done = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || done) return;
    const email = input.value.trim();
    if (!EMAIL_RE.test(email)) {
      setMsg(msg, 'Enter a valid email address.', 'warn');
      input.focus();
      return;
    }
    if (!ONLINE) {
      setMsg(msg, OFFLINE_MSG, 'dim');
      return;
    }
    busy = true;
    btn.disabled = true;
    btn.textContent = 'Signing up…';
    setMsg(msg, '', 'dim');
    const ok = await submitLead(email, 'shop-page');
    if (ok) {
      done = true;
      input.disabled = true;
      btn.textContent = "You're in";
      setMsg(msg, "✓ You're on the list. We'll email you when the gear drops.", 'ok');
    } else {
      busy = false;
      btn.disabled = false;
      btn.textContent = 'Notify me';
      setMsg(msg, "Couldn't reach the signup just now — try again in a moment.", 'warn');
    }
  });
}

document.querySelectorAll<HTMLFormElement>('form[data-capture]').forEach(wire);
