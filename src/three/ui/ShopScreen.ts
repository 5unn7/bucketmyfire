import { loadProfile } from './profile';
import { isConfigured, saveToCloud } from '../leaderboard/cloudSave';
import { submitLead } from '../leaderboard/client';
import { UI, FS, FW, R, el, div, setBlur, prefersReducedMotion } from './theme';
import { makeButton } from './components';

/**
 * Merch Shop screen — the merch surface, currently an "in progress" waitlist on the WARM brand
 * register (the fight, not the cockpit, so it runs ember, not cyan). A centered animated ASCII fire
 * is the hero; below it a single EMAIL field + a "Notify me" CTA. Submitting lands the plaintext
 * email as a lead (`submitLead`) so we can reach them when the merch is live; if the player already
 * has a callsign we also pin their progress to that email (`saveToCloud`, hashed) as a silent bonus.
 *
 * Pure DOM, zero assets, self-disposing (✕ / backdrop tap / Esc). Degrades to an "offline" note
 * when Supabase isn't configured. `openShop()` owns its own element — callers don't manage lifecycle.
 */

// Animated ASCII fire — a flickering flame (glowing @ core, # ember base). Frames are the same
// bounding box so it flickers in place rather than jumping. Coloured by a warm gradient + glow below.
const FLAME_FRAMES: string[] = [
  ['       .', '      (@)', '     (@@@)', '    {@@@@@}', '    {@@@@@}', '   {@@@@@@@}', '   (@@@@@@@)', '    )#####(', "     '-#-'"].join('\n'),
  ['       ´', '      )@(', '     {@@@}', '    (@@@@@)', '    {@@@@@}', '   (@@@@@@@)', '   {@@@@@@@}', '    )#####(', "     '-^-'"].join('\n'),
  ['       *', '      (@)', '     )@@@(', '    {@@@@@}', '    (@@@@@)', '   {@@@@@@@}', '   (@@@@@@@)', '    )#####(', "     '-#-'"].join('\n'),
];

/** Open the Squadron Store screen. */
export function openShop(): void {
  new ShopScreen();
}

class ShopScreen {
  private readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly email: HTMLInputElement;
  private readonly notifyBtn: HTMLButtonElement;
  private flameTimer = 0;
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
      // Warm register — the fight, not the cockpit.
      background: 'radial-gradient(120% 90% at 50% 0%, rgba(44,17,13,0.92), rgba(8,4,3,0.97))',
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
      border: `1px solid ${UI.warmStroke}`,
      borderRadius: R.xl,
      boxShadow: UI.shadowCard,
      padding: '20px',
      boxSizing: 'border-box',
      textAlign: 'center',
    });
    setBlur(panel);

    // Close (top-right).
    const close = div(
      { position: 'absolute', top: '0', right: '0', fontSize: FS.sm, fontWeight: FW.bold, color: UI.dim, cursor: 'pointer', padding: '8px 12px' },
      '✕',
    );
    close.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.close();
    });
    const head = div({ position: 'relative' });
    head.appendChild(close);
    panel.appendChild(head);

    // Hero — animated ASCII fire.
    const flame = el('pre', {
      margin: '2px 0 10px',
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: '15px',
      lineHeight: '1.05',
      letterSpacing: '1px',
      textAlign: 'center',
      background: `linear-gradient(180deg, ${UI.emberHi}, ${UI.ember} 58%, ${UI.fire})`,
      backgroundClip: 'text',
      color: 'transparent',
      filter: 'drop-shadow(0 0 12px rgba(255,106,44,0.5))',
      userSelect: 'none',
    });
    flame.style.setProperty('-webkit-background-clip', 'text');
    flame.textContent = FLAME_FRAMES[0];
    if (!prefersReducedMotion()) {
      let f = 0;
      this.flameTimer = window.setInterval(() => {
        f = (f + 1) % FLAME_FRAMES.length;
        flame.textContent = FLAME_FRAMES[f];
      }, 150);
    }
    panel.appendChild(flame);

    // Title + copy.
    panel.appendChild(
      div({ fontSize: FS.hero, fontWeight: FW.heavy, letterSpacing: '0.5px', color: UI.emberHi }, 'MERCH SHOP'),
    );
    panel.appendChild(
      div(
        { fontSize: FS.sm, lineHeight: '1.5', color: UI.dim, margin: '8px auto 16px', maxWidth: '320px' },
        "In progress. Leave your email and we'll notify you the moment it's available.",
      ),
    );

    if (!isConfigured()) {
      panel.appendChild(
        div(
          { fontSize: FS.body, lineHeight: '1.5', color: UI.warm, padding: '14px', borderRadius: R.md, border: `1px solid ${UI.stroke}`, background: UI.field },
          'Sign-up is offline right now. Check back soon for the store.',
        ),
      );
      this.status = div({});
      this.email = document.createElement('input');
      this.notifyBtn = el('button', {});
      this.root.appendChild(panel);
      document.body.appendChild(this.root);
      return;
    }

    this.email = this.field('EMAIL', 'you@example.com', '', 254);
    this.email.type = 'email';
    this.email.autocomplete = 'email';
    this.email.inputMode = 'email';
    panel.appendChild(this.email.parentElement as HTMLDivElement);

    this.status = div({ fontSize: FS.sm, fontWeight: FW.semibold, minHeight: '16px', margin: '4px 2px 12px' });
    panel.appendChild(this.status);

    this.notifyBtn = this.actionBtn('Notify me', () => void this.doNotify());
    panel.appendChild(this.notifyBtn);
    panel.appendChild(
      div({ fontSize: FS.meta, color: UI.faint, marginTop: '12px', lineHeight: '1.45' }, 'No spam — just one email when the merch is live.'),
    );

    this.root.appendChild(panel);
    document.body.appendChild(this.root);
    queueMicrotask(() => this.email.focus());
  }

  // --- action ---------------------------------------------------------------

  private async doNotify(): Promise<void> {
    if (this.busy) return;
    const email = this.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.showStatus('Enter a valid email address.', UI.warm);
      return;
    }
    this.busy = true;
    this.notifyBtn.style.opacity = '0.5';
    this.notifyBtn.style.pointerEvents = 'none';
    this.showStatus('Signing you up…', UI.dim);
    // The lead — store the PLAINTEXT email so we can actually reach them when the merch is live.
    const name = loadProfile()?.name ?? '';
    const lead = await submitLead(email, 'shop', name || undefined);
    // Bonus — if they've set a callsign, pin their progress to that email too (hashed, separate lead).
    if (name) void saveToCloud(name, email);
    if (lead) {
      this.showStatus("✓ You're on the list — we'll email you when the merch is live.", UI.ok);
    } else {
      this.busy = false;
      this.notifyBtn.style.opacity = '1';
      this.notifyBtn.style.pointerEvents = 'auto';
      this.showStatus("Couldn't reach the signup just now — try again in a moment.", UI.warm);
    }
  }

  // --- view helpers ---------------------------------------------------------

  private field(label: string, placeholder: string, value: string, maxLen: number): HTMLInputElement {
    const wrap = div({ marginBottom: '12px', textAlign: 'left' });
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
    input.addEventListener('focus', () => (input.style.borderColor = UI.ember));
    input.addEventListener('blur', () => (input.style.borderColor = UI.stroke));
    input.addEventListener('keydown', (e) => e.stopPropagation()); // keep typing out of the game input
    wrap.appendChild(input);
    return input;
  }

  /** The primary CTA — a kit `primary` Button on the warm "fight" register (the store is a brand
   *  surface, not the cockpit). The busy state is reflected by toggling the element in doNotify(). */
  private actionBtn(label: string, onTap: () => void): HTMLButtonElement {
    return makeButton({
      label,
      variant: 'primary',
      register: 'fight',
      size: 'lg',
      block: true,
      onClick: () => {
        if (!this.busy) onTap();
      },
    }).el;
  }

  private showStatus(text: string, color: string): void {
    this.status.textContent = text;
    this.status.style.color = color;
  }

  private close(): void {
    if (this.flameTimer) window.clearInterval(this.flameTimer);
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.close();
  }
}
