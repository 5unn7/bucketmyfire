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
import { openShop } from '../ui/ShopScreen';
import { dailyStreak } from '../missions/streak';
import { bannerButton, fmtTime } from './common';
import type { HudState, EndScreenHooks } from './types';
import type { ScoreBreakdown, ScoreGrade } from '../missions/types';

export class EndScreen {
  private readonly root: HTMLElement;
  private readonly end?: EndScreenHooks; // campaign end-banner buttons (next / menu)
  private readonly pilotName?: string; // callsign from onboarding — personalizes the banner
  /** Mission name, captured from the briefing → used in the Share text. Set by HUD.showBriefing. */
  missionName = '';
  private banner?: HTMLDivElement;

  constructor(root: HTMLElement, end?: EndScreenHooks, pilotName?: string) {
    this.root = root;
    this.end = end;
    this.pilotName = pilotName;
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
    // Blurred backdrop — captures pointer events (taps don't leak to the game) and centers the card.
    const back = scrim({ opacity: reduce ? '1' : '0', transition: reduce ? 'none' : 'opacity 0.3s ease' });
    this.banner = back; // the `shown` guard in update() keys off this

    const card = frosted({
      textAlign: 'center',
      padding: '26px 30px 22px',
      borderRadius: R.xl,
      pointerEvents: 'auto',
      width: '100%',
      maxWidth: 'min(92vw, 380px)',
      maxHeight: 'calc(100% - 8px)',
      overflowY: 'auto',
      boxShadow: UI.shadowCard,
      boxSizing: 'border-box',
    });

    const who = this.pilotName ?? 'pilot';
    // A crash isn't a tactical "mission failed" — you wrecked the aircraft. Headline it as such so the
    // outcome reads true at a glance; every other loss (fire/fuel/community/time) is MISSION FAILED.
    const crashed = s.debrief?.cause === 'tree' || s.debrief?.cause === 'impact' || s.debrief?.cause === 'airframe' || s.debrief?.cause === 'bridge';
    const headline = s.won ? 'MISSION COMPLETE' : crashed ? 'AIRFRAME LOST' : 'MISSION FAILED';
    card.appendChild(
      el('div', { fontSize: FS.banner, fontWeight: FW.heavy, letterSpacing: '0.5px', color: s.lost ? UI.warn : UI.accent }, headline),
    );
    const d = s.debrief;
    // Run grade — the headline accolade. A big letter badge in its rank colour (S gold → D red),
    // with the 1..3 star medal beneath it (same baseline ratio, so they always agree).
    const grade = s.won ? d?.breakdown?.grade ?? null : null;
    const stars = s.won ? d?.breakdown?.stars ?? null : null;
    if (grade) card.appendChild(gradeBadge(grade, stars));
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
    card.appendChild(el('div', { fontSize: FS.lg, marginTop: '8px', color: 'rgba(231,247,255,0.82)' }, sub));

    // Score readout. With a breakdown (every non-crash outcome) we show the itemised math so the player
    // SEES where the points came from — hardship, precision, defense, penalties — then the total. On a
    // crash (no breakdown) we fall back to the plain "what you did" summary + a single score line.
    if (d?.breakdown) {
      card.appendChild(scoreBreakdownBlock(d.breakdown, d.timeSec));
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
      const row = el('div', { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px', flexWrap: 'wrap' });
      if (s.won && this.end.hasNext) row.appendChild(bannerButton('NEXT ▸', 'primary', this.end.onNext));
      if (!s.won) row.appendChild(bannerButton('↻ RETRY', 'primary', this.end.onRetry));
      row.appendChild(bannerButton('MENU', 'ghost', this.end.onMenu));
      card.appendChild(row);
      // Secondary row — leaderboard + share (the free viral loop; OG tags already unfurl the link).
      const row2 = el('div', { display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '10px', flexWrap: 'wrap' });
      if (this.end.onLeaderboard) row2.appendChild(bannerButton('🏆 LEADERBOARD', 'secondary', this.end.onLeaderboard));
      row2.appendChild(this.shareButton(s));
      card.appendChild(row2);
      // Win-only merch hook — surfaced at the highest-intent moment (just won, grade glowing). Opens
      // the Squadron Store screen (a placeholder "fire in progress" + Notify-me email capture for now;
      // the email both backs up the player's progress and lands us the lead). Real store drops in later.
      if (s.won) {
        const store = bannerButton('🪧 SQUADRON STORE', 'store', () => openShop());
        const storeRow = el('div', { display: 'flex', justifyContent: 'center', marginTop: '12px' });
        storeRow.appendChild(store);
        card.appendChild(storeRow);
      }
    }

    back.appendChild(card);
    this.root.appendChild(back);
    if (!reduce) {
      void back.offsetWidth; // force reflow so the fade runs from opacity 0
      back.style.opacity = '1';
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

/** The "NEW AIRCRAFT UNLOCKED" celebration strip on the end screen — one accent-framed panel listing
 *  each airframe whose campaign gate this win just crossed (name + tagline). */
function unlockCallout(items: { name: string; tagline: string }[]): HTMLDivElement {
  const box = el('div', {
    marginTop: '16px',
    padding: '12px 16px',
    borderRadius: R.md,
    border: `1px solid ${UI.accent}66`,
    background: UI.accentFill,
    boxShadow: `0 0 16px ${UI.accent}33`,
    textAlign: 'center',
  });
  box.appendChild(
    el('div', { fontSize: FS.label, fontWeight: FW.heavy, letterSpacing: '2px', color: UI.accent }, '🎉 NEW AIRCRAFT UNLOCKED'),
  );
  for (const it of items) {
    box.appendChild(el('div', { fontSize: FS.title, fontWeight: FW.bold, marginTop: '6px' }, `🚁 ${it.name}`));
    box.appendChild(el('div', { fontSize: FS.meta, color: 'rgba(231,247,255,0.7)', marginTop: '1px' }, it.tagline));
  }
  box.appendChild(
    el('div', { fontSize: FS.meta, color: UI.dim, marginTop: '8px' }, 'Choose it from the aircraft carousel on the menu.'),
  );
  return box;
}

/** The run's headline accolade (win only). STARS are the hero (#5) — a big 1..3 gold star medal — with
 *  the letter RANK demoted to a small chip beneath. Both paint off the ONE `GRADE` colour map in
 *  theme.ts (#8: replaces a drifted local `GRADE_COLORS` copy that disagreed with it). Falls back to a
 *  big rank letter only when no star count is available. */
function gradeBadge(grade: ScoreGrade, stars: number | null): HTMLDivElement {
  const c = GRADE[grade] ?? UI.accent;
  const col = el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', marginTop: '12px' });
  if (stars !== null) {
    // Hero: the star medal, big and gold — the metric everyone reads at a glance and shares.
    const row = el('div', { display: 'flex', gap: '8px', fontSize: FS.banner, lineHeight: '1' });
    for (let i = 1; i <= 3; i++) {
      const on = i <= stars;
      row.appendChild(el('div', { color: on ? UI.gold : UI.faint, textShadow: on ? `0 0 16px ${UI.gold}66` : 'none' }, on ? '★' : '☆'));
    }
    col.appendChild(row);
    // Secondary: a small "RANK A" chip in the grade colour (the sim-serious flex, demoted).
    const chip = el('div', { display: 'inline-flex', alignItems: 'baseline', gap: '6px', fontSize: FS.label, letterSpacing: '2px', fontWeight: FW.bold, color: UI.dim }, 'RANK');
    chip.appendChild(el('span', { color: c, fontWeight: FW.heavy, fontSize: FS.body, letterSpacing: '0' }, grade));
    col.appendChild(chip);
  } else {
    // No star count → fall back to the big rank letter as the hero.
    col.appendChild(el('div', { fontSize: FS.mega, fontWeight: FW.black, lineHeight: '1', color: c, textShadow: `0 0 18px ${c}66` }, grade));
  }
  return col;
}

/**
 * The itemised score breakdown on the end banner — the whole point of the rework: the player SEES where
 * the points came from. Outcome / skill / coordination lines, the hardship × multiplier, red penalty
 * lines, a divider, then the total + run time. Pure presentation over the pre-computed `ScoreBreakdown`.
 */
function scoreBreakdownBlock(b: ScoreBreakdown, timeSec: number): HTMLDivElement {
  const box = el('div', {
    marginTop: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '12px 16px',
    borderRadius: R.md,
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${UI.stroke}`,
    fontSize: FS.body,
    minWidth: '214px',
  });
  for (const ln of b.lines) {
    const row = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '18px' });
    const left = el('div', { display: 'flex', gap: '6px', alignItems: 'baseline', color: ln.kind === 'sub' ? UI.warn : UI.dim }, ln.label);
    if (ln.note) left.appendChild(el('span', { color: 'rgba(231,247,255,0.4)', fontSize: FS.meta }, ln.note));
    row.appendChild(left);
    let text: string;
    let color: string;
    if (ln.kind === 'mul') {
      text = `×${ln.value.toFixed(2)}`;
      color = UI.accent;
    } else if (ln.kind === 'sub') {
      text = ln.value.toLocaleString(); // already negative
      color = UI.warn;
    } else {
      text = `+${ln.value.toLocaleString()}`;
      color = 'rgba(231,247,255,0.92)';
    }
    row.appendChild(el('div', { color, fontWeight: FW.bold, whiteSpace: 'nowrap' }, text));
    box.appendChild(row);
  }
  box.appendChild(el('div', { height: '1px', background: UI.stroke, margin: '6px 0 2px' }));
  const total = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '18px' });
  total.appendChild(el('div', { color: 'rgba(231,247,255,0.92)', fontWeight: FW.heavy, letterSpacing: '1px', fontSize: FS.md }, 'SCORE'));
  total.appendChild(el('div', { color: UI.accent, fontWeight: FW.heavy, fontSize: FS.hero }, b.total.toLocaleString()));
  box.appendChild(total);
  box.appendChild(el('div', { color: UI.dim, fontSize: FS.meta, marginTop: '2px', textAlign: 'right' }, `time ${fmtTime(timeSec)}`));
  return box;
}
