/**
 * Help modal — the "?" button's panel. Deliberately SIMPLE: one screen, no swipe,
 * no icons, no diagrams. Just two things, with strong typographic hierarchy:
 *
 *   THE LOOP  — the whole game in four beats: fill the bucket → drop on fire →
 *               get points → unlock helis. Big ghosted numerals carry the order.
 *   CONTROLS  — a compact action ⇢ keys · touch reference (keyboard + on-screen).
 *
 * Built on the component kit: the scrim, card, close ✕, ESC / scrim-click close and
 * focus-trap all come from `openModal()`; the footer buttons are `makeButton()`s. This
 * module owns only the CONTENT + a small token-driven layout stylesheet (no hard-coded
 * colour/blur — the `verify:ui` ratchet enforces it).
 *
 * Lifecycle: `Input` builds ONE controller and wires the "?" icon to `toggle()`. The
 * modal is created on `open()` (via `openModal`, which mounts its own scrim) and
 * destroyed on `close()`. The footer keeps a "Replay first flight" link that re-runs
 * the interactive coach. The first-run TEACHER is the coach, not this reference.
 */

import { UI, FS, FW, R } from './theme';
import { openModal, type ModalHandle } from './components/Modal';
import { makeButton } from './components/Button';
import { resetTutorial } from './coach/coachStore';

const SEEN_KEY = 'bmf.help.seen.v1';

/** Has the pilot already been shown the quick-start once? (false if storage is blocked.) */
export function hasSeenHelp(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the quick-start has been shown, so it never auto-pops again. */
export function markHelpSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // storage blocked — it'll just greet again next session, harmless
  }
}

// --- content ----------------------------------------------------------------

/** One beat of the core loop: a title + a single-line "how". */
interface Beat {
  title: string;
  body: string;
}
const LOOP: Beat[] = [
  { title: 'Fill the bucket', body: 'Fly low over a lake until the slung bucket dips in. It fills itself, no button.' },
  { title: 'Drop on fire', body: 'Line up over the flames and hit DROP. Fly level so the water lands true.' },
  { title: 'Get points', body: 'Every fire you put out banks points.' },
  { title: 'Unlock helis', body: 'Spend points on faster aircraft.' },
];

/** A control row: an action and the keyboard + touch ways to do it. */
interface Ctrl {
  action: string;
  keys: string[]; // keyboard cap labels (empty → touch-only)
  touch: string; // on-screen control name
}
const CONTROLS: Ctrl[] = [
  { action: 'Speed (fwd / back)', keys: ['W', 'S'], touch: 'Left stick' },
  { action: 'Strafe (sideways)', keys: ['A', 'D'], touch: 'Left stick' },
  { action: 'Turn the nose', keys: ['Q', 'E'], touch: 'Right stick' },
  { action: 'Altitude', keys: ['I', 'J'], touch: 'Right stick' },
  { action: 'Drop water', keys: ['Space'], touch: 'DROP' },
  { action: 'Look around', keys: [], touch: 'Drag the view' },
];

// --- styles (injected once) -------------------------------------------------

let stylesInjected = false;
/** Inject the layout stylesheet once. The scrim / card / close / button chrome lives in the component
 *  kit; this is layout-only, and every colour reads from a `theme.ts` token (no raw literals — the
 *  `verify:ui` ratchet enforces it). */
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
  /* Head: kicker + title (sits left of the kit's close ✕ in the modal head row) */
  .bmf-help-head { display: flex; flex-direction: column; gap: 2px; }
  .bmf-help-kicker { font-size: ${FS.meta}; letter-spacing: 0.26em; text-transform: uppercase; color: ${UI.accent}; opacity: 0.85; font-weight: ${FW.bold}; margin: 0; }
  .bmf-help-title { margin: 0; font-size: ${FS.display}; font-weight: ${FW.heavy}; letter-spacing: 0.02em; color: ${UI.text}; }

  /* Section labels */
  .bmf-help-sec { font-size: ${FS.meta}; letter-spacing: 0.2em; text-transform: uppercase; color: ${UI.accent}; opacity: 0.8; font-weight: ${FW.bold}; margin: 6px 0 14px; }
  .bmf-help-sec.is-controls { margin-top: 26px; }

  /* The loop — numbered beats (the hero) */
  .bmf-help-loop { display: grid; gap: 15px; }
  .bmf-help-beat { display: grid; grid-template-columns: 30px 1fr; gap: 14px; align-items: baseline; }
  .bmf-help-n { font-size: ${FS.title}; font-weight: ${FW.heavy}; line-height: 1; color: ${UI.accent}; opacity: 0.45; font-variant-numeric: tabular-nums; }
  .bmf-help-bt { font-size: ${FS.lg}; font-weight: ${FW.bold}; color: ${UI.text}; margin: 0; }
  .bmf-help-bb { font-size: ${FS.sm}; line-height: 1.45; color: ${UI.textCool}; margin: 3px 0 0; }

  /* Controls — compact reference rows */
  .bmf-help-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 9px 0; border-top: 1px solid ${UI.hair}; }
  .bmf-help-row:first-of-type { border-top: none; }
  .bmf-help-act { font-size: ${FS.body}; color: ${UI.text}; }
  .bmf-help-keys { display: flex; align-items: center; gap: 6px; }
  .bmf-help-key {
    display: inline-flex; align-items: center; justify-content: center; min-width: 26px; height: 26px;
    padding: 0 8px; border-radius: ${R.sm}; font-size: ${FS.sm}; font-weight: ${FW.bold}; color: ${UI.text};
    background: ${UI.track}; border: 1px solid ${UI.strokeStrong};
  }
  .bmf-help-sep { color: ${UI.faint}; font-size: ${FS.meta}; }
  .bmf-help-touch { font-size: ${FS.sm}; color: ${UI.dim}; white-space: nowrap; }

  @media (max-width: 380px) {
    .bmf-help-title { font-size: ${FS.title}; }
    .bmf-help-beat { grid-template-columns: 26px 1fr; gap: 11px; }
  }
  `;
  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.appendChild(tag);
}

// --- tiny DOM helper --------------------------------------------------------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

export class HelpModal {
  private modal: ModalHandle | null = null;

  constructor() {
    injectStyles();
  }

  get isOpen(): boolean {
    return this.modal !== null;
  }

  open(): void {
    if (this.modal) return;
    const m = openModal({ width: '460px', dismissable: true });
    this.modal = m;

    // Head: swap the kit's (empty) title for our kicker + title; the kit's close ✕ stays on the right.
    const head = m.card.firstElementChild as HTMLElement;
    head.querySelector('h2')?.remove();
    head.insertBefore(
      h('div', { className: 'bmf-help-head' }, [
        h('p', { className: 'bmf-help-kicker', textContent: 'Field manual' }),
        h('h2', { className: 'bmf-help-title', textContent: 'How to play' }),
      ]),
      head.firstChild,
    );

    m.body.append(this.loopSection(), this.controlsSection());

    // Footer: one primary "Let's fly", then a quiet "Replay first flight" link.
    const fly = makeButton({ label: 'Let’s fly', variant: 'primary', register: 'cockpit', block: true, onClick: () => this.close() });
    const replay = makeButton({
      label: 'Replay first flight',
      variant: 'ghost',
      register: 'cockpit',
      size: 'sm',
      block: true,
      onClick: () => {
        // Re-fly the guided first shift: clear the coach "done" flag and force the onboarding arc on
        // (`?onboard=1`) via a plain navigation (works in prod, not just the dev in-place switch).
        resetTutorial();
        const url = new URL(window.location.href);
        url.searchParams.delete('m');
        url.searchParams.delete('daily');
        url.searchParams.delete('ffa');
        url.searchParams.set('province', '1');
        url.searchParams.set('onboard', '1');
        url.searchParams.delete('autostart');
        url.searchParams.delete('qa');
        window.location.assign(url.toString());
      },
    });
    Object.assign(m.footer.style, { flexDirection: 'column', alignItems: 'stretch', gap: '8px', justifyContent: 'flex-start' });
    m.footer.append(fly.el, replay.el);

    m.onClose(() => {
      this.modal = null;
    });
  }

  close(): void {
    this.modal?.close(); // the onClose handler nulls modal
  }

  toggle(): void {
    if (this.modal) this.close();
    else this.open();
  }

  /** Teardown for an in-place mission switch: close (which removes the kit scrim). Idempotent. */
  dispose(): void {
    this.close();
  }

  // --- sections -------------------------------------------------------------

  /** THE LOOP — the whole game in four numbered beats. */
  private loopSection(): DocumentFragment {
    const frag = document.createDocumentFragment();
    frag.append(h('p', { className: 'bmf-help-sec', textContent: 'The loop' }));
    const loop = h('div', { className: 'bmf-help-loop' });
    LOOP.forEach((b, i) => {
      loop.append(
        h('div', { className: 'bmf-help-beat' }, [
          h('div', { className: 'bmf-help-n', textContent: String(i + 1) }),
          h('div', {}, [
            h('p', { className: 'bmf-help-bt', textContent: b.title }),
            h('p', { className: 'bmf-help-bb', textContent: b.body }),
          ]),
        ]),
      );
    });
    frag.append(loop);
    return frag;
  }

  /** CONTROLS — keyboard + touch reference. */
  private controlsSection(): DocumentFragment {
    const frag = document.createDocumentFragment();
    frag.append(h('p', { className: 'bmf-help-sec is-controls', textContent: 'Controls' }));
    for (const c of CONTROLS) {
      const keys = h('div', { className: 'bmf-help-keys' });
      for (const k of c.keys) keys.append(h('span', { className: 'bmf-help-key', textContent: k }));
      if (c.keys.length) keys.append(h('span', { className: 'bmf-help-sep', textContent: '·' }));
      keys.append(h('span', { className: 'bmf-help-touch', textContent: c.touch }));
      frag.append(
        h('div', { className: 'bmf-help-row' }, [h('span', { className: 'bmf-help-act', textContent: c.action }), keys]),
      );
    }
    return frag;
  }
}
