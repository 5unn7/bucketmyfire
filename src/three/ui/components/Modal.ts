/**
 * Modal — the shared overlay every full-screen dialog should use. Folds the per-overlay scrim +
 * card + close plumbing re-implemented in `openLeaderboard` / `openCloudSave` /
 * `HelpModal`. Owns: blurred scrim, titlebar + close (✕), ESC-to-close, click-scrim-to-close,
 * a Tab focus-trap, and focus restore on close. Mounts itself to `document.body`.
 *
 *   const m = openModal({ title: 'Leaderboard' });
 *   m.body.append(...);  m.footer.append(closeBtn.el);  m.onClose(() => ...);
 */

import { UI, FS, FW, R, el, div, setBlur, scrim, prefersReducedMotion } from '../theme';
import { injectKitStyles } from './base';
import { makeIconButton } from './IconButton';

export interface ModalOpts {
  title?: string;
  width?: string; // card max-width, default '520px'
  dismissable?: boolean; // ESC + scrim-click close, default true
  onClose?: () => void;
}

export interface ModalHandle {
  el: HTMLDivElement; // the scrim root (mounted)
  card: HTMLDivElement;
  body: HTMLDivElement;
  footer: HTMLDivElement;
  close(): void;
  onClose(cb: () => void): void;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
}

export function openModal(opts: ModalOpts = {}): ModalHandle {
  injectKitStyles();
  const dismissable = opts.dismissable !== false;
  const reduce = prefersReducedMotion();
  const closeCbs: Array<() => void> = [];
  if (opts.onClose) closeCbs.push(opts.onClose);

  const root = scrim();

  const card = div({
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    maxWidth: opts.width ?? '520px',
    maxHeight: '88vh',
    background: UI.cardGlass,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.xl,
    boxShadow: UI.shadowCard,
    overflow: 'hidden',
  });
  setBlur(card);
  if (!reduce) card.style.animation = 'bmf-kit-in 0.28s ease both';

  if (opts.title || dismissable) {
    const head = div({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '16px 16px 12px' });
    head.appendChild(el('h2', { margin: '0', fontSize: FS.display, fontWeight: FW.heavy, color: UI.text }, opts.title ?? ''));
    if (dismissable) {
      const x = makeIconButton({ glyph: '✕', size: 36, title: 'Close', onClick: () => close() });
      head.appendChild(x.el);
    }
    card.appendChild(head);
  }

  const body = div({ padding: '0 16px 4px', overflowY: 'auto', flex: '1 1 auto' });
  card.appendChild(body);
  const footer = div({ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 16px 16px' });
  card.appendChild(footer);

  root.appendChild(card);
  const prev = document.activeElement as HTMLElement | null;
  document.body.appendChild(root);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    prev?.focus?.();
    for (const cb of closeCbs) cb();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && dismissable) {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const f = focusables(card);
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);

  if (dismissable) {
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root) close();
    });
  }

  requestAnimationFrame(() => {
    const f = focusables(card);
    (f[0] ?? card).focus?.();
  });

  return { el: root, card, body, footer, close, onClose: (cb) => closeCbs.push(cb) };
}
