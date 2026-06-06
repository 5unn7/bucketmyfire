import { loadProfile } from './profile';
import { MAX_CALLSIGN } from './callsign';
import {
  isConfigured,
  isCloudLinked,
  getCloudLink,
  clearCloudLink,
  saveToCloud,
  loadFromCloud,
} from '../leaderboard/cloudSave';
import { UI, FS, FW, R, el, div, setBlur } from './theme';
import { makeButton } from './components';

/**
 * Cloud-save overlay — a small frosted modal in the game's cockpit language (matching
 * the pre-flight menu / Leaderboard.ts). Lets a pilot SAVE their campaign progress to an email and
 * RESTORE it on another device or after clearing their browser, by entering pilot name + email.
 * No passwords; the email is hashed in the browser before it's sent (see leaderboard/cloudSave.ts).
 *
 * Pure DOM, zero assets, self-disposing (Close button / backdrop tap / Esc). When Supabase isn't
 * configured it shows a friendly "offline" note instead of the form. `openCloudSave()` owns its own
 * element, so callers don't manage lifecycle. A successful RESTORE reloads the page so the menu's
 * unlocks / best scores re-render from the freshly-merged local store.
 */

// Visual tokens (UI) + `div`/`setBlur` come from ./theme — the one cockpit palette.
// `good` → `UI.ok` (shared success green), `glass` → `UI.cardGlass`, `shadow` → `UI.shadowCard`.

/** Open the cloud save/restore modal. */
export function openCloudSave(): void {
  new CloudSave();
}

class CloudSave {
  private readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly callsign: HTMLInputElement;
  private readonly email: HTMLInputElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly loadBtn: HTMLButtonElement;
  private readonly linkNote: HTMLDivElement;
  private busy = false;

  constructor() {
    this.root = div({
      position: 'fixed',
      inset: '0',
      zIndex: '70',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 0%, rgba(20,32,44,0.9), rgba(4,7,11,0.96))',
      fontFamily: UI.font,
      color: UI.text,
      padding: '34px 18px',
      boxSizing: 'border-box',
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);

    const panel = div({
      width: '100%',
      maxWidth: '420px',
      background: UI.cardGlass,
      border: `1px solid ${UI.stroke}`,
      borderRadius: R.xl,
      boxShadow: UI.shadowCard,
      padding: '22px 20px',
      boxSizing: 'border-box',
    });
    setBlur(panel);

    // Header
    const head = div({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' });
    head.appendChild(div({ fontSize: FS.hero, fontWeight: FW.heavy, letterSpacing: '0.3px' }, '☁ Cloud Save'));
    const close = div(
      { fontSize: FS.sm, fontWeight: FW.bold, letterSpacing: '1px', color: UI.dim, cursor: 'pointer', padding: '6px 10px', borderRadius: R.pill, border: `1px solid ${UI.stroke}` },
      '✕',
    );
    close.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.close();
    });
    head.appendChild(close);
    panel.appendChild(head);

    panel.appendChild(
      div(
        { fontSize: FS.sm, lineHeight: '1.5', color: UI.dim, margin: '6px 0 16px' },
        'Pin your progress to an email — no password. Restore it on any device by entering the same callsign + email.',
      ),
    );

    if (!isConfigured()) {
      panel.appendChild(
        div(
          { fontSize: FS.body, lineHeight: '1.5', color: UI.warm, padding: '14px', borderRadius: R.md, border: `1px solid ${UI.stroke}`, background: UI.field },
          'Cloud saves are offline right now. Your progress is still kept in this browser.',
        ),
      );
      // Still give a way out.
      this.status = div({});
      this.callsign = document.createElement('input');
      this.email = document.createElement('input');
      this.saveBtn = el('button', {});
      this.loadBtn = el('button', {});
      this.linkNote = div({});
      this.root.appendChild(panel);
      document.body.appendChild(this.root);
      return;
    }

    const link = getCloudLink();
    const profileName = loadProfile()?.name ?? '';

    this.callsign = this.field('CALLSIGN', 'Your pilot name', link?.pilot || profileName, MAX_CALLSIGN);
    this.email = this.field('EMAIL', 'you@example.com', link?.email || '', 254);
    this.email.type = 'email';
    this.email.autocomplete = 'email';
    this.email.inputMode = 'email';

    panel.appendChild(this.callsign.parentElement as HTMLDivElement);
    panel.appendChild(this.email.parentElement as HTMLDivElement);

    // Status line (validation / progress / result).
    this.status = div({ fontSize: FS.sm, fontWeight: FW.semibold, minHeight: '16px', margin: '4px 2px 12px' });
    panel.appendChild(this.status);

    // Action buttons.
    const actions = div({ display: 'flex', gap: '10px' });
    this.saveBtn = this.actionBtn('⬆  Save', () => void this.doSave());
    this.loadBtn = this.actionBtn('⬇  Load', () => void this.doLoad());
    actions.appendChild(this.saveBtn);
    actions.appendChild(this.loadBtn);
    panel.appendChild(actions);

    // Linked-device footer (shown once this browser is tied to an account).
    this.linkNote = div({ fontSize: FS.meta, color: UI.dim, marginTop: '14px', textAlign: 'center' });
    panel.appendChild(this.linkNote);
    this.renderLinkNote();

    this.root.appendChild(panel);
    document.body.appendChild(this.root);
    queueMicrotask(() => (link?.pilot ? this.email : this.callsign).focus());
  }

  // --- actions --------------------------------------------------------------

  private async doSave(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.showStatus('Saving…', UI.dim);
    const res = await saveToCloud(this.callsign.value, this.email.value);
    this.setBusy(false);
    if (res.ok) {
      this.showStatus('✓ ' + (res.detail ?? 'Saved.'), UI.ok);
      this.renderLinkNote();
    } else {
      this.showStatus(res.reason, UI.warm);
    }
  }

  private async doLoad(): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    this.showStatus('Looking up your save…', UI.dim);
    const res = await loadFromCloud(this.callsign.value, this.email.value);
    if (res.ok) {
      this.showStatus('✓ ' + (res.detail ?? 'Restored.') + ' Reloading…', UI.ok);
      // Reload so unlocks / best scores / callsign re-render from the merged local store.
      window.setTimeout(() => window.location.reload(), 650);
      return; // stay busy through the reload
    }
    this.setBusy(false);
    this.showStatus(res.reason, UI.warm);
  }

  // --- view helpers ---------------------------------------------------------

  private renderLinkNote(): void {
    if (isCloudLinked()) {
      const link = getCloudLink();
      this.linkNote.replaceChildren(
        document.createTextNode(`Linked to ${link?.email ?? ''} · `),
      );
      const unlink = el('span', { color: UI.accent, cursor: 'pointer', textDecoration: 'underline' }, 'unlink this device');
      unlink.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        clearCloudLink();
        this.renderLinkNote();
        this.showStatus('This device unlinked — auto-sync off.', UI.dim);
      });
      this.linkNote.appendChild(unlink);
    } else {
      this.linkNote.textContent = 'Once saved, this device auto-syncs your progress on every win.';
    }
  }

  private field(label: string, placeholder: string, value: string, maxLen: number): HTMLInputElement {
    const wrap = div({ marginBottom: '12px' });
    wrap.appendChild(
      div({ fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '2px', color: UI.dim, marginBottom: '5px' }, label),
    );
    const input = document.createElement('input');
    Object.assign(input.style, {
      width: '100%',
      boxSizing: 'border-box',
      background: UI.field,
      border: `1px solid ${UI.stroke}`,
      borderRadius: R.md,
      padding: '11px 12px',
      color: UI.text,
      font: 'inherit',
      fontSize: FS.lg,
      outline: 'none',
    } as Partial<CSSStyleDeclaration>);
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = maxLen;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('focus', () => (input.style.borderColor = UI.accent));
    input.addEventListener('blur', () => (input.style.borderColor = UI.stroke));
    input.addEventListener('keydown', (e) => e.stopPropagation()); // keep WASD/typing out of the game input
    wrap.appendChild(input);
    return input;
  }

  /** Save / Load — kit `secondary` Buttons on the cockpit register (cloud-save is a utility, not a
   *  brand surface). The busy state is reflected by toggling the elements in setBusy(). */
  private actionBtn(label: string, onTap: () => void): HTMLButtonElement {
    const h = makeButton({
      label,
      variant: 'secondary',
      register: 'cockpit',
      onClick: () => {
        if (!this.busy) onTap();
      },
    });
    h.el.style.flex = '1';
    return h.el;
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    for (const b of [this.saveBtn, this.loadBtn]) {
      b.style.opacity = on ? '0.5' : '1';
      b.style.pointerEvents = on ? 'none' : 'auto';
    }
  }

  private showStatus(text: string, color: string): void {
    this.status.textContent = text;
    this.status.style.color = color;
  }

  private close(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.close();
  }
}

// `el` / `div` / `setBlur` are imported from ./theme (shared DOM helpers).
