/**
 * The interactive "Are you fire ready?" wildfire-readiness checklist (the Prepare page's centrepiece).
 *
 * Honest-window position: this is general preparedness, not an emergency tool. Every item is a quick,
 * concrete action from our own Field Notes research. The card is COLLAPSIBLE (the header row is the
 * toggle, with a chevron, mirroring the home's daily card) and its open/closed state plus which items
 * are checked both persist per-device in localStorage. Pure DOM + a progress ring; reuses the shared
 * shell styles (`.fd-item`, `.fd-ring`, `.fd-box`) and the in-game `.chev`.
 */
import { ic } from '../three/ui/home/icons';
import { esc } from './siteNav.mjs';

const STORE_KEY = 'bmf.prepare.v1';
const COLLAPSE_KEY = 'bmf.prepare.collapsed.v1';

interface CheckItem {
  id: string;
  title: string;
  body: string;
}

/** The list. Dry, declarative, em-dash-free. Plain actions, no source links. */
const ITEMS: CheckItem[] = [
  {
    id: 'zone0',
    title: 'Clear 1.5 m around the house',
    body: 'Move firewood, deck furniture, mulch, and anything that burns away from the walls. This is the highest-value 10 minutes you can spend.',
  },
  {
    id: 'roof',
    title: 'Clean the roof and gutters',
    body: 'Dead leaves and conifer needles catch wind-blown embers. Clear them off the roof and out of the gutters.',
  },
  {
    id: 'vents',
    title: 'Screen the vents and gaps',
    body: 'Embers get in through vents and gaps under the deck. Cover openings with fine metal mesh.',
  },
  {
    id: 'alerts',
    title: 'Turn on emergency alerts',
    body: 'Register for your provincial and local alerts so an evacuation order reaches you fast. In Saskatchewan that is SaskAlert.',
  },
  {
    id: 'gobag',
    title: 'Pack a 72-hour go-bag',
    body: 'Water, medications, copies of documents, chargers, cash, and a change of clothes per person. Keep it by the door.',
  },
  {
    id: 'plan',
    title: 'Make a one-page plan',
    body: 'Agree on a meeting place, an out-of-area contact, and two ways out of your neighbourhood. Tell everyone in the house.',
  },
];

const CHECK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>`;

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveDone(done: Set<string>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...done]));
  } catch {
    /* storage blocked — the list still works for the session */
  }
}

/** Collapsed by DEFAULT (auto-collapsed): a first visit shows the compact card with the progress ring,
 *  and only an explicit choice ('0' = the pilot opened it) keeps it open. */
function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) !== '0';
  } catch {
    return true;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch {
    /* storage blocked — the toggle still works for the session */
  }
}

/** Build the checklist into `host` (the TOP `.card warm cut` on Prepare), restoring saved progress + the
 *  open/closed state. The collapsible header REUSES the in-game `.daily` card (`.daily-head`/`.daily-body`/
 *  `.chev`/`.collapsed`); the progress ring stays visible when closed. */
export function mountChecklist(host: HTMLElement): void {
  const done = loadDone();
  let collapsed = loadCollapsed();
  host.classList.add('daily');
  host.classList.toggle('collapsed', collapsed);

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'daily-head';
  head.setAttribute('aria-expanded', String(!collapsed));
  head.setAttribute('aria-controls', 'fd-check-body');
  head.innerHTML =
    `<div class="dhead-id fd-hero-main">` +
    `<p class="fd-hero-eyebrow">Prepare</p>` +
    `<span class="fd-hero-head">Are you fire ready?</span>` +
    `<span class="fd-hero-sub">Get wildfire ready before fire season.</span>` +
    `</div>` +
    `<span class="chev" aria-hidden="true">${ic('chevron-down')}</span>`;

  // The readiness "loading bar" — full-width, always visible (a sibling of the head, so it reads even
  // when the card is collapsed). Fills green toward 100% as items are checked.
  const bar = document.createElement('div');
  bar.className = 'fd-progress';
  bar.innerHTML =
    `<div class="fd-pbar"><span class="fd-pbar-fill"></span></div>` +
    `<b class="fd-pbar-n" id="fd-bar-n" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">0%</b>`;

  const body = document.createElement('div');
  body.className = 'daily-body';
  body.id = 'fd-check-body';
  const list = document.createElement('div');
  list.className = 'fd-check-list';
  list.innerHTML = ITEMS.map(
    (it) =>
      `<div class="fd-item${done.has(it.id) ? ' done' : ''}" data-id="${it.id}" role="checkbox" tabindex="0" aria-checked="${done.has(it.id)}">` +
      `<span class="fd-box">${CHECK_SVG}</span>` +
      `<span class="fd-item-txt"><span class="fd-item-h">${esc(it.title)}</span>` +
      `<span class="fd-item-b">${esc(it.body)}</span></span>` +
      `</div>`,
  ).join('');
  body.appendChild(list);

  host.append(head, bar, body);

  head.addEventListener('click', () => {
    collapsed = host.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
    saveCollapsed(collapsed);
  });

  const barN = bar.querySelector<HTMLElement>('#fd-bar-n');
  const update = (): void => {
    const pct = Math.round((done.size / ITEMS.length) * 100);
    bar.style.setProperty('--p', String(pct));
    if (barN) {
      barN.textContent = `${pct}%`;
      barN.setAttribute('aria-valuenow', String(pct));
    }
  };
  update();

  const toggle = (el: HTMLElement): void => {
    const id = el.getAttribute('data-id');
    if (!id) return;
    if (done.has(id)) done.delete(id);
    else done.add(id);
    el.classList.toggle('done', done.has(id));
    el.setAttribute('aria-checked', String(done.has(id)));
    saveDone(done);
    update();
  };

  list.querySelectorAll<HTMLElement>('.fd-item').forEach((el) => {
    // A tap anywhere on the row toggles it, but the source link still opens (don't toggle then).
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) return;
      toggle(el);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggle(el);
      }
    });
  });
}
