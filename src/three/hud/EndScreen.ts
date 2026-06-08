/**
 * The mission end screen — a full-screen blurred scrim with the outcome headline, run grade +
 * star medal, itemised score, the Next/Retry/Menu/Leaderboard/Share actions, and (on a win) the
 * "new aircraft unlocked" celebration + Squadron Store hook. Lifted out of the HUD whole: it
 * fires once per run, never in the same breath as the per-frame instruments, so it's the cold
 * mass that doesn't belong in the hot core. The HUD constructs one and calls `show(state)` once
 * the run latches won/lost (guarding on `shown` so it builds exactly once).
 */

import { UI, FS, FW, R, GRADE, el, frosted, scrim, prefersReducedMotion } from '../ui/theme';
import { shareScoreCard } from '../ui/shareCard';
import { dailyStreak } from '../missions/streak';
import { bestScore } from '../missions/progress';
import { CAMPAIGN } from '../missions/catalog';
import { bannerButton, fmtTime } from './common';
import type { HudState, EndScreenHooks } from './types';
import type { MissionDef, ScoreBreakdown, ScoreGrade } from '../missions/types';

export class EndScreen {
  private readonly root: HTMLElement;
  private readonly end?: EndScreenHooks; // campaign end-banner buttons (next / menu)
  private readonly pilotName?: string; // callsign from onboarding — personalizes the banner
  /** Mission name, captured from the briefing → the hero headline + the Share text. Set by `setContext`. */
  missionName = '';
  private missionIndex = -1; // 0-based campaign order (→ "Mission N / total" meta line); -1 = not a campaign mission
  private missionPlace = ''; // the home base / community name (→ the meta line); '' when unpinned
  private isCampaign = false; // true → this run is one of the 8 linear missions (drives the "N / total" + best bar)
  private prevBest: number | null = null; // best score BEFORE this run — captured at briefing so the debrief can show the delta + "NEW BEST"
  private banner?: HTMLDivElement;

  constructor(root: HTMLElement, end?: EndScreenHooks, pilotName?: string) {
    this.root = root;
    this.end = end;
    this.pilotName = pilotName;
  }

  /**
   * Capture the mission context the debrief reads — called once from `HUD.setMissionContext`, BEFORE the run
   * (so `prevBest` is the score to beat, not this run's freshly-recorded one). Drives the hero headline
   * (the mission NAME), the "place · Mission N / total" meta line, and the new-best delta bar.
   */
  setContext(def: MissionDef): void {
    this.missionName = def.name;
    this.missionIndex = def.index;
    this.missionPlace = def.places?.base ?? '';
    this.isCampaign = CAMPAIGN.some((m) => m.id === def.id);
    this.prevBest = bestScore(def.id); // null for a first clear; for a Daily Burn replay, the prior day-record to beat
  }

  /** True once the end screen has been built (the `!shown` guard in HUD.update keys off this). */
  get shown(): boolean {
    return !!this.banner;
  }

  /**
   * Mission end screen: outcome headline + grade + itemised score + Next/Retry/Menu/Leaderboard/Share.
   * Mounted in a full-screen BLURRED SCRIM (the frozen world is dimmed + pushed out of focus) so the
   * highest-visibility moment reads as one polished results screen instead of a chip floating over live
   * 3D. A win that crossed a campaign unlock also celebrates the newly-earned aircraft here.
   */
  show(s: HudState): void {
    const reduce = prefersReducedMotion();
    // Compact the results card on short viewports so the debrief obeys the no-scroll law (DESIGN.md):
    // tighter padding + section/button gaps let a full win-debrief (breakdown + unlock + 3 button rows)
    // fit a short phone. The bounded maxHeight + scroll stay ONLY as a never-clip safety net.
    const shortVp = window.innerHeight < 700;
    // Blurred backdrop — captures pointer events (taps don't leak to the game) and centers the card.
    const back = scrim({ opacity: reduce ? '1' : '0', transition: reduce ? 'none' : 'opacity 0.3s ease' });
    this.banner = back; // the `shown` guard in update() keys off this

    const card = frosted({
      textAlign: 'center',
      padding: shortVp ? '15px 22px 13px' : '24px 26px 20px',
      borderRadius: R.xl,
      pointerEvents: 'auto',
      width: '100%',
      maxWidth: 'min(92vw, 384px)',
      maxHeight: 'calc(100% - 8px)',
      overflowY: 'auto',
      // Warm "fight" register (DESIGN.md → two registers): a brand-reward surface, not the cockpit.
      // A faint ember top-glow + a hairline that warms on a win frames the moment without shouting.
      // Tints are token + alpha-hex (no raw colour literals): ember/menu on a win, warn on a loss.
      background: `radial-gradient(120% 80% at 50% -10%, ${s.won ? `${UI.ember}28` : `${UI.warn}1f`}, transparent 60%), ${UI.cardGlass}`,
      border: `1px solid ${s.won ? `${UI.menu}57` : `${UI.warn}4d`}`,
      boxShadow: UI.shadowCard,
      boxSizing: 'border-box',
      opacity: reduce ? '1' : '0',
      transform: reduce ? 'none' : 'translateY(10px) scale(0.985)',
      transition: reduce ? 'none' : 'opacity 0.34s ease, transform 0.34s cubic-bezier(0.16,1,0.3,1)',
    });

    const who = this.pilotName ?? 'pilot';
    const d = s.debrief;
    // A crash isn't a tactical "mission failed" — you wrecked the aircraft. Read that true at a glance;
    // every other loss (fire/fuel/community/time) is MISSION FAILED.
    const crashed = d?.cause === 'tree' || d?.cause === 'impact' || d?.cause === 'airframe' || d?.cause === 'bridge';
    // The HEADER: the OUTCOME is the hero headline (MISSION COMPLETE / FAILED / AIRFRAME LOST), with the
    // mission NAME demoted to a quiet eyebrow above it and a place / "Mission N / total" line below — so
    // the result reads at a glance while the run's identity still frames it.
    const headline = s.won ? 'MISSION COMPLETE' : crashed ? 'AIRFRAME LOST' : 'MISSION FAILED';
    const headColor = s.won ? UI.ok : UI.warn;
    if (this.missionName) {
      card.appendChild(
        el('div', { fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '3px', textTransform: 'uppercase', color: UI.dim }, this.missionName),
      );
    }
    card.appendChild(
      el('div', { fontSize: FS.banner, fontWeight: FW.heavy, letterSpacing: '0.5px', marginTop: this.missionName ? '5px' : '0', lineHeight: '1.05', color: headColor, textShadow: `0 0 16px ${headColor}55` }, headline),
    );
    const metaBits = [
      this.missionPlace,
      this.isCampaign && this.missionIndex >= 0 ? `Mission ${this.missionIndex + 1} / ${CAMPAIGN.length}` : '',
    ].filter(Boolean);
    if (metaBits.length) card.appendChild(metaLine(metaBits.join(' · ')));

    // Run grade — the headline accolade (win only). The 1..3 star MEDAL is the hero, the letter RANK a
    // chip beside it, laid out as one horizontal medal row.
    const grade = s.won ? d?.breakdown?.grade ?? null : null;
    const stars = s.won ? d?.breakdown?.stars ?? null : null;
    if (grade) card.appendChild(gradeMedal(grade, stars));
    // Reactive closing line — reads the outcome, not a canned string.
    let sub: string;
    if (s.won) {
      const stars = d?.breakdown?.stars ?? 0;
      if (d && d.structTotal > 0 && d.structSaved === d.structTotal && d.firesOut >= d.firesTotal) {
        sub = `Textbook, ${who}. Every roof still standing — dispatch owes you a coffee.`;
      } else if (d && d.structTotal > 0 && d.structSaved < d.structTotal) {
        const lost = d.structTotal - d.structSaved;
        sub = `We held the line, ${who}. The fire still took ${lost === 1 ? 'one' : lost} — but the town's standing.`;
      } else if (stars >= 3) {
        sub = `Now THAT was flying, ${who}. Knocked down clean — not a wisp left.`;
      } else {
        sub = `Fire's out, ${who}. That's how it's done.`;
      }
    } else {
      // Loss: name what actually went wrong — straight, no theatrics, and own it. The cause is
      // resolved by Game (a crash carries its sub-cause; a mission-rule loss reads fuel/structures).
      switch (d?.cause) {
        case 'tree':
          sub = 'You put it into the trees. You might want to avoid that.';
          break;
        case 'impact':
          sub = 'Came in too hard. That was a rough landing, even for you.';
          break;
        case 'bridge':
          sub = 'You clipped the bridge. Scenic, sure — but you have to fit under it.';
          break;
        case 'airframe':
          sub = 'Too much damage to keep her airborne. Easy does it next time.';
          break;
        case 'fuel':
          sub = 'Ran the tank dry. You knew the range.';
          break;
        case 'casualty':
          sub = "We didn't reach them in time. They didn't make it.";
          break;
        case 'timeout':
          sub = 'Out of time. The fire got away from us.';
          break;
        case 'structures':
          sub = "The community burned. We didn't hold the line.";
          break;
        default:
          sub = "Fire's still out there. We didn't get it done.";
          break;
      }
    }
    card.appendChild(el('div', { fontSize: FS.md, marginTop: '8px', lineHeight: '1.5', color: UI.textCool, maxWidth: '32ch', marginLeft: 'auto', marginRight: 'auto' }, sub));

    // Score readout. With a breakdown (every non-crash outcome) we show the itemised math so the player
    // SEES where the points came from — hardship, precision, defense, penalties — then the total, under a
    // labeled section header (with a "NEW BEST" stamp when the run beat the stored best). On a crash (no
    // breakdown) we fall back to the plain "what you did" summary + a single score line.
    const newBest = s.won && this.isCampaign && (this.prevBest === null || s.score > this.prevBest);
    if (d?.breakdown) {
      card.appendChild(sectionHeader('SCORE', newBest ? 'NEW BEST' : ''));
      card.appendChild(scoreBreakdownBlock(d.breakdown, d.timeSec));
      if (s.won && this.prevBest !== null) card.appendChild(bestBar(s.score, this.prevBest));
    } else if (d) {
      const stats = el('div', {
        marginTop: '14px',
        display: 'inline-flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '10px 16px',
        borderRadius: R.md,
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${UI.stroke}`,
        fontSize: FS.body,
        color: 'rgba(231,247,255,0.85)',
      });
      const row = (k: string, v: string): void => {
        const r = el('div', { display: 'flex', justifyContent: 'space-between', gap: '22px', minWidth: '180px' });
        r.appendChild(el('div', { color: UI.dim }, k));
        r.appendChild(el('div', { fontWeight: FW.bold }, v));
        stats.appendChild(r);
      };
      row('Fires out', `${d.firesOut}/${d.firesTotal}`);
      if (d.structTotal > 0) row('Structures saved', `${d.structSaved}/${d.structTotal}`);
      if (d.crewTotal > 0) row('Crews delivered', `${d.crewDone}/${d.crewTotal}`);
      row('Time', fmtTime(d.timeSec));
      card.appendChild(stats);
      card.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.bold, marginTop: '12px' }, `Score ${s.score.toLocaleString()}`));
    } else {
      card.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.bold, marginTop: '12px' }, `Score ${s.score.toLocaleString()}`));
    }

    // Progression payoff: a win that just crossed a heli's campaign gate celebrates it here, so the
    // reward isn't invisible until the player wanders back to the aircraft carousel.
    if (s.won && s.unlocked && s.unlocked.length) card.appendChild(unlockCallout(s.unlocked));

    if (this.end) {
      // Primary action row — the obvious next move (advance / retry) + back to the menu.
      const row = el('div', { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: shortVp ? '12px' : '20px', flexWrap: 'wrap' });
      if (s.won && this.end.hasNext) row.appendChild(bannerButton('NEXT ▸', 'primary', this.end.onNext));
      if (!s.won && !this.end.noRetry) row.appendChild(bannerButton('↻ RETRY', 'primary', this.end.onRetry));
      row.appendChild(bannerButton('MENU', 'ghost', this.end.onMenu));
      card.appendChild(row);
      // Secondary row — leaderboard + share (the free viral loop; OG tags already unfurl the link).
      const row2 = el('div', { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: shortVp ? '8px' : '10px', flexWrap: 'wrap' });
      if (this.end.onLeaderboard) row2.appendChild(bannerButton('🏆 LEADERBOARD', 'secondary', this.end.onLeaderboard));
      row2.appendChild(this.shareButton(s));
      card.appendChild(row2);
      // Win-only merch hook — surfaced at the highest-intent moment (just won, grade glowing). Leaves
      // the game for the standalone BMF Gear website (/shop.html) where the waitlist capture lives.
      if (s.won) {
        const store = bannerButton('🪧 SQUADRON STORE', 'store', () => { window.location.href = '/shop.html'; });
        const storeRow = el('div', { display: 'flex', justifyContent: 'center', marginTop: shortVp ? '8px' : '12px' });
        storeRow.appendChild(store);
        card.appendChild(storeRow);
      }
    }

    back.appendChild(card);
    this.root.appendChild(back);
    if (!reduce) {
      void back.offsetWidth; // force reflow so the fade/rise runs from the initial state
      back.style.opacity = '1';
      card.style.opacity = '1';
      card.style.transform = 'none';
    }
  }

  /** A Share button for the end screen: Web Share API where available (the native mobile sheet),
   *  else copy a link to the clipboard with an inline "✓ COPIED" confirmation. */
  private shareButton(s: HudState): HTMLButtonElement {
    const btn = bannerButton('↗ SHARE', 'secondary', () => void this.shareRun(s, btn));
    return btn;
  }

  private async shareRun(s: HudState, btn: HTMLButtonElement): Promise<void> {
    // Share an IMAGE score-card (it unfurls as a picture everywhere) instead of bare text — the
    // single biggest virality upgrade (audit FIX #9). Web Share file -> clipboard image -> download
    // -> text link is all handled in shareCard.ts; here we just reflect the outcome on the button.
    const outcome = await shareScoreCard({
      missionName: this.missionName || 'a wildfire',
      score: s.score,
      stars: s.debrief?.breakdown?.stars ?? undefined,
      won: s.won,
      callsign: this.pilotName || undefined,
      streak: dailyStreak(), // Daily Burn comeback-loop flex; the card shows it only from 2 days on
    });
    if (outcome === 'shared' || outcome === 'failed') return; // native sheet handled it / nothing to confirm
    const orig = btn.textContent;
    btn.textContent = outcome === 'downloaded' ? '✓ SAVED' : '✓ COPIED';
    window.setTimeout(() => {
      btn.textContent = orig;
    }, 1600);
  }
}

/** The "place · Mission N / total" sub-headline under the mission name — a quiet, letter-spaced meta
 *  line led by a warm ember LED, so the debrief states WHERE you flew before it grades HOW. */
function metaLine(text: string): HTMLDivElement {
  const row = el('div', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '7px',
    fontSize: FS.meta,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    color: UI.dim,
  });
  row.appendChild(el('div', { width: '6px', height: '6px', borderRadius: R.round, background: UI.ember, boxShadow: UI.emberGlow, flex: '0 0 auto' }));
  row.appendChild(el('div', {}, text));
  return row;
}

/** A small section divider: a label tag on the left, a hairline rule filling the middle, and an optional
 *  right-hand STAMP (the gold "NEW BEST" flag). Sets the score block apart as its own titled region. */
function sectionHeader(label: string, stamp: string): HTMLDivElement {
  const compact = window.innerHeight < 700; // tighten the SCORE divider gap on short phones (no-scroll law)
  const row = el('div', { display: 'flex', alignItems: 'center', gap: '10px', marginTop: compact ? '11px' : '18px', marginBottom: '8px' });
  row.appendChild(el('div', { fontSize: FS.label, fontWeight: FW.heavy, letterSpacing: '2px', color: UI.faint, flex: '0 0 auto' }, label));
  row.appendChild(el('div', { flex: '1 1 auto', height: '1px', background: UI.stroke }));
  if (stamp) {
    row.appendChild(
      el('div', {
        flex: '0 0 auto',
        fontSize: FS.tag,
        fontWeight: FW.heavy,
        letterSpacing: '1.5px',
        color: UI.ctaInk,
        background: UI.gold,
        padding: '3px 8px',
        borderRadius: R.sm,
        boxShadow: `0 0 14px ${UI.gold}66`,
      }, stamp),
    );
  }
  return row;
}

/** The "score to beat" bar (win only, when a prior best exists): the previous best on the left, the
 *  delta on the right (green when over, dim when short), and a fill track that reads full-gold on a new
 *  record or a partial ember when this run fell short. The visible proof you improved. */
function bestBar(score: number, prevBest: number): HTMLDivElement {
  const delta = score - prevBest;
  const beat = delta >= 0;
  const box = el('div', { marginTop: '10px' });
  const labels = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', fontSize: FS.meta, marginBottom: '5px' });
  labels.appendChild(el('div', { color: UI.dim }, `Previous best ${prevBest.toLocaleString()}`));
  labels.appendChild(
    el('div', { color: beat ? UI.ok : UI.dim, fontWeight: FW.bold }, beat ? `+${delta.toLocaleString()} over` : `${(-delta).toLocaleString()} short`),
  );
  box.appendChild(labels);
  const track = el('div', { height: '5px', borderRadius: R.pill, background: UI.track, overflow: 'hidden' });
  const frac = beat ? 1 : Math.max(0.04, Math.min(1, prevBest > 0 ? score / prevBest : 1));
  track.appendChild(
    el('div', {
      width: `${(frac * 100).toFixed(1)}%`,
      height: '100%',
      borderRadius: R.pill,
      background: beat ? UI.cta : `linear-gradient(90deg, ${UI.ember}, ${UI.emberHi})`,
      boxShadow: beat ? `0 0 12px ${UI.gold}55` : 'none',
    }),
  );
  box.appendChild(track);
  return box;
}

/** The "NEW AIRCRAFT UNLOCKED" celebration strip on the end screen — one gold-framed (warm "fight"
 *  register) panel listing each airframe whose campaign gate this win just crossed (name + tagline). */
function unlockCallout(items: { name: string; tagline: string }[]): HTMLDivElement {
  const box = el('div', {
    marginTop: '16px',
    padding: '12px 16px',
    borderRadius: R.md,
    border: `1px solid ${UI.menu}66`,
    background: UI.menuFill,
    boxShadow: `0 0 16px ${UI.menu}33`,
    textAlign: 'center',
  });
  box.appendChild(
    el('div', { fontSize: FS.label, fontWeight: FW.heavy, letterSpacing: '2px', color: UI.menu }, '🎉 NEW AIRCRAFT UNLOCKED'),
  );
  for (const it of items) {
    box.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.bold, marginTop: '6px' }, `🚁 ${it.name}`));
    box.appendChild(el('div', { fontSize: FS.meta, color: UI.textCool, marginTop: '1px' }, it.tagline));
  }
  box.appendChild(
    el('div', { fontSize: FS.meta, color: UI.dim, marginTop: '8px' }, 'Choose it from the aircraft carousel on the menu.'),
  );
  return box;
}

/** The run's headline accolade (win only) — laid out as ONE horizontal medal row: the 1..3 gold STAR
 *  medal (the hero metric everyone reads + shares) beside a square letter-RANK chip in its grade colour.
 *  Both paint off the ONE `GRADE` colour map in theme.ts. Falls back to a big rank letter alone when no
 *  star count is available. */
function gradeMedal(grade: ScoreGrade, stars: number | null): HTMLDivElement {
  const c = GRADE[grade] ?? UI.accent;
  const row = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '14px' });
  // The letter-rank chip — a carved square in the grade colour.
  const chip = el('div', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '46px',
    height: '46px',
    borderRadius: R.md,
    flex: '0 0 auto',
    fontSize: FS.display,
    fontWeight: FW.black,
    lineHeight: '1',
    color: c,
    background: `${c}1f`,
    border: `1.5px solid ${c}`,
    boxShadow: `0 0 18px ${c}40`,
  }, grade);
  if (stars !== null) {
    row.appendChild(chip);
    const starRow = el('div', { display: 'flex', gap: '6px', fontSize: FS.display, lineHeight: '1' });
    for (let i = 1; i <= 3; i++) {
      const on = i <= stars;
      starRow.appendChild(el('div', { color: on ? UI.gold : UI.faint, textShadow: on ? `0 0 16px ${UI.gold}66` : 'none' }, on ? '★' : '☆'));
    }
    row.appendChild(starRow);
  } else {
    // No star count → the big rank letter carries it alone.
    chip.style.width = '60px';
    chip.style.height = '60px';
    chip.style.fontSize = FS.mega;
    row.appendChild(chip);
  }
  return row;
}

/**
 * The itemised score breakdown on the end banner — the whole point of the rework: the player SEES where
 * the points came from. Outcome / skill / coordination lines, the hardship × multiplier, red penalty
 * lines, a divider, then the total + run time. A recessed, carved-in well (warm "fight" register: the
 * total + multipliers read gold, not the cockpit cyan). Pure presentation over the pre-computed
 * `ScoreBreakdown`.
 */
function scoreBreakdownBlock(b: ScoreBreakdown, timeSec: number): HTMLDivElement {
  const box = el('div', {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '12px 16px',
    borderRadius: R.md,
    background: UI.recess,
    border: `1px solid ${UI.stroke}`,
    boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.45)',
    fontSize: FS.body,
    textAlign: 'left',
    minWidth: '214px',
  });
  for (const ln of b.lines) {
    const row = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '18px' });
    const left = el('div', { display: 'flex', gap: '6px', alignItems: 'baseline', color: ln.kind === 'sub' ? UI.warn : UI.textCool }, ln.label);
    if (ln.note) left.appendChild(el('span', { color: UI.faint, fontSize: FS.meta }, ln.note));
    row.appendChild(left);
    let text: string;
    let color: string;
    if (ln.kind === 'mul') {
      text = `×${ln.value.toFixed(2)}`;
      color = UI.menu; // hardship multiplier — warm gold, the brand register's "alive" accent
    } else if (ln.kind === 'sub') {
      text = ln.value.toLocaleString(); // already negative
      color = UI.warn;
    } else {
      text = `+${ln.value.toLocaleString()}`;
      color = UI.text;
    }
    row.appendChild(el('div', { color, fontWeight: FW.bold, whiteSpace: 'nowrap' }, text));
    box.appendChild(row);
  }
  box.appendChild(el('div', { height: '1px', background: `linear-gradient(90deg, transparent, ${UI.menu}55, transparent)`, margin: '8px 0 3px' }));
  const total = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '18px' });
  total.appendChild(el('div', { color: UI.faint, fontWeight: FW.heavy, letterSpacing: '2px', fontSize: FS.meta, textTransform: 'uppercase' }, 'Total'));
  total.appendChild(el('div', { color: UI.gold, fontWeight: FW.black, fontSize: FS.display, textShadow: `0 0 18px ${UI.gold}40` }, b.total.toLocaleString()));
  box.appendChild(total);
  box.appendChild(el('div', { color: UI.dim, fontSize: FS.meta, marginTop: '2px', textAlign: 'right' }, `time ${fmtTime(timeSec)}`));
  return box;
}
