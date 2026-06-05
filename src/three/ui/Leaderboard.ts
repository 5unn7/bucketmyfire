import type { MissionDef } from '../missions/types';
import { loadProfile } from './profile';
import { getProgress, bestScore } from '../missions/progress';
import {
  isConfigured,
  getClientId,
  fetchMissionTop,
  fetchCareerTop,
  fetchMissionStanding,
  fetchCareerStanding,
  type MissionEntry,
  type CareerEntry,
} from '../leaderboard/client';
import { UI, FS, FW, R, div, setBlur } from './theme';

/**
 * Global leaderboard overlay — a full-screen frosted-glass panel in the game's cockpit language
 * (matching the pre-flight menu / HUD.ts). A tab strip switches between the overall CAREER board (sum
 * of each pilot's best-per-mission score) and one board per mission (each pilot's best run there).
 *
 * The redesign over the old flat list:
 *   • a gold/silver/bronze PODIUM for the top three (the board's focal point);
 *   • a STICKY "YOU" card — your rank + percentile, pinned to the scroll, so you see where you
 *     stand even at #147 (the old board just hid you if you weren't in the top 25/50);
 *   • a context bar ("312 pilots · YOU #14 · Top 5%") and a "top N of TOTAL" caption;
 *   • real loading/empty/offline states — a shimmer skeleton, a refresh control, and a local
 *     "this device" record so the panel never reads as dead when the network/Supabase is absent.
 *
 * Pure DOM, zero assets, self-disposing (Close / backdrop tap / Esc). Network is best-effort via
 * leaderboard/client.ts; `openLeaderboard()` owns its own overlay, so callers don't manage lifecycle.
 */

// Visual tokens (UI) + `div`/`setBlur` come from ./theme — the one cockpit palette
// (gold/silver/bronze, cardGlass, rowMine, etc. were folded in there).
const CAREER = '__career__';

/** A board row normalised for rendering — podium, list and the sticky YOU card all consume this. */
interface Ranked {
  rank: number;
  pilot: string;
  value: string; // formatted score / career total
  sub: string; // small second line (time / mission count · "2d ago")
  mine: boolean;
}

/** Open the leaderboard overlay. `initialMissionId` selects that mission's tab on open
 *  (the win banner passes the just-played mission); otherwise it opens on the Career board. */
export function openLeaderboard(catalog: MissionDef[], initialMissionId?: string): void {
  injectStyles();
  new Leaderboard(catalog, initialMissionId);
}

class Leaderboard {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly refreshBtn: HTMLDivElement;
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
      // Near-opaque + backdrop blur so this overlay fully OCCLUDES the mission menu it opens
      // over — the old 0.9/0.96 gradient let the busy card grid bleed through behind an empty board.
      background: 'radial-gradient(120% 90% at 50% 0%, rgba(18,28,40,0.95), rgba(4,7,11,0.985))',
      fontFamily: UI.font,
      color: UI.text,
      padding: '34px 18px 60px',
      boxSizing: 'border-box',
    });
    setBlur(this.root); // blur whatever sits behind so nothing reads through the board
    // Backdrop tap (outside the panel) closes.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);

    const panel = div({ maxWidth: '640px', margin: '0 auto', position: 'relative' });

    // Header: title + refresh + close.
    const head = div({ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' });
    head.appendChild(div({ fontSize: FS.display, fontWeight: FW.heavy, letterSpacing: '0.5px', flex: '1' }, '🏆 Leaderboard'));
    this.refreshBtn = this.iconButton('⟳', 'Refresh', () => this.load());
    head.appendChild(this.refreshBtn);
    head.appendChild(this.iconButton('✕', 'Close', () => this.close()));
    panel.appendChild(head);

    panel.appendChild(
      div({ fontSize: FS.body, color: UI.dim, marginBottom: '14px' }, 'Global standings — the top helicopter pilots.'),
    );

    panel.appendChild(this.tabStrip());

    this.body = div({ marginTop: '14px' });
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

  // --- Tabs ------------------------------------------------------------------

  /** Horizontal, scrollable tab strip: Career first, then every mission in order. */
  private tabStrip(): HTMLDivElement {
    const strip = div({ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' });
    const tabs: { id: string; el: HTMLDivElement }[] = [];

    const make = (id: string, text: string): HTMLDivElement => {
      const t = div(
        {
          flex: 'none',
          fontSize: FS.body,
          fontWeight: FW.bold,
          letterSpacing: '0.5px',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          padding: '8px 14px',
          borderRadius: R.pill,
          border: `1px solid ${UI.stroke}`,
          background: UI.cardGlass,
          transition: 'border-color 0.12s ease, color 0.12s ease',
        },
        text,
      );
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

    strip.appendChild(make(CAREER, '★ CAREER'));
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

  // --- Load + render ---------------------------------------------------------

  /** Fetch + render the active board. A request token guards against out-of-order responses. */
  private async load(): Promise<void> {
    const token = ++this.reqToken;
    if (!isConfigured()) {
      this.renderOffline();
      return;
    }
    this.setRefreshing(true);
    this.body.replaceChildren(this.skeleton());
    try {
      if (this.active === CAREER) {
        const { rows, total } = await fetchCareerTop(50);
        if (token !== this.reqToken) return;
        const ranked = rows.map((r, i) => this.fromCareer(r, i + 1));
        let standing = ranked.find((r) => r.mine) ?? null;
        if (!standing && this.myName) {
          const s = await fetchCareerStanding(this.myName);
          if (token !== this.reqToken) return;
          if (s) standing = this.fromCareer(s.entry, s.rank);
        }
        this.renderBoard(ranked, total || ranked.length, standing);
      } else {
        const { rows, total } = await fetchMissionTop(this.active, 25);
        if (token !== this.reqToken) return;
        const ranked = rows.map((r, i) => this.fromMission(r, i + 1));
        let standing = ranked.find((r) => r.mine) ?? null;
        if (!standing) {
          const s = await fetchMissionStanding(this.active);
          if (token !== this.reqToken) return;
          if (s) standing = this.fromMission(s.entry, s.rank);
        }
        this.renderBoard(ranked, total || ranked.length, standing);
      }
    } finally {
      if (token === this.reqToken) this.setRefreshing(false);
    }
  }

  private fromMission(r: MissionEntry, rank: number): Ranked {
    const mine = r.client_id === this.myClient || (!!this.myName && r.pilot.toLowerCase() === this.myName.toLowerCase());
    const sub = [r.time_s != null ? fmtTime(r.time_s) : '', fmtAgo(r.created_at)].filter(Boolean).join('   ·   ');
    return { rank, pilot: r.pilot, value: r.score.toLocaleString(), sub, mine };
  }

  private fromCareer(r: CareerEntry, rank: number): Ranked {
    const mine = !!this.myName && r.pilot.toLowerCase() === this.myName.toLowerCase();
    const sub = [`${r.missions} ${r.missions === 1 ? 'mission' : 'missions'}`, fmtAgo(r.last_seen)].filter(Boolean).join('   ·   ');
    return { rank, pilot: r.pilot, value: r.total.toLocaleString(), sub, mine };
  }

  private renderBoard(ranked: Ranked[], total: number, standing: Ranked | null): void {
    if (ranked.length === 0) {
      const empty = div({});
      empty.appendChild(
        this.note(
          this.active === CAREER
            ? 'No runs yet — fly a mission and be the first on the board.'
            : 'No runs on this mission yet — set the pace.',
        ),
      );
      const local = this.localPanel();
      if (local) empty.appendChild(local);
      this.body.replaceChildren(empty);
      return;
    }

    const frag = div({});
    frag.appendChild(this.contextBar(total, standing));
    frag.appendChild(this.podium(ranked.slice(0, 3)));

    const rest = ranked.slice(3);
    if (rest.length) {
      const list = div({});
      rest.forEach((r, i) => list.appendChild(this.row(r, i)));
      frag.appendChild(list);
    }
    frag.appendChild(this.caption(ranked.length, total));

    // Pin "YOU" only when you're below the podium — top-3 are already front and centre.
    if (standing && standing.rank > 3) frag.appendChild(this.youCard(standing, total));

    this.body.replaceChildren(frag);
  }

  // --- Context bar + podium --------------------------------------------------

  private contextBar(total: number, standing: Ranked | null): HTMLDivElement {
    const bar = div({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      margin: '2px 2px 12px',
      flexWrap: 'wrap',
    });
    bar.appendChild(
      div(
        { fontSize: FS.meta, fontWeight: FW.bold, letterSpacing: '1.6px', color: UI.faint },
        `${total.toLocaleString()} ${total === 1 ? 'PILOT' : 'PILOTS'} COMPETING`,
      ),
    );
    if (standing) {
      const chip = div({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        padding: '5px 11px',
        borderRadius: R.pill,
        background: UI.rowMine,
        border: `1px solid ${UI.accent}66`,
        fontSize: FS.meta,
        fontWeight: FW.heavy,
        letterSpacing: '0.4px',
        color: UI.accent,
      });
      chip.textContent = `YOU · #${standing.rank.toLocaleString()} · ${pctText(standing.rank, total)}`;
      bar.appendChild(chip);
    }
    return bar;
  }

  /** Gold/silver/bronze top-three. 1st is centred and elevated on a taller pedestal. */
  private podium(top: Ranked[]): HTMLDivElement {
    const wrap = div({ display: 'flex', gap: '10px', alignItems: 'flex-end', justifyContent: 'center', margin: '4px 0 16px' });
    const order = top.length >= 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
    for (const r of order) wrap.appendChild(this.podiumCell(r));
    return wrap;
  }

  private podiumCell(r: Ranked): HTMLDivElement {
    const color = medalColor(r.rank);
    const first = r.rank === 1;
    const ped = first ? 70 : r.rank === 2 ? 50 : 38;

    const cell = div({ flex: '1 1 0', minWidth: '0', maxWidth: '184px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' });
    cell.className = 'bmf-lb-row';

    cell.appendChild(div({ fontSize: first ? '26px' : '22px', lineHeight: '1' }, ['🥇', '🥈', '🥉'][r.rank - 1] ?? `#${r.rank}`));

    const av = div({
      width: first ? '58px' : '48px',
      height: first ? '58px' : '48px',
      borderRadius: R.round,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: first ? '21px' : '17px',
      fontWeight: FW.heavy,
      color: '#05202a',
      background: `linear-gradient(160deg, ${color}, ${color}99)`,
      border: `2px solid ${color}`,
      boxShadow: `0 0 18px ${color}55`,
    });
    if (r.mine) av.style.outline = `2px solid ${UI.accent}`;
    av.textContent = initials(r.pilot);
    cell.appendChild(av);

    const nameRow = div({ display: 'flex', alignItems: 'center', gap: '6px', maxWidth: '100%' });
    nameRow.appendChild(
      div(
        { fontSize: first ? FS.md : FS.body, fontWeight: FW.bold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' },
        r.pilot,
      ),
    );
    if (r.mine) nameRow.appendChild(youPill());
    cell.appendChild(nameRow);

    cell.appendChild(div({ fontSize: first ? FS.title : FS.lg, fontWeight: FW.heavy, color: r.mine ? UI.accent : UI.text }, r.value));

    const pedestal = div({
      marginTop: '4px',
      width: '100%',
      height: `${ped}px`,
      borderRadius: `${R.md} ${R.md} 0 0`,
      background: `linear-gradient(180deg, ${color}33, ${color}0d)`,
      border: `1px solid ${color}55`,
      borderBottom: 'none',
      display: 'flex',
      justifyContent: 'center',
      paddingTop: '7px',
      boxSizing: 'border-box',
      fontSize: FS.title,
      fontWeight: FW.black,
      color,
    });
    pedestal.textContent = `${r.rank}`;
    cell.appendChild(pedestal);
    return cell;
  }

  // --- List rows + sticky YOU + caption --------------------------------------

  private row(r: Ranked, i: number): HTMLDivElement {
    const el = div({
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 13px',
      marginBottom: '6px',
      borderRadius: R.md,
      background: r.mine ? UI.rowMine : UI.cardSoft,
      border: `1px solid ${r.mine ? UI.accent + '88' : UI.hair}`,
    });
    el.className = 'bmf-lb-row';
    el.style.animationDelay = `${Math.min(i * 26, 260)}ms`;
    setBlur(el);

    el.appendChild(div({ flex: 'none', width: '26px', textAlign: 'center', fontSize: FS.md, fontWeight: FW.bold, color: UI.dim }, `${r.rank}`));
    el.appendChild(avatarDot(r.pilot, r.mine));

    const who = div({ flex: '1', minWidth: '0' });
    const nameRow = div({ display: 'flex', alignItems: 'center', gap: '8px' });
    nameRow.appendChild(
      div({ fontSize: FS.lg, fontWeight: FW.bold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, r.pilot),
    );
    if (r.mine) nameRow.appendChild(youPill());
    who.appendChild(nameRow);
    if (r.sub) who.appendChild(div({ fontSize: FS.meta, color: UI.dim, marginTop: '2px' }, r.sub));
    el.appendChild(who);

    el.appendChild(div({ flex: 'none', fontSize: FS.xl, fontWeight: FW.heavy, color: r.mine ? UI.accent : UI.text }, r.value));
    return el;
  }

  /** Your own row, pinned to the bottom of the scroll so you always see where you stand. */
  private youCard(s: Ranked, total: number): HTMLDivElement {
    const card = div({
      position: 'sticky',
      bottom: '8px',
      marginTop: '14px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 14px',
      borderRadius: R.lg,
      background: 'rgba(8,14,20,0.88)',
      border: `1px solid ${UI.accent}88`,
      boxShadow: `0 0 0 1px ${UI.accent}33, 0 -6px 26px rgba(0,0,0,0.5)`,
    });
    setBlur(card);

    card.appendChild(
      div({ flex: 'none', minWidth: '34px', textAlign: 'center', fontSize: FS.lg, fontWeight: FW.heavy, color: UI.accent }, `#${s.rank.toLocaleString()}`),
    );
    card.appendChild(avatarDot(s.pilot, true));

    const who = div({ flex: '1', minWidth: '0' });
    const nameRow = div({ display: 'flex', alignItems: 'center', gap: '8px' });
    nameRow.appendChild(
      div({ fontSize: FS.lg, fontWeight: FW.bold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, s.pilot),
    );
    nameRow.appendChild(youPill());
    who.appendChild(nameRow);
    who.appendChild(div({ fontSize: FS.meta, color: UI.dim, marginTop: '2px' }, `${pctText(s.rank, total)} of ${total.toLocaleString()} pilots`));
    card.appendChild(who);

    card.appendChild(div({ flex: 'none', fontSize: FS.xl, fontWeight: FW.heavy, color: UI.accent }, s.value));
    return card;
  }

  private caption(shown: number, total: number): HTMLDivElement {
    const text = total > shown ? `Showing top ${shown} of ${total.toLocaleString()} pilots` : `${total.toLocaleString()} ${total === 1 ? 'pilot' : 'pilots'} ranked`;
    return div({ fontSize: FS.meta, color: UI.faint, textAlign: 'center', marginTop: '12px', letterSpacing: '0.4px' }, text);
  }

  // --- Empty / offline / loading states --------------------------------------

  private renderOffline(): void {
    const wrap = div({});
    wrap.appendChild(
      this.note(
        'The global leaderboard is offline. Your scores are still saved on this device — ' +
          'set up the (free) Supabase backend to compete worldwide.',
      ),
    );
    const local = this.localPanel();
    if (local) wrap.appendChild(local);
    this.body.replaceChildren(wrap);
  }

  /**
   * "This device" record — shown in the offline/empty states so the panel still has something to
   * say. Reads the local progress store: career totals on the Career tab, this mission's best
   * otherwise. Returns null when there's nothing recorded yet (a fresh pilot sees just the note).
   */
  private localPanel(): HTMLDivElement | null {
    const prog = getProgress();
    const tiles: { label: string; value: string }[] = [];

    if (this.active === CAREER) {
      const cleared = prog.completed.length;
      if (cleared === 0) return null;
      const careerScore = Object.values(prog.best).reduce((a, b) => a + b, 0);
      const topMission = Object.values(prog.best).reduce((m, b) => Math.max(m, b), 0);
      tiles.push(
        { label: 'Missions', value: `${cleared}/${this.catalog.length}` },
        { label: 'Career score', value: careerScore.toLocaleString() },
        { label: 'Best mission', value: topMission.toLocaleString() },
      );
    } else {
      const b = bestScore(this.active);
      if (b == null) return null;
      const name = this.catalog.find((m) => m.id === this.active)?.name ?? 'this mission';
      tiles.push({ label: name, value: b.toLocaleString() });
    }

    const panel = div({
      maxWidth: '440px',
      margin: '0 auto',
      background: UI.cardGlass,
      border: `1px solid ${UI.stroke}`,
      borderRadius: R.md,
      padding: '14px 16px',
    });
    setBlur(panel);
    panel.appendChild(div({ fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '2px', color: UI.faint, marginBottom: '11px' }, 'YOUR DEVICE'));
    const row = div({ display: 'flex', gap: '26px', flexWrap: 'wrap' });
    for (const t of tiles) {
      const tile = div({});
      tile.appendChild(div({ fontSize: FS.title, fontWeight: FW.heavy, color: UI.text, lineHeight: '1.1' }, t.value));
      tile.appendChild(div({ fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '1.2px', color: UI.faint, marginTop: '3px' }, t.label.toUpperCase()));
      row.appendChild(tile);
    }
    panel.appendChild(row);
    return panel;
  }

  /** Shimmer placeholder while a board loads — a podium silhouette + a few rows. */
  private skeleton(): HTMLDivElement {
    const wrap = div({});
    const pod = div({ display: 'flex', gap: '10px', alignItems: 'flex-end', justifyContent: 'center', margin: '4px 0 16px' });
    for (const h of [50, 70, 38]) {
      const cell = div({ flex: '1 1 0', maxWidth: '160px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' });
      const dot = skel({ width: '50px', height: '50px', borderRadius: R.round });
      const bar = skel({ width: '62%', height: '12px' });
      const ped = skel({ width: '100%', height: `${h}px`, borderRadius: `${R.md} ${R.md} 0 0` });
      cell.append(dot, bar, ped);
      pod.appendChild(cell);
    }
    wrap.appendChild(pod);
    for (let i = 0; i < 5; i++) wrap.appendChild(skel({ height: '44px', marginBottom: '6px', borderRadius: R.md }));
    return wrap;
  }

  private note(text: string): HTMLDivElement {
    return div({ fontSize: FS.md, color: UI.dim, lineHeight: '1.55', textAlign: 'center', padding: '26px 16px 22px' }, text);
  }

  // --- Header buttons --------------------------------------------------------

  private iconButton(glyph: string, title: string, onClick: () => void): HTMLDivElement {
    const b = div({
      flex: 'none',
      width: '36px',
      height: '36px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: FS.lg,
      fontWeight: FW.bold,
      color: UI.dim,
      cursor: 'pointer',
      borderRadius: R.round,
      border: `1px solid ${UI.stroke}`,
      background: UI.cardGlass,
      transition: 'color 0.12s ease, border-color 0.12s ease',
    });
    b.title = title;
    b.textContent = glyph;
    setBlur(b);
    b.addEventListener('pointerenter', () => {
      b.style.color = UI.text;
      b.style.borderColor = `${UI.accent}66`;
    });
    b.addEventListener('pointerleave', () => {
      b.style.color = UI.dim;
      b.style.borderColor = UI.stroke;
    });
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private setRefreshing(on: boolean): void {
    this.refreshBtn.classList.toggle('bmf-lb-spin', on);
  }
}

// --- helpers ----------------------------------------------------------------

// `div` and `setBlur` are imported from ./theme (shared DOM helpers).

function skel(style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = div(style);
  node.className = 'bmf-lb-skel';
  return node;
}

/** A compact circular initials avatar for a list row (accent-ringed when it's you). */
function avatarDot(pilot: string, mine: boolean): HTMLDivElement {
  const a = div({
    flex: 'none',
    width: '30px',
    height: '30px',
    borderRadius: R.round,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: FS.sm,
    fontWeight: FW.heavy,
    color: mine ? '#05202a' : UI.text,
    background: mine ? UI.accent : UI.track,
    border: `1px solid ${mine ? UI.accent : UI.stroke}`,
  });
  a.textContent = initials(pilot);
  return a;
}

function youPill(): HTMLDivElement {
  return div(
    {
      flex: 'none',
      fontSize: FS.tag,
      fontWeight: FW.heavy,
      letterSpacing: '0.1em',
      color: '#04222a',
      background: UI.accent,
      borderRadius: R.pill,
      padding: '2px 7px',
    },
    'YOU',
  );
}

function medalColor(rank: number): string {
  return rank === 1 ? UI.gold : rank === 2 ? UI.silver : rank === 3 ? UI.bronze : UI.dim;
}

/** Up to two initials from a callsign ("Sunny" → "SU", "Red Baron" → "RB"). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "Top 5%" once there's a meaningful field; "of N" for tiny boards where a percentile is silly. */
function pctText(rank: number, total: number): string {
  if (total < 10) return `#${rank} of ${total}`;
  const pct = Math.max(1, Math.min(100, Math.round((rank / total) * 100)));
  return `Top ${pct}%`;
}

/** Seconds → "⏱ m:ss" for a mission-board sub-label. */
function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `⏱ ${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/** ISO timestamp → a coarse "2d ago" recency tag. Empty string if unparseable. */
function fmtAgo(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  const w = d / 7;
  if (w < 5) return `${Math.floor(w)}w ago`;
  const mo = d / 30;
  if (mo < 12) return `${Math.floor(mo)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// One-time scoped keyframes (shimmer skeleton, refresh spin, staggered row reveal).
let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const tag = document.createElement('style');
  tag.textContent = `
  @keyframes bmf-lb-shimmer { 0% { background-position: -240px 0 } 100% { background-position: 240px 0 } }
  @keyframes bmf-lb-spin { to { transform: rotate(360deg) } }
  @keyframes bmf-lb-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
  .bmf-lb-skel { background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.13) 37%, rgba(255,255,255,0.05) 63%); background-size: 480px 100%; animation: bmf-lb-shimmer 1.2s infinite linear; border-radius: 8px; }
  .bmf-lb-spin { animation: bmf-lb-spin 0.7s linear infinite; }
  .bmf-lb-row { animation: bmf-lb-in 0.28s ease both; }
  `;
  document.head.appendChild(tag);
}
