import type { MissionDef } from '../missions/types';
import { loadProfile } from './profile';
import {
  isConfigured,
  getClientId,
  fetchMissionTop,
  fetchCareerTop,
  type MissionEntry,
  type CareerEntry,
} from '../leaderboard/client';

/**
 * Global leaderboard overlay — a full-screen frosted-glass panel in the game's cockpit
 * language (matching MissionSelect.ts / HUD.ts). A tab strip switches between the overall
 * CAREER board (sum of each pilot's best-per-mission score) and one board per mission
 * (each pilot's best run on that map). Your own rows are highlighted.
 *
 * Pure DOM, zero assets, self-disposing (a Close button / backdrop tap / Esc tears it down).
 * Network is best-effort via leaderboard/client.ts — when Supabase isn't configured the panel
 * shows a friendly "offline" message instead of a board, and the rest of the game is unchanged.
 *
 * `openLeaderboard()` is called from the mission-select header and the win banner; it owns its
 * own overlay element, so callers don't manage lifecycle.
 */

const UI = {
  accent: '#67e8ff',
  gold: '#ffd66b',
  warm: '#ff7a45',
  text: 'rgba(234,246,255,0.96)',
  dim: 'rgba(255,255,255,0.5)',
  cardGlass: 'rgba(16,24,32,0.62)',
  rowMine: 'rgba(103,232,255,0.14)',
  stroke: 'rgba(255,255,255,0.14)',
  blur: 'blur(14px) saturate(120%)',
  shadow: '0 8px 30px rgba(0,0,0,0.45)',
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

const CAREER = '__career__';

/** Open the leaderboard overlay. `initialMissionId` selects that mission's tab on open
 *  (the win banner passes the just-played mission); otherwise it opens on the Career board. */
export function openLeaderboard(catalog: MissionDef[], initialMissionId?: string): void {
  new Leaderboard(catalog, initialMissionId);
}

class Leaderboard {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly catalog: MissionDef[];
  private readonly myName: string;
  private readonly myClient: string;
  private active: string; // CAREER or a mission id
  private reqToken = 0; // guards against a slow fetch overwriting a newer tab

  constructor(catalog: MissionDef[], initialMissionId?: string) {
    this.catalog = catalog;
    this.myName = (loadProfile()?.name ?? '').trim();
    this.myClient = getClientId();
    this.active = initialMissionId && catalog.some((m) => m.id === initialMissionId) ? initialMissionId : CAREER;

    this.root = div({
      position: 'fixed',
      inset: '0',
      zIndex: '60',
      overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 0%, rgba(20,32,44,0.9), rgba(4,7,11,0.96))',
      fontFamily: UI.font,
      color: UI.text,
      padding: '34px 18px 60px',
      boxSizing: 'border-box',
    });
    // Backdrop tap (outside the panel) closes.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);

    const panel = div({ maxWidth: '640px', margin: '0 auto' });

    // Header: title + close.
    const head = div({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' });
    head.appendChild(div({ fontSize: '24px', fontWeight: '800', letterSpacing: '0.5px' }, '🏆 Leaderboard'));
    const close = div(
      {
        fontSize: '13px',
        fontWeight: '700',
        letterSpacing: '1px',
        color: UI.dim,
        cursor: 'pointer',
        padding: '8px 12px',
        borderRadius: '99px',
        border: `1px solid ${UI.stroke}`,
      },
      '✕ CLOSE',
    );
    close.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.close();
    });
    head.appendChild(close);
    panel.appendChild(head);

    panel.appendChild(
      div({ fontSize: '13px', color: UI.dim, marginBottom: '16px' }, 'Global standings — top water bombers of the boreal.'),
    );

    panel.appendChild(this.tabStrip());

    this.body = div({ marginTop: '16px' });
    panel.appendChild(this.body);

    this.root.appendChild(panel);
    document.body.appendChild(this.root);

    this.load();
  }

  private close(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.close();
  }

  /** Horizontal, scrollable tab strip: Career first, then every mission in order. */
  private tabStrip(): HTMLDivElement {
    const strip = div({
      display: 'flex',
      gap: '8px',
      overflowX: 'auto',
      paddingBottom: '4px',
      scrollbarWidth: 'none',
    });
    const tabs: { id: string; el: HTMLDivElement }[] = [];

    const make = (id: string, text: string): HTMLDivElement => {
      const t = div({
        flex: 'none',
        fontSize: '13px',
        fontWeight: '700',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        padding: '8px 14px',
        borderRadius: '99px',
        border: `1px solid ${UI.stroke}`,
        background: UI.cardGlass,
        transition: 'border-color 0.12s ease, color 0.12s ease',
      }, text);
      setBlur(t);
      t.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (this.active === id) return;
        this.active = id;
        for (const tab of tabs) this.styleTab(tab.el, tab.id === id);
        this.load();
      });
      tabs.push({ id, el: t });
      return t;
    };

    strip.appendChild(make(CAREER, 'CAREER'));
    for (const m of this.catalog) strip.appendChild(make(m.id, m.name));
    for (const tab of tabs) this.styleTab(tab.el, tab.id === this.active);
    // Scroll the active tab into view (helps when opening straight to a late mission).
    queueMicrotask(() => tabs.find((t) => t.id === this.active)?.el.scrollIntoView({ inline: 'center', block: 'nearest' }));
    return strip;
  }

  private styleTab(el: HTMLDivElement, on: boolean): void {
    el.style.borderColor = on ? UI.accent : UI.stroke;
    el.style.color = on ? UI.accent : UI.text;
    el.style.boxShadow = on ? `0 0 0 1px ${UI.accent}55` : 'none';
  }

  /** Fetch + render the active board. A request token guards against out-of-order responses. */
  private async load(): Promise<void> {
    const token = ++this.reqToken;
    if (!isConfigured()) {
      this.renderOffline();
      return;
    }
    this.body.replaceChildren(this.note('Loading…'));

    if (this.active === CAREER) {
      const rows = await fetchCareerTop(50);
      if (token !== this.reqToken) return;
      this.renderCareer(rows);
    } else {
      const rows = await fetchMissionTop(this.active, 25);
      if (token !== this.reqToken) return;
      this.renderMission(rows);
    }
  }

  private renderOffline(): void {
    this.body.replaceChildren(
      this.note(
        'The global leaderboard is offline. Your scores are still saved on this device — ' +
          'set up the (free) Supabase backend to compete worldwide.',
      ),
    );
  }

  private renderCareer(rows: CareerEntry[]): void {
    if (rows.length === 0) {
      this.body.replaceChildren(this.note('No runs yet — fly a mission and be the first on the board.'));
      return;
    }
    const list = div({});
    rows.forEach((r, i) => {
      const mine = !!this.myName && r.pilot.toLowerCase() === this.myName.toLowerCase();
      list.appendChild(
        this.row(i + 1, r.pilot, r.total.toLocaleString(), `${r.missions} ${r.missions === 1 ? 'mission' : 'missions'}`, mine),
      );
    });
    this.body.replaceChildren(list);
  }

  private renderMission(rows: MissionEntry[]): void {
    if (rows.length === 0) {
      this.body.replaceChildren(this.note('No runs on this mission yet — set the pace.'));
      return;
    }
    const list = div({});
    rows.forEach((r, i) => {
      const mine = r.client_id === this.myClient || (!!this.myName && r.pilot.toLowerCase() === this.myName.toLowerCase());
      const sub = r.time_s != null ? fmtTime(r.time_s) : '';
      list.appendChild(this.row(i + 1, r.pilot, r.score.toLocaleString(), sub, mine));
    });
    this.body.replaceChildren(list);
  }

  /** A single ranked row: medal/number · pilot (+ "you") · sub-label · score. */
  private row(rank: number, pilot: string, value: string, sub: string, mine: boolean): HTMLDivElement {
    const r = div({
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '11px 14px',
      marginBottom: '6px',
      borderRadius: '12px',
      background: mine ? UI.rowMine : UI.cardGlass,
      border: `1px solid ${mine ? UI.accent + '88' : UI.stroke}`,
    });
    setBlur(r);

    const medal = ['🥇', '🥈', '🥉'][rank - 1];
    const rankBox = div(
      {
        flex: 'none',
        width: '30px',
        textAlign: 'center',
        fontSize: medal ? '18px' : '14px',
        fontWeight: '700',
        color: rank <= 3 ? UI.gold : UI.dim,
      },
      medal ?? `${rank}`,
    );
    r.appendChild(rankBox);

    const who = div({ flex: '1', minWidth: '0' });
    const nameRow = div({ display: 'flex', alignItems: 'center', gap: '8px' });
    nameRow.appendChild(
      div(
        { fontSize: '15px', fontWeight: '700', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        pilot,
      ),
    );
    if (mine) {
      nameRow.appendChild(
        div(
          {
            flex: 'none',
            fontSize: '9px',
            fontWeight: '800',
            letterSpacing: '0.1em',
            color: '#04222a',
            background: UI.accent,
            borderRadius: '99px',
            padding: '2px 7px',
          },
          'YOU',
        ),
      );
    }
    who.appendChild(nameRow);
    if (sub) who.appendChild(div({ fontSize: '11px', color: UI.dim, marginTop: '2px' }, sub));
    r.appendChild(who);

    r.appendChild(div({ flex: 'none', fontSize: '17px', fontWeight: '800', color: mine ? UI.accent : UI.text }, value));
    return r;
  }

  private note(text: string): HTMLDivElement {
    return div(
      { fontSize: '14px', color: UI.dim, lineHeight: '1.55', textAlign: 'center', padding: '30px 16px' },
      text,
    );
  }
}

// --- helpers (mirrors MissionSelect.ts) -------------------------------------

function div(style: Partial<CSSStyleDeclaration>, text?: string): HTMLDivElement {
  const node = document.createElement('div');
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function setBlur(node: HTMLElement): void {
  node.style.backdropFilter = UI.blur;
  node.style.setProperty('-webkit-backdrop-filter', UI.blur);
}

/** Seconds → m:ss, prefixed for a board sub-label. */
function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `⏱ ${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
