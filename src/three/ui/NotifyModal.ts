/**
 * Notify-me modal — email capture for an UPCOMING (not-yet-live) map. Opened from the Solo map picker's
 * "Notify me" button on a "coming soon" map. On submit it posts the address to the leadlist (the
 * `submit_lead` RPC, via leaderboard/client) tagged with the map and the pilot's callsign, and ensures a
 * callsign exists first (ensureCallsign generates + persists one for a pilot who never set one) so their
 * email and handle are linked. Best-effort + honest: a failed/offline submit says so plainly; it never
 * throws into the menu. Composes the kit (openModal + makeField + makeButton) — no rival form chrome.
 */

import { UI, FS, FW, el, div } from './theme';
import { openModal, makeField, makeButton } from './components';
import { submitLead } from '../leaderboard/client';
import { ensureCallsign } from './profile';

const LEAD_SOURCE_MAX = 24; // matches the leads.source column cap (schema.sql)

/** Open the capture modal for one upcoming map. `mapName` is the display name; `mapId` tags the lead so
 *  we know WHICH map a signup wants ("notify:british-columbia"). */
export function openNotifyModal(mapId: string, mapName: string): void {
  const m = openModal({ title: `${mapName} is coming`, width: '440px' });

  const intro = div(
    { fontSize: FS.body, color: UI.dim, lineHeight: '1.5', margin: '0 0 18px' },
    "Not flyable yet. Leave your email and we'll tell you the day it opens. No spam.",
  );
  m.body.appendChild(intro);

  const field = makeField({
    label: 'Email',
    type: 'email',
    placeholder: 'you@example.com',
    register: 'fight',
    hint: 'Only used to tell you when a new map ships.',
  });
  m.body.appendChild(field.el);

  // Warm "fight" primary — this is a brand CTA, not a cockpit control. The footer owns the action.
  const submit = makeButton({ label: 'Notify me', icon: '🔔', variant: 'primary', register: 'fight', block: true });
  const closeBtn = makeButton({ label: 'Close', variant: 'secondary', register: 'fight', block: true, onClick: () => m.close() });
  m.footer.appendChild(submit.el);

  let done = false;
  const run = async (): Promise<void> => {
    if (done) return;
    const email = field.value().trim();
    // Same shape check the client uses — fail fast in the field rather than after a wasted round-trip.
    if (email.length < 5 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      field.setError('Enter a valid email address.');
      field.focus();
      return;
    }
    field.clearMsg();
    submit.setLoading(true);
    // Tie the email to a callsign (generating + persisting one if this pilot never named themselves), so
    // the leadlist row and a future board pilot are the same handle.
    const callsign = ensureCallsign();
    const ok = await submitLead(email, `notify:${mapId}`.slice(0, LEAD_SOURCE_MAX), callsign);
    submit.setLoading(false);
    if (!ok) {
      field.setError("Couldn't sign you up just now. Try again.");
      return;
    }
    done = true;
    showConfirmed(callsign);
  };

  // Enter in the field submits, mirroring the button.
  field.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  });
  submit.el.addEventListener('click', () => void run());

  /** Swap the form for a confirmation: you're on the list, flying as <callsign>. The footer button
   *  becomes a plain Close. */
  function showConfirmed(callsign: string): void {
    m.body.replaceChildren();
    const head = div(
      { fontSize: FS.title, fontWeight: FW.heavy, color: UI.ok, display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0 10px' },
      "✓ You're on the list",
    );
    m.body.appendChild(head);
    const line = el('p', { fontSize: FS.body, color: UI.dim, lineHeight: '1.55', margin: '0 0 4px' });
    line.append(`We'll email you when ${mapName} opens. You're flying as `);
    line.appendChild(el('b', { color: UI.text, fontWeight: FW.bold }, callsign)); // callsign is sanitized; textContent via el()
    line.append('.');
    m.body.appendChild(line);

    submit.el.replaceWith(closeBtn.el);
  }
}
