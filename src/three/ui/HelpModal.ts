/**
 * Help modal — the "?" button's panel. Deliberately SIMPLE: one screen, no swipe,
 * no icons, no diagrams. Just two things, with strong typographic hierarchy:
 *
 *   THE LOOP  — the whole game in four beats: fill the bucket → drop on fire →
 *               get points → unlock helis. Big ghosted numerals carry the order.
 *   CONTROLS  — a compact action ⇢ keys · touch reference (keyboard + on-screen).
 *
 * Built on the component kit: the scrim, card, close ✕, ESC / scrim-click close and
 * focus-trap all come from `openModal()`. There are NO footer buttons — the close ✕ is
 * the only action. This module owns only the CONTENT + a small token-driven layout
 * stylesheet (no hard-coded colour/blur — the `verify:ui` ratchet enforces it).
 *
 * Lifecycle: `Input` builds ONE controller and wires the "?" icon to `toggle()`. The
 * modal is created on `open()` (via `openModal`, which mounts its own scrim) and
 * destroyed on `close()`. The first-run TEACHER is the interactive coach, not this reference.
 */

import { UI, HOME, FS, FW, R } from './theme';
import { openModal, type ModalHandle } from './components/Modal';

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
  { title: 'Drop on the fire', body: 'Line up over the flames and hit DROP. Fly level so the water lands true.' },
  { title: 'Hold the towns', body: 'Dispatch calls every fire as it breaks out. Put it out before it reaches the cabins. The fires keep coming.' },
  { title: 'Bank points', body: 'Every fire you put out banks points. Spend them on faster aircraft.' },
];

/** A one-line "good to know" note — surfaced under the controls, amber like the in-game caution. */
const NOTES: string[] = [
  'Lose your bucket? Set down at any base to rig a fresh one. You can release it yourself with B / RELEASE.',
];

/** A control row: an action and the keyboard + touch ways to do it. */
interface Ctrl {
  action: string;
  keys: string[]; // keyboard cap labels (empty → touch-only)
  touch: string; // on-screen control name
}
const CONTROLS: Ctrl[] = [
  { action: 'Turn the nose', keys: ['A', 'D'], touch: 'Left stick' },
  { action: 'Speed (fwd / back)', keys: ['W', 'S'], touch: 'Left stick' },
  { action: 'Altitude', keys: ['I', 'J'], touch: '▲ / ▼' },
  { action: 'Drop water', keys: ['Space'], touch: 'DROP' },
  { action: 'Release bucket', keys: ['B'], touch: 'RELEASE' },
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

  /* Good-to-know note — amber, matching the in-flight caution annunciator */
  .bmf-help-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 18px; padding: 10px 12px;
    border-radius: ${R.md}; background: ${HOME.caution12}; border: 1px solid ${HOME.caution50}; border-left: 2px solid ${UI.caution}; }
  .bmf-help-note .ic { flex: 0 0 auto; color: ${UI.caution}; font-size: ${FS.body}; line-height: 1.3; }
  .bmf-help-note .tx { font-size: ${FS.sm}; line-height: 1.45; color: ${UI.textCool}; margin: 0; }

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

    m.body.append(this.loopSection(), this.controlsSection(), this.notesSection());

    // No footer buttons — the close ✕ is enough. Collapse the (now empty) footer so it adds no padding.
    m.footer.style.display = 'none';

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

  /** NOTES — short amber "good to know" lines (matches the in-flight caution annunciator). */
  private notesSection(): DocumentFragment {
    const frag = document.createDocumentFragment();
    for (const n of NOTES) {
      frag.append(
        h('div', { className: 'bmf-help-note' }, [
          h('span', { className: 'ic', textContent: '⚠' }),
          h('p', { className: 'tx', textContent: n }),
        ]),
      );
    }
    return frag;
  }
}
