import { SCORE } from '../config';
import type { MissionDef, MissionState, ScoreBreakdown, ScoreGrade, ScoreLine, ScoreTally } from './types';

/**
 * The scorer (engine-agnostic — numbers only, like the sims). One pure function turns a finished
 * run's `ScoreTally` into a line-itemed `ScoreBreakdown` + an S/A/B/C grade. It is the single source
 * of scoring truth: `MissionRuntime.end()` calls it at the win/lose transition, and the headless
 * campaign verifier calls it through the same path, so the number on the banner is the number proven.
 *
 * Shape (see `config.ts` SCORE for the why and the values):
 *   pre  = outcome + skill + coordination            (skill/coord are win-only)
 *   gross = pre × hardshipMultiplier                 (difficulty × dynamic danger faced)
 *   total = max(0, round(gross × lossFrac) − penalties)   (lossFrac = 1 on a win)
 * The breakdown's `lines` mirror that math top-to-bottom so the player can read exactly where the
 * points came from. A crash never reaches here (it's a terminal 0-score loss owned by Game).
 */
export function computeScore(def: MissionDef, state: MissionState, elapsed: number, t: ScoreTally): ScoreBreakdown {
  const won = state === 'won';
  const lines: ScoreLine[] = [];
  const add = (label: string, value: number, note?: string): void => {
    if (value !== 0) lines.push({ label, value, kind: 'add', note });
  };
  const sub = (label: string, value: number, note?: string): void => {
    if (value > 0) lines.push({ label, value: -value, kind: 'sub', note });
  };

  // --- Outcome -------------------------------------------------------------------------------
  const firePts = SCORE.perFireDoused * t.firesDoused;
  const structPts = SCORE.perStructureSaved * t.structuresSaved;
  const crewPts = SCORE.perCrewMoved * t.crewsDelivered;
  const winPts = won ? SCORE.winBonus : 0;
  add('Fires doused', firePts, t.firesDoused > 0 ? `${t.firesDoused}` : undefined);
  add('Structures saved', structPts, t.structuresTotal > 0 ? `${t.structuresSaved}/${t.structuresTotal}` : undefined);
  add('Crews moved', crewPts, t.crewsTotal > 0 ? `${t.crewsDelivered}/${t.crewsTotal}` : undefined);
  add('Mission complete', winPts);
  const outcome = firePts + structPts + crewPts + winPts;

  // --- Skill (win only) ----------------------------------------------------------------------
  let skill = 0;
  if (won) {
    // Precision: effective drops ÷ total drops. Needs a few drops so a lucky 1/1 isn't a perfect score.
    if (t.drops >= SCORE.precisionMinDrops) {
      const hitRate = clamp01(t.dropsEffective / t.drops);
      const pts = Math.round(SCORE.precisionMax * hitRate);
      skill += pts;
      add('Precision', pts, `${Math.round(hitRate * 100)}% hits`);
    }
    // Speed: beat par → full, decaying to 0 at parSlackMul×par. Skipped on `survive` missions, which
    // are timed by design (you CAN'T finish early).
    if (!def.objectives.some((o) => o.kind === 'survive')) {
      const par = SCORE.parBase + SCORE.parPerFire * t.firesInitial + SCORE.parPerCrew * t.crewsTotal;
      const slack = SCORE.parSlackMul * par;
      const frac = clamp01((slack - elapsed) / Math.max(1e-3, slack - par));
      const pts = Math.round(SCORE.speedMax * frac);
      skill += pts;
      add('Speed', pts, elapsed <= par ? 'beat par' : frac > 0 ? 'under time' : undefined);
    }
    // Range: fuel left in the tank — only where fuel is a real constraint (a fuelOut fail / fuel:true).
    if (usesFuel(def)) {
      const pts = Math.round(SCORE.rangeMax * clamp01(t.fuelEnd));
      skill += pts;
      add('Fuel reserve', pts, `${Math.round(clamp01(t.fuelEnd) * 100)}%`);
    }
  }

  // --- Coordination (win only) ---------------------------------------------------------------
  let coord = 0;
  if (won) {
    const pristinePts = SCORE.perPristineStructure * t.structuresPristine;
    if (pristinePts > 0) {
      coord += pristinePts;
      add('Pristine defense', pristinePts, `${t.structuresPristine}/${t.structuresTotal}`);
    }
    // Multi-front: only when the mission genuinely splits your attention AND you lost nothing.
    if (isMultiFront(def) && t.structuresLost === 0 && t.structuresTotal > 0) {
      coord += SCORE.multiFrontBonus;
      add('Multi-front', SCORE.multiFrontBonus, 'held every front');
    }
    // Flawless: everything held — every structure pristine, every crew home, no fire left to burn out.
    if (isFlawless(t)) {
      coord += SCORE.flawlessBonus;
      add('Flawless', SCORE.flawlessBonus);
    }
  }

  // --- Hardship multiplier -------------------------------------------------------------------
  const diffMul = 1 + (def.difficulty - 1) * SCORE.difficultyStep;
  const dynMul =
    1 + SCORE.hardshipPeakThreat * clamp01(t.peakThreat) + SCORE.hardshipFireLoad * clamp01(t.peakFireLoad / SCORE.hardshipFireLoadRef);
  const mul = diffMul * dynMul;
  const pre = outcome + skill + coord;
  if (mul > 1.001 && pre > 0) lines.push({ label: 'Hardship', value: mul, kind: 'mul', note: `difficulty ${def.difficulty}` });

  // --- Penalties (active, absolute) ----------------------------------------------------------
  const lostPen = SCORE.perStructureLost * t.structuresLost;
  const landPen = SCORE.hardLandingPenalty * t.hardLandings;
  const wastePen = SCORE.wastedDropPenalty * t.dropsWasted;
  sub('Structures lost', lostPen, t.structuresLost > 0 ? `${t.structuresLost}` : undefined);
  sub('Hard landings', landPen, t.hardLandings > 0 ? `${t.hardLandings}` : undefined);
  sub('Water wasted', wastePen, t.dropsWasted > 0 ? `${t.dropsWasted} drops` : undefined);
  const penalty = lostPen + landPen + wastePen;

  // --- Total + grade -------------------------------------------------------------------------
  // Clamped to [0, maxScore] so the scale stays tidy and bounded — the toughest flawless run tops
  // out near the ceiling, everything else lands below it.
  const gross = pre * mul * (won ? 1 : SCORE.lossMultiplier);
  const raw = Math.max(0, Math.round(gross) - penalty);
  const total = Math.min(SCORE.maxScore, raw);

  // Grade is the UNCLAMPED total ÷ a baseline (a bonus-free competent win at this hardship), so the
  // ceiling can't demote an S. Clearing the mission with nothing extra sits near 1.0 (a C); skill +
  // coordination push toward S, penalties drag down.
  let grade: ScoreGrade | null = null;
  if (won) {
    const baseline = Math.max(1, outcome * mul);
    grade = gradeFor(raw / baseline);
  }

  return { lines, total, grade };
}

/** Score ÷ baseline → letter grade (win only). */
export function gradeFor(ratio: number): ScoreGrade {
  if (ratio >= SCORE.gradeS) return 'S';
  if (ratio >= SCORE.gradeA) return 'A';
  if (ratio >= SCORE.gradeB) return 'B';
  if (ratio >= SCORE.gradeC) return 'C';
  return 'D';
}

/** Fuel is a real constraint when the mission opts in (`fuel:true`) or can lose on a dry tank. */
function usesFuel(def: MissionDef): boolean {
  return def.fuel === true || (def.fails ?? []).some((f) => f.kind === 'fuelOut');
}

/** A mission splits your attention: ≥2 hamlets to hold, or ≥2 separate fire complexes. */
function isMultiFront(def: MissionDef): boolean {
  const communities = def.structures?.groups?.length ?? 0;
  const fireGroups = def.fires?.length ?? 0;
  return communities >= 2 || fireGroups >= 2;
}

/** Everything held: structures pristine (if any), every crew home, and nothing left to burn out. */
function isFlawless(t: ScoreTally): boolean {
  const structuresWhole = t.structuresTotal === 0 || (t.structuresLost === 0 && t.structuresPristine === t.structuresTotal);
  const crewsWhole = t.crewsTotal === 0 || t.crewsDelivered >= t.crewsTotal;
  return structuresWhole && crewsWhole && t.firesBurnedOut === 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
