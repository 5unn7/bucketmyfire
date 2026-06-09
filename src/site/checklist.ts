/**
 * The interactive "15 minutes to ready" wildfire-readiness checklist (the Prepare page's centrepiece).
 *
 * Honest-window position: this is general preparedness, not an emergency tool. Every item is a quick,
 * concrete action from our own Field Notes research. The card is COLLAPSIBLE (the header row is the
 * toggle, with a chevron, mirroring the home's daily card) and its open/closed state plus which items
 * are checked both persist per-device in localStorage. Pure DOM + a progress ring; reuses the shared
 * shell styles (`.fd-item`, `.fd-ring`, `.fd-box`) and the in-game `.chev`.
 */
import { ic } from '../three/ui/home/icons';

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

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(COLLAPSE_KEY, '1');
    else localStorage.removeItem(COLLAPSE_KEY);
  } catch {
    /* storage blocked — the toggle still works for the session */
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Build the checklist (collapsible header ring + items) into `host`, restoring saved progress + the
 *  open/closed state. The header row is a toggle button; the progress ring stays visible when closed. */
export function mountChecklist(host: HTMLElement): void {
  const done = loadDone();
  let collapsed = loadCollapsed();
  host.classList.add('fd-check');
  host.classList.toggle('collapsed', collapsed);

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'fd-check-head';
  head.setAttribute('aria-expanded', String(!collapsed));
  head.setAttribute('aria-controls', 'fd-check-body');
  head.innerHTML =
    `<div class="fd-ring" id="fd-ring"><b id="fd-ring-n">0%</b></div>` +
    `<div class="fd-check-cap"><h2>15 minutes to ready</h2>` +
    `<p>Six quick actions that lower your wildfire risk.</p></div>` +
    `<span class="chev" aria-hidden="true">${ic('chevron-down')}</span>`;

  const body = document.createElement('div');
  body.className = 'fd-check-body';
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

  host.append(head, body);

  head.addEventListener('click', () => {
    collapsed = host.classList.toggle('collapsed');
    head.setAttribute('aria-expanded', String(!collapsed));
    saveCollapsed(collapsed);
  });

  const ring = head.querySelector<HTMLElement>('#fd-ring');
  const ringN = head.querySelector<HTMLElement>('#fd-ring-n');
  const update = (): void => {
    const pct = Math.round((done.size / ITEMS.length) * 100);
    if (ring) ring.style.setProperty('--p', String(pct));
    if (ringN) ringN.textContent = `${pct}%`;
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
