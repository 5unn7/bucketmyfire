import type { MissionDef } from '../missions/types';
import { loadProfile } from './profile';
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
import { dailyDateLabel } from '../missions/daily';
import { provinceSessionId, isProvinceId } from '../province/buildProvince';
import { regionDisplayName } from '../province/strings';
import { rankFor, careerScore, nextRankProgress, type RankTier } from '../missions/rank';
import { bestShift } from '../province/career';
import { UI, BOARD, FS, FW, R, div, setBlur } from './theme';
import { makeTabs, makeIconButton } from './components';

/**
 * Global leaderboard overlay — an **F1 broadcast timing-tower** rendered in the game's WARM "fight"
 * register (ember/gold on near-black, per DESIGN.md → Two registers: brand surfaces run warm, only the
 * in-flight cockpit stays cyan). Rebuilt for the open-world game (the campaign retired): you fly SHIFTS
 * over the province, bank REPUTATION, and climb a five-tier RANK ladder. A two-way switch picks between
 *   • TODAY — the live shared province shift (everyone on today's date-stamped seed), ranked by score
 *     then time, the per-day race; and
 *   • ALL-TIME — every pilot's lifetime reputation, the global ladder, each row tagged with the rank
 *     tier (Recruit → Hotshot → Veteran → Captain → Chief) that reputation earns.
 *
 * What makes it read like a timing screen rather than a flat list:
 *   • a single continuous TABLE from P1 down — no separate podium pedestal; the top three are just the
 *     top rows, their position number tinted gold/silver/bronze and the leader row glowing;
 *   • a MOVEMENT column — ▲ green / ▼ red / – flat / NEW — showing how each pilot's position changed
 *     since you last opened this board (a real diff, computed client-side from a localStorage snapshot
 *     of the previous ranks — the backend keeps no rank history, so we keep our own);
 *   • a GAP-to-leader figure under each score, the way an F1 tower shows the interval;
 *   • a per-pilot TEAM COLOUR — a stable hue hashed from the callsign — painted as the row's left edge
 *     and the avatar, so the grid reads as a field of distinct entrants at a glance;
 *   • on All-Time, each row's RANK TIER as a heat-ramp dot+name, and a RANK-ADVANCE strip up top that
 *     shows your own climb toward the next tier (the same ladder the home dossier leads with);
 *   • a STICKY "YOU" row pinned to the scroll so you always see where you stand, even at #147.
 *
 * Pure DOM, zero assets, self-disposing (Close / backdrop tap / Esc). Network is best-effort via
 * leaderboard/client.ts; `openLeaderboard()` owns its own overlay, so callers don't manage lifecycle.
 */

// Tabular monospaced numerals — the timing-tower "lap clock" feel. A system stack (no font download,
// keeps the no-binary-assets ethos); tabular-nums on top so columns of digits stay rail-straight.
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Menlo, Consolas, monospace';

// The shared province whose per-day board the "Today" tab reads. Single-sourced here (and matched to the
// default of `provinceSessionId`) so the day's board key and its display name can't drift; when a second
// shared province ships this becomes a lookup. (Known limitation noted in the maps-foundation handoff.)
const TODAY_REGION = 'saskatchewan';

// Warm "you" treatment (the ember analogue of the cockpit's cyan rowMine) — board surfaces + the
// grid palette live as tokens in theme.ts (BOARD.*); these short aliases keep the row code readable.
const MINE_BG = BOARD.mine;
const MINE_BORDER = UI.ember;

// Column widths shared by the header strip and every row so the columns stay rail-aligned. They resolve
// from CSS custom properties set on the overlay root (`.bmf-lb-root`, see injectStyles), so a phone-width
// media query can shrink the fixed columns + gap and hand the squeeze back to the flexible PILOT column —
// the inline widths reference the vars, the stylesheet picks the breakpoint.
const COL = {
  bar: 'var(--lb-bar)',
  pos: 'var(--lb-pos)',
  move: 'var(--lb-move)',
  avatar: 'var(--lb-avatar)',
  right: 'var(--lb-right)',
  gap: 'var(--lb-gap)',
};

/** Which board is showing: ALL-TIME (lifetime reputation + rank) or TODAY's shared province shift. */
type Board2 = 'allTime' | 'today';

/** A board row normalised for rendering — the table, the sticky YOU row and the gap maths consume this. */
interface Ranked {
  rank: number;
  pilot: string;
  value: string; // formatted score / reputation total
  num: number; // raw numeric, for the gap-to-leader column
  sub: string; // small trailing line (N shifts · "2d ago" / time · "2d ago")
  mine: boolean;
  key: string; // lowercased callsign — the movement-snapshot key
  delta: number | null; // prevRank − rank since last visit: >0 up, <0 down, 0 flat, null = NEW/unknown
  tier: RankTier | null; // lifetime rank tier (All-Time rows only; null on the single-shift Today board)
}

/** Open the leaderboard overlay. `initialMissionId` selects today's board on open when it names a province
 *  shift (the stand-down screen passes the just-flown id); otherwise it opens on the All-Time ladder. The
 *  leading `_catalog` is retained for call-site compatibility (the campaign it indexed has retired). */
export function openLeaderboard(_catalog: MissionDef[], initialMissionId?: string): void {
  injectStyles();
  new Leaderboard(initialMissionId);
}

class Leaderboard {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly myName: string;
  private readonly myClient: string;
  private active: Board2;
  private reqToken = 0; // guards against a slow fetch overwriting a newer tab

  constructor(initialMissionId?: string) {
    this.myName = (loadProfile()?.name ?? '').trim();
    this.myClient = getClientId();
    // Open on Today's board when launched from a province stand-down; otherwise the All-Time ladder.
    this.active = initialMissionId && isProvinceId(initialMissionId) ? 'today' : 'allTime';

    this.root = div({
      position: 'fixed',
      inset: '0',
      zIndex: '60',
      overflowY: 'auto',
      // Near-opaque WARM backdrop (ember atmosphere) so the overlay fully OCCLUDES the menu it opens
      // over — and so the board reads on the "fight" register, not the cockpit's cool blue.
      background: `radial-gradient(125% 92% at 50% -4%, ${BOARD.bgTop}, ${BOARD.bgBot})`,
      fontFamily: UI.font,
      color: UI.text,
      boxSizing: 'border-box',
    });
    // Carries the column-width CSS vars + page padding (so the phone breakpoint in injectStyles can
    // tighten both). Kept in the stylesheet, not inline, so the media query can win the cascade.
    this.root.className = 'bmf-lb-root';
    setBlur(this.root); // blur whatever sits behind so nothing reads through the board
    // Backdrop tap (outside the panel) closes.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);

    const panel = div({ maxWidth: '640px', margin: '0 auto', position: 'relative' });
    panel.appendChild(this.header());

    // Two boards: TODAY (the shared per-day province shift) and ALL-TIME (lifetime reputation + rank). A
    // WARM-register segmented switch (gold accent) replaces the old flat scroll of one tab per mission.
    const tabs = makeTabs(['Today', 'All-Time'], (i) => {
      const next: Board2 = i === 0 ? 'today' : 'allTime';
      if (next === this.active) return;
      this.active = next;
      this.load();
    }, 'fight');
    tabs.select(this.active === 'today' ? 0 : 1);
    const tabRow = div({ margin: '14px 0 2px' });
    tabRow.appendChild(tabs.el);
    panel.appendChild(tabRow);

    this.body = div({ marginTop: '14px' });
    panel.appendChild(this.body);

    this.root.appendChild(panel);
    document.body.appendChild(this.root);

    this.refreshBtn = this.headerRefreshBtn!;
    this.load();
  }

  // Stash the refresh button created inside header() so load() can spin it.
  private headerRefreshBtn: HTMLButtonElement | null = null;

  /** Title block — a timing-tower wordmark: an ember "LIVE TIMING" eyebrow over a big THE BOARD,
   *  with the refresh + close controls riding the top-right like a broadcast graphic. */
  private header(): HTMLDivElement {
    const head = div({ display: 'flex', alignItems: 'flex-start', gap: '10px' });

    const title = div({ flex: '1', minWidth: '0' });
    const eyebrow = div({ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' });
    const dot = div({
      width: '7px',
      height: '7px',
      borderRadius: R.round,
      background: UI.ember,
      boxShadow: UI.emberGlow,
    });
    dot.className = 'bmf-lb-pulse';
    eyebrow.appendChild(dot);
    eyebrow.appendChild(
      div(
        { fontSize: FS.label, fontWeight: FW.heavy, letterSpacing: '3px', color: UI.emberHi, fontFamily: MONO },
        'LIVE TIMING',
      ),
    );
    title.appendChild(eyebrow);
    title.appendChild(
      div({ fontSize: FS.banner, fontWeight: FW.black, letterSpacing: '0.5px', lineHeight: '1' }, 'THE BOARD'),
    );
    title.appendChild(div({ fontSize: FS.meta, color: UI.dim, marginTop: '5px' }, 'Global rankings.'));
    head.appendChild(title);

    const ctrl = div({ display: 'flex', gap: '8px', flex: 'none' });
    this.headerRefreshBtn = makeIconButton({ glyph: '⟳', size: 36, title: 'Refresh', onClick: () => this.load() }).el;
    ctrl.appendChild(this.headerRefreshBtn);
    ctrl.appendChild(makeIconButton({ glyph: '✕', size: 36, title: 'Close', onClick: () => this.close() }).el);
    head.appendChild(ctrl);
    return head;
  }

  private close(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.close();
  }

  // --- Load + render ---------------------------------------------------------

  /** The localStorage snapshot key for the active board — today's movement is per-day. */
  private snapKey(): string {
    return this.active === 'today' ? `today:${provinceSessionId(new Date())}` : 'allTime';
  }

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
      if (this.active === 'allTime') {
        const { rows, total } = await fetchCareerTop(50);
        if (token !== this.reqToken) return;
        const ranked = rows.map((r, i) => this.fromCareer(r, i + 1));
        let standing = ranked.find((r) => r.mine) ?? null;
        if (!standing && this.myName) {
          const s = await fetchCareerStanding(this.myName);
          if (token !== this.reqToken) return;
          if (s) standing = this.fromCareer(s.entry, s.rank);
        }
        this.renderBoard(ranked, total || ranked.length, standing, false);
      } else {
        // Today's shared race — the per-day province board, keyed by the date-stamped session id.
        const id = provinceSessionId(new Date(), TODAY_REGION);
        const { rows, total } = await fetchMissionTop(id, 25);
        if (token !== this.reqToken) return;
        const ranked = rows.map((r, i) => this.fromMission(r, i + 1));
        let standing = ranked.find((r) => r.mine) ?? null;
        if (!standing) {
          const s = await fetchMissionStanding(id);
          if (token !== this.reqToken) return;
          if (s) standing = this.fromMission(s.entry, s.rank);
        }
        this.renderBoard(ranked, total || ranked.length, standing, true);
      }
    } finally {
      if (token === this.reqToken) this.setRefreshing(false);
    }
  }

  private fromMission(r: MissionEntry, rank: number): Ranked {
    const mine = r.client_id === this.myClient || (!!this.myName && r.pilot.toLowerCase() === this.myName.toLowerCase());
    const sub = [r.time_s != null ? fmtTime(r.time_s) : '', fmtAgo(r.created_at)].filter(Boolean).join('   ·   ');
    return { rank, pilot: r.pilot, value: r.score.toLocaleString(), num: r.score, sub, mine, key: r.pilot.toLowerCase(), delta: null, tier: null };
  }

  private fromCareer(r: CareerEntry, rank: number): Ranked {
    const mine = !!this.myName && r.pilot.toLowerCase() === this.myName.toLowerCase();
    const sub = [`${r.missions} ${r.missions === 1 ? 'shift' : 'shifts'}`, fmtAgo(r.last_seen)].filter(Boolean).join('   ·   ');
    return { rank, pilot: r.pilot, value: r.total.toLocaleString(), num: r.total, sub, mine, key: r.pilot.toLowerCase(), delta: null, tier: rankFor(r.total) };
  }

  private renderBoard(ranked: Ranked[], total: number, standing: Ranked | null, today: boolean): void {
    if (ranked.length === 0) {
      const empty = div({});
      if (today) empty.appendChild(this.todayHeader());
      empty.appendChild(
        this.note(
          today
            ? 'No runs today. Fly the shift and set the pace.'
            : 'No runs yet. Fly a shift and be first on the board.',
        ),
      );
      const local = this.localPanel();
      if (local) empty.appendChild(local);
      this.body.replaceChildren(empty);
      return;
    }

    // Diff against the previous visit, then re-snapshot for next time — this is what powers the ▲▼ column.
    this.applyMovement(ranked);

    const leader = ranked[0]?.num ?? 0;

    const frag = div({});
    if (today) frag.appendChild(this.todayHeader());
    else {
      // The personal RANK-ADVANCE strip up top — your climb up the tier ladder (the board as progression,
      // not just a list). Reads the LOCAL career total so it shows instantly and even offline.
      const strip = this.rankStrip();
      if (strip) frag.appendChild(strip);
    }
    frag.appendChild(this.contextBar(total, standing, today));

    const table = div({
      borderRadius: R.lg,
      overflow: 'hidden',
      background: BOARD.table,
      border: `1px solid ${UI.stroke}`,
    });
    setBlur(table);
    table.appendChild(this.columnHeader('REP'));
    ranked.forEach((r, i) => table.appendChild(this.row(r, i, leader)));
    frag.appendChild(table);

    frag.appendChild(this.caption(ranked.length, total));

    // Pin "YOU" only when you're outside the visible field — top entries are already on screen.
    if (standing && !ranked.some((r) => r.mine)) {
      const youTier = !today ? rankFor(standing.num) : null;
      frag.appendChild(this.youRow(standing, total, leader, youTier));
    }

    this.body.replaceChildren(frag);
  }

  // --- Movement (position change since last visit) ---------------------------

  /**
   * Fill each row's `delta` from the snapshot of ranks taken the LAST time this board was opened,
   * then overwrite the snapshot with the current ranks. `delta = prevRank − rank`, so a pilot who
   * climbed from 8th to 5th gets +3 (▲3); a new face the snapshot has never seen stays `null` (NEW).
   * The backend stores no rank history — keeping our own tiny snapshot is the honest way to show a
   * real, personal "what changed since you last looked".
   */
  private applyMovement(ranked: Ranked[]): void {
    const store = loadSnaps();
    const prev = store[this.snapKey()] ?? null;
    for (const r of ranked) {
      const was = prev ? prev[r.key] : undefined;
      r.delta = typeof was === 'number' ? was - r.rank : null;
    }
    const next: Record<string, number> = {};
    for (const r of ranked) next[r.key] = r.rank;
    store[this.snapKey()] = next;
    saveSnaps(store);
  }

  // --- Rank-advance strip (All-Time only) ------------------------------------

  /** The player's own ladder progress — tier badge + reputation, and a bar toward the next tier. The
   *  single "the game changed" element: the All-Time board is about climbing Recruit → Chief, so the
   *  board leads with where YOU are on that climb (mirroring the home dossier). Null at zero reputation
   *  (a brand-new pilot sees just the empty-state note). Local-sourced → instant + offline-safe. */
  private rankStrip(): HTMLDivElement | null {
    const pts = careerScore();
    if (pts <= 0) return null;
    const tier = rankFor(pts);
    const np = nextRankProgress(pts);

    const card = div({
      margin: '2px 2px 14px',
      padding: '13px 16px',
      borderRadius: R.lg,
      background: BOARD.card,
      border: `1px solid ${UI.warmStroke}44`,
    });
    setBlur(card);

    card.appendChild(
      div({ fontSize: FS.tag, fontWeight: FW.heavy, letterSpacing: '1.6px', color: UI.faint, fontFamily: MONO, marginBottom: '8px' }, 'YOUR RANK'),
    );

    const top = div({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' });
    const badge = div({ display: 'inline-flex', alignItems: 'center', gap: '9px', minWidth: '0' });
    badge.appendChild(div({ width: '10px', height: '10px', borderRadius: R.round, background: tier.color, boxShadow: `0 0 12px ${tier.color}`, flex: 'none' }));
    badge.appendChild(div({ fontSize: FS.title, fontWeight: FW.heavy, color: tier.color, letterSpacing: '0.3px' }, tier.name));
    top.appendChild(badge);
    top.appendChild(div({ fontFamily: MONO, fontSize: FS.meta, fontWeight: FW.bold, color: UI.faint, letterSpacing: '0.4px', flex: 'none' }, `${pts.toLocaleString()} REP`));
    card.appendChild(top);

    const barrow = div({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', margin: '11px 0 6px' });
    barrow.appendChild(div({ fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '1.2px', color: UI.faint }, 'RANK ADVANCE'));
    barrow.appendChild(
      div(
        { fontFamily: MONO, fontSize: FS.tag, fontWeight: FW.bold, letterSpacing: '0.4px', color: UI.dim },
        np.next ? `${np.remaining.toLocaleString()} TO ${np.next.name.toUpperCase()}` : 'TOP RANK',
      ),
    );
    card.appendChild(barrow);

    const track = div({ height: '6px', borderRadius: R.pill, background: UI.track, overflow: 'hidden' });
    track.appendChild(div({ height: '100%', width: `${Math.round(np.frac * 100)}%`, borderRadius: R.pill, background: tier.color, boxShadow: `0 0 12px ${tier.color}` }));
    card.appendChild(track);
    return card;
  }

  // --- Today header ----------------------------------------------------------

  /** Today's-race strip above its board: the label + date + how it's ranked. Frames the per-day shared
   *  province board as a recurring race, not just another mission. */
  private todayHeader(): HTMLDivElement {
    const card = div({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '14px',
      flexWrap: 'wrap',
      margin: '2px 0 14px',
      padding: '13px 16px',
      borderRadius: R.lg,
      background: BOARD.card,
      border: `1px solid ${UI.warmStroke}44`,
    });
    setBlur(card);

    const left = div({ minWidth: '0' });
    left.appendChild(div({ fontSize: FS.label, fontWeight: FW.heavy, letterSpacing: '2px', color: UI.fire }, '🔥 TODAY'));
    left.appendChild(div({ fontSize: FS.title, fontWeight: FW.heavy, marginTop: '2px' }, dailyDateLabel(new Date())));
    left.appendChild(
      div({ fontSize: FS.meta, color: UI.dim, marginTop: '2px' }, `${regionDisplayName(TODAY_REGION)} · ranked by score, then time`),
    );
    card.appendChild(left);
    return card;
  }

  // --- Context bar -----------------------------------------------------------

  private contextBar(total: number, standing: Ranked | null, today: boolean): HTMLDivElement {
    const bar = div({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      margin: '2px 2px 10px',
      flexWrap: 'wrap',
    });
    const noun = total === 1 ? 'PILOT' : 'PILOTS';
    bar.appendChild(
      div(
        { fontSize: FS.meta, fontWeight: FW.bold, letterSpacing: '1.6px', color: UI.faint, fontFamily: MONO },
        `${total.toLocaleString()} ${noun} ${today ? 'TODAY' : 'RANKED'}`,
      ),
    );
    if (standing) {
      const chip = div({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        padding: '5px 11px',
        borderRadius: R.pill,
        background: MINE_BG,
        border: `1px solid ${UI.ember}77`,
        fontSize: FS.meta,
        fontWeight: FW.heavy,
        letterSpacing: '0.4px',
        color: UI.emberHi,
      });
      chip.textContent = `YOU · P${standing.rank.toLocaleString()} · ${pctText(standing.rank, total)}`;
      bar.appendChild(chip);
    }
    return bar;
  }

  // --- Table: column header + rows -------------------------------------------

  /** The thin uppercase column strip at the top of the tower (POS · Δ · PILOT · metric). */
  private columnHeader(metric: string): HTMLDivElement {
    const h = div({
      display: 'flex',
      alignItems: 'center',
      gap: COL.gap,
      padding: '9px var(--lb-px) 8px',
      borderBottom: `1px solid ${UI.stroke}`,
      background: BOARD.colHead,
      fontSize: FS.tag,
      fontWeight: FW.heavy,
      letterSpacing: '1.4px',
      color: UI.faint,
      fontFamily: MONO,
    });
    h.appendChild(div({ width: COL.bar, flex: 'none' }));
    h.appendChild(div({ width: COL.pos, flex: 'none', textAlign: 'center' }, 'POS'));
    h.appendChild(div({ width: COL.move, flex: 'none', textAlign: 'center' }, 'Δ'));
    h.appendChild(div({ width: COL.avatar, flex: 'none' }));
    h.appendChild(div({ flex: '1', minWidth: '0' }, 'PILOT'));
    h.appendChild(div({ width: COL.right, flex: 'none', textAlign: 'right' }, metric));
    return h;
  }

  private row(r: Ranked, i: number, leader: number): HTMLDivElement {
    const podium = r.rank <= 3;
    const medal = medalColor(r.rank);
    const team = teamColor(r.key);

    const el = div({
      display: 'flex',
      alignItems: 'center',
      gap: COL.gap,
      padding: '9px var(--lb-px)',
      borderBottom: `1px solid ${UI.hair}`,
      background: r.mine ? MINE_BG : r.rank === 1 ? BOARD.rowLeader : i % 2 ? BOARD.rowAlt : 'transparent',
      position: 'relative',
    });
    el.className = 'bmf-lb-row';
    el.style.animationDelay = `${Math.min(i * 22, 280)}ms`;
    if (r.mine) el.style.boxShadow = `inset 0 0 0 1px ${MINE_BORDER}99`;

    // Team colour bar — the row's left edge.
    el.appendChild(div({ width: COL.bar, flex: 'none', alignSelf: 'stretch', borderRadius: R.pill, background: team }));

    // POS — medal-tinted for the top three.
    el.appendChild(
      div(
        {
          width: COL.pos,
          flex: 'none',
          textAlign: 'center',
          fontFamily: MONO,
          fontSize: podium ? FS.title : FS.lg,
          fontWeight: FW.black,
          color: podium ? medal : UI.dim,
          textShadow: podium ? `0 0 12px ${medal}55` : 'none',
          lineHeight: '1',
        },
        `${r.rank}`,
      ),
    );

    // Δ — position movement since last visit.
    el.appendChild(movementCell(r.delta));

    // Avatar — initials on the team colour.
    el.appendChild(avatarDot(r.pilot, team, r.mine));

    // Who — callsign (+ YOU pill) over the sub line (rank tier + N shifts on All-Time; time on Today).
    const who = div({ flex: '1', minWidth: '0' });
    const nameRow = div({ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', overflow: 'hidden' });
    nameRow.appendChild(
      // flex:'0 1 auto' + minWidth:0 so a long callsign actually shrinks & ellipsizes WITHIN the cell
      // instead of overflowing into the score column (the flex-item default min-width:auto breaks ellipsis).
      div(
        { flex: '0 1 auto', minWidth: '0', fontSize: FS.lg, fontWeight: FW.bold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
        r.pilot,
      ),
    );
    if (r.mine) nameRow.appendChild(youPill());
    who.appendChild(nameRow);
    if (r.tier || r.sub) who.appendChild(subLine(r.tier, r.sub));
    el.appendChild(who);

    // Right — the score over the gap-to-leader interval.
    el.appendChild(scoreCell(r.value, r.rank === 1 ? null : leader - r.num, r.mine));
    return el;
  }

  /** Your own row, pinned to the bottom of the scroll so you always see where you stand. Same tower
   *  grammar as a list row, ember-ringed and lifted. */
  private youRow(s: Ranked, total: number, leader: number, tier: RankTier | null): HTMLDivElement {
    // Movement for the sticky row too (it shares the board snapshot already written by applyMovement,
    // so re-reading the previous value here would be self-referential — show it as a stable pin, no Δ).
    const team = teamColor(s.key);
    const card = div({
      position: 'sticky',
      bottom: '8px',
      marginTop: '14px',
      display: 'flex',
      alignItems: 'center',
      gap: COL.gap,
      padding: '11px var(--lb-px)',
      borderRadius: R.lg,
      background: BOARD.youRow,
      border: `1px solid ${UI.ember}99`,
      boxShadow: `0 0 0 1px ${UI.ember}33, 0 -6px 26px rgba(0,0,0,0.55)`,
    });
    setBlur(card);

    card.appendChild(div({ width: COL.bar, flex: 'none', alignSelf: 'stretch', borderRadius: R.pill, background: team }));
    card.appendChild(
      div(
        { width: COL.pos, flex: 'none', textAlign: 'center', fontFamily: MONO, fontSize: FS.title, fontWeight: FW.black, color: UI.emberHi },
        `${s.rank}`,
      ),
    );
    card.appendChild(div({ width: COL.move, flex: 'none' })); // align with the Δ column
    card.appendChild(avatarDot(s.pilot, team, true));

    const who = div({ flex: '1', minWidth: '0' });
    const nameRow = div({ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', overflow: 'hidden' });
    nameRow.appendChild(
      div({ flex: '0 1 auto', minWidth: '0', fontSize: FS.lg, fontWeight: FW.bold, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, s.pilot),
    );
    nameRow.appendChild(youPill());
    who.appendChild(nameRow);
    who.appendChild(subLine(tier, `${pctText(s.rank, total)} of ${total.toLocaleString()} pilots`));
    card.appendChild(who);

    card.appendChild(scoreCell(s.value, s.rank === 1 ? null : leader - s.num, true));
    return card;
  }

  private caption(shown: number, total: number): HTMLDivElement {
    const text = total > shown ? `Top ${shown} of ${total.toLocaleString()} pilots` : `${total.toLocaleString()} ${total === 1 ? 'pilot' : 'pilots'} ranked`;
    const wrap = div({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
      marginTop: '12px',
      fontSize: FS.meta,
      color: UI.faint,
      letterSpacing: '0.4px',
    });
    wrap.appendChild(div({}, text));
    wrap.appendChild(div({ width: '3px', height: '3px', borderRadius: R.round, background: UI.faint }));
    // A tiny legend so the ▲▼ column is self-explanatory.
    const legend = div({ display: 'inline-flex', alignItems: 'center', gap: '9px', fontFamily: MONO });
    legend.appendChild(legendChip('▲', UI.ok, 'up'));
    legend.appendChild(legendChip('▼', UI.warn, 'down'));
    legend.appendChild(legendChip('NEW', UI.emberHi, ''));
    wrap.appendChild(legend);
    return wrap;
  }

  // --- Empty / offline / loading states --------------------------------------

  private renderOffline(): void {
    const wrap = div({});
    if (this.active === 'today') wrap.appendChild(this.todayHeader());
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
   * "This device" record — shown in the offline/empty states so the panel still has something to say.
   * Reads the open-world progression: lifetime REPUTATION, the RANK tier it earns, and your best single
   * shift. Returns null when there's nothing recorded yet (a fresh pilot sees just the note). The Today
   * tab is the shared per-day race — its standing already rides the table + sticky YOU row, so it has no
   * separate "your device" panel (that's the All-Time ladder's job).
   */
  private localPanel(): HTMLDivElement | null {
    if (this.active === 'today') return null;

    const pts = careerScore();
    const best = bestShift();
    if (pts <= 0 && best <= 0) return null;
    const tier = rankFor(pts);
    const tiles: { label: string; value: string; color?: string }[] = [
      { label: 'Reputation', value: pts.toLocaleString() },
      { label: 'Rank', value: tier.name, color: tier.color },
      { label: 'Best shift', value: best.toLocaleString() },
    ];

    const panel = div({
      maxWidth: '440px',
      margin: '0 auto',
      background: BOARD.card,
      border: `1px solid ${UI.warmStroke}44`,
      borderRadius: R.md,
      padding: '14px 16px',
    });
    setBlur(panel);
    panel.appendChild(div({ fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '2px', color: UI.faint, marginBottom: '11px' }, 'ON THIS DEVICE'));
    const row = div({ display: 'flex', gap: '26px', flexWrap: 'wrap' });
    for (const t of tiles) {
      const tile = div({});
      tile.appendChild(div({ fontSize: FS.title, fontWeight: FW.heavy, color: t.color ?? UI.text, lineHeight: '1.1', fontFamily: MONO }, t.value));
      tile.appendChild(div({ fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '1.2px', color: UI.faint, marginTop: '3px' }, t.label.toUpperCase()));
      row.appendChild(tile);
    }
    panel.appendChild(row);
    return panel;
  }

  /** Shimmer placeholder while a board loads — the column strip + a few tower rows. */
  private skeleton(): HTMLDivElement {
    const wrap = div({
      borderRadius: R.lg,
      overflow: 'hidden',
      border: `1px solid ${UI.stroke}`,
      background: BOARD.skeleton,
    });
    for (let i = 0; i < 7; i++) {
      const rowEl = div({ display: 'flex', alignItems: 'center', gap: COL.gap, padding: '11px var(--lb-px)', borderBottom: `1px solid ${UI.hair}` });
      rowEl.appendChild(skel({ width: '20px', height: '16px' }));
      rowEl.appendChild(skel({ width: '30px', height: '30px', borderRadius: R.round }));
      rowEl.appendChild(skel({ flex: '1', height: '12px' }));
      rowEl.appendChild(skel({ width: '64px', height: '14px' }));
      wrap.appendChild(rowEl);
    }
    return wrap;
  }

  private note(text: string): HTMLDivElement {
    return div({ fontSize: FS.md, color: UI.dim, lineHeight: '1.55', textAlign: 'center', padding: '26px 16px 22px' }, text);
  }

  private setRefreshing(on: boolean): void {
    this.refreshBtn.classList.toggle('bmf-lb-spin', on);
  }
}

// --- Cell renderers ---------------------------------------------------------

/** The sub line under a callsign: an optional heat-ramp rank dot + tier name (All-Time), then the dim
 *  trailing text (N shifts · ago / time · ago). Built as a flex row so the tier stays put and the text
 *  ellipsizes within the PILOT column. */
function subLine(tier: RankTier | null, text: string): HTMLDivElement {
  const sub = div({ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', minWidth: '0', overflow: 'hidden' });
  if (tier) {
    sub.appendChild(div({ width: '6px', height: '6px', borderRadius: R.round, background: tier.color, boxShadow: `0 0 6px ${tier.color}`, flex: 'none' }));
    sub.appendChild(div({ fontSize: FS.meta, fontWeight: FW.bold, color: tier.color, whiteSpace: 'nowrap', flex: 'none' }, tier.name));
  }
  if (text) {
    sub.appendChild(
      div({ fontSize: FS.meta, color: UI.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, tier ? `· ${text}` : text),
    );
  }
  return sub;
}

/** The Δ column: a coloured arrow + the number of places moved (▲3 / ▼1), a flat dash, or NEW. */
function movementCell(delta: number | null): HTMLDivElement {
  const cell = div({
    width: COL.move,
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    fontFamily: MONO,
    fontSize: FS.meta,
    fontWeight: FW.heavy,
    lineHeight: '1',
  });
  if (delta === null) {
    cell.style.color = UI.emberHi;
    cell.style.fontSize = FS.tag;
    cell.style.letterSpacing = '0.5px';
    cell.textContent = 'NEW';
    cell.title = 'New on the board';
    return cell;
  }
  if (delta === 0) {
    cell.style.color = UI.faint;
    cell.textContent = '–';
    cell.title = 'No change';
    return cell;
  }
  const up = delta > 0;
  cell.style.color = up ? UI.ok : UI.warn;
  cell.title = `${up ? 'Up' : 'Down'} ${Math.abs(delta)} since your last visit`;
  cell.appendChild(div({ fontSize: FS.sm, lineHeight: '1' }, up ? '▲' : '▼'));
  cell.appendChild(div({}, `${Math.abs(delta)}`));
  return cell;
}

/** The right cell: the score (mono, big) over the gap-to-leader interval ("+12,400" / "LEADER"). */
function scoreCell(value: string, gap: number | null, mine: boolean): HTMLDivElement {
  const cell = div({ width: COL.right, flex: 'none', textAlign: 'right' });
  cell.appendChild(
    div(
      { fontFamily: MONO, fontSize: FS.title, fontWeight: FW.heavy, color: mine ? UI.emberHi : UI.text, lineHeight: '1.05' },
      value,
    ),
  );
  cell.appendChild(
    div(
      { fontFamily: MONO, fontSize: FS.tag, fontWeight: FW.bold, color: gap === null ? UI.menu : UI.faint, marginTop: '3px', letterSpacing: '0.4px' },
      gap === null ? 'LEADER' : `+${Math.round(gap).toLocaleString()}`,
    ),
  );
  return cell;
}

function legendChip(glyph: string, color: string, label: string): HTMLDivElement {
  const c = div({ display: 'inline-flex', alignItems: 'center', gap: '3px', color });
  c.appendChild(div({ fontWeight: FW.heavy }, glyph));
  if (label) c.appendChild(div({ color: UI.faint }, label));
  return c;
}

// --- helpers ----------------------------------------------------------------

function skel(style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const node = div(style);
  node.className = 'bmf-lb-skel';
  return node;
}

/** A compact circular initials avatar painted in the pilot's team colour (ember-ringed when it's you). */
function avatarDot(pilot: string, team: string, mine: boolean): HTMLDivElement {
  const a = div({
    flex: 'none',
    boxSizing: 'border-box', // so the 1px border doesn't push the avatar to 32px and drift the column off the header
    width: COL.avatar,
    height: COL.avatar,
    borderRadius: R.round,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: FS.sm,
    fontWeight: FW.heavy,
    color: BOARD.avatarInk,
    background: `linear-gradient(155deg, ${team}, ${team}aa)`,
    border: `1px solid ${mine ? UI.ember : team}`,
    boxShadow: mine ? `0 0 0 2px ${UI.ember}66` : 'none',
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
      color: UI.ink,
      background: UI.ember,
      borderRadius: R.pill,
      padding: '2px 7px',
    },
    'YOU',
  );
}

function medalColor(rank: number): string {
  return rank === 1 ? UI.gold : rank === 2 ? UI.silver : rank === 3 ? UI.bronze : UI.dim;
}

/** A stable team colour for a callsign — the same name always hashes to the same grid hue. */
function teamColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return BOARD.team[Math.abs(h) % BOARD.team.length];
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
  if (total < 10) return `P${rank} of ${total}`;
  const pct = Math.max(1, Math.min(100, Math.round((rank / total) * 100)));
  return `Top ${pct}%`;
}

/** Seconds → "⏱ m:ss" for a Today-board sub-label. */
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

// --- Movement snapshot store ------------------------------------------------
// A tiny per-board map of callsign → rank from the player's PREVIOUS visit, so the next visit can
// show "you moved up 3 / they dropped 1". Kept small (pruned to a handful of boards) and best-effort
// — any storage failure just means the board shows everyone as NEW, which is harmless.

const SNAP_KEY = 'bmf.lb.snap.v1';
type Snaps = Record<string, Record<string, number>>;

function loadSnaps(): Snaps {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Snaps) : {};
  } catch {
    return {};
  }
}

function saveSnaps(store: Snaps): void {
  try {
    // Keep 'allTime' plus the most recent few daily boards so the store can't grow without bound.
    const keys = Object.keys(store);
    if (keys.length > 6) {
      const drop = keys.filter((k) => k !== 'allTime').sort().slice(0, keys.length - 6);
      for (const k of drop) delete store[k];
    }
    localStorage.setItem(SNAP_KEY, JSON.stringify(store));
  } catch {
    /* storage blocked (private mode) — movement just resets next visit */
  }
}

// One-time scoped keyframes (shimmer skeleton, refresh spin, staggered row reveal, live-dot pulse).
let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const tag = document.createElement('style');
  tag.textContent = `
  /* Column-width tokens + page padding. Default (tablet/desktop) widths; the breakpoints below tighten
     the fixed columns + gap on phones so the flexible PILOT column keeps real width instead of collapsing.
     Kept here (not inline) so the media queries win the cascade. */
  .bmf-lb-root { padding: 30px 16px 56px; --lb-bar: 4px; --lb-pos: 30px; --lb-move: 46px; --lb-avatar: 30px; --lb-right: 96px; --lb-gap: 10px; --lb-px: 13px; }
  @media (max-width: 400px) { .bmf-lb-root { padding: 28px 10px 52px; --lb-pos: 26px; --lb-move: 34px; --lb-avatar: 28px; --lb-right: 86px; --lb-gap: 8px; --lb-px: 11px; } }
  @media (max-width: 340px) { .bmf-lb-root { padding: 26px 8px 48px; --lb-pos: 24px; --lb-move: 30px; --lb-avatar: 26px; --lb-right: 80px; --lb-gap: 6px; --lb-px: 10px; } }
  @keyframes bmf-lb-shimmer { 0% { background-position: -240px 0 } 100% { background-position: 240px 0 } }
  @keyframes bmf-lb-spin { to { transform: rotate(360deg) } }
  @keyframes bmf-lb-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
  @keyframes bmf-lb-pulse { 0%, 100% { opacity: 1; transform: scale(1) } 50% { opacity: 0.45; transform: scale(0.7) } }
  .bmf-lb-skel { background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,180,120,0.14) 37%, rgba(255,255,255,0.05) 63%); background-size: 480px 100%; animation: bmf-lb-shimmer 1.2s infinite linear; border-radius: 6px; }
  .bmf-lb-spin { animation: bmf-lb-spin 0.7s linear infinite; }
  .bmf-lb-row { animation: bmf-lb-in 0.28s ease both; }
  .bmf-lb-pulse { animation: bmf-lb-pulse 1.8s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .bmf-lb-row, .bmf-lb-pulse { animation: none !important; } }
  `;
  document.head.appendChild(tag);
}
