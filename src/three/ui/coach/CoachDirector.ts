/**
 * CoachDirector — the interactive first-flight tutorial as a PURE state machine. It teaches the core
 * loop by DOING: a short linear sequence of steps (fly → steer → scoop → fill → approach → drop →
 * repeat), each advancing the moment the pilot actually performs the move. No DOM, no THREE — it reads
 * a per-frame `CoachSignals` snapshot that `Game` already computes and returns a `CoachState` the
 * `CoachOverlay` renders. Node-checkable like the `sim/*` modules (no localStorage, no Date.now,
 * no Math.random — all timing is dt-accumulated so it's frame-rate independent and determinism-safe).
 *
 * It NEVER freezes the sim or disables a control. If the pilot ignores the coach and just flies, every
 * step auto-completes as they naturally do the loop, and the coach reaches `complete` on its own.
 * Persistence (markTutorialDone) and the skip flag live in the host (`coachStore.ts`) so this stays pure.
 */

export type HighlightId = 'stick' | 'climb' | 'descend' | 'drop';

/** The per-frame snapshot Game feeds the director — all values it already computes in `update()`. */
export interface CoachSignals {
  dt: number; // seconds since last frame (clamped by the main loop)
  engineStarted: boolean; // rotors up — the coach picks up AFTER the cold-start ritual
  inBriefing: boolean; // briefing card still showing
  frozen: boolean; // won || lost || crashed || !engineStarted — nothing to coach
  speed: number; // horizontal airspeed (world units/s)
  yawRate: number; // |control.turn| this frame — "did they steer?"
  overWater: boolean; // bucket/heli over a scoopable lake
  scooping: boolean; // bucket actively filling
  water: number; // current bucket water
  capacity: number; // bucket capacity
  dropping: boolean; // a water drop fired this frame
  firesLeft: number; // active fires remaining
  won: boolean;
  lost: boolean;
}

export interface CoachPrompt {
  id: string; // step id — the overlay diffs/animates only when this changes
  index: number; // 1-based step number (for the "2 / 7" counter)
  count: number; // total steps
  title: string;
  body: string; // one short instruction line
  tone: 'cyan' | 'water' | 'fire';
  highlight: HighlightId | null; // which on-screen control to spotlight
  progress: number | null; // 0..1 for steps with a gauge (the fill step), else null
  done: boolean; // complete-condition satisfied this frame — overlay plays the tick
}

export type CoachState =
  | { kind: 'inactive' }
  | { kind: 'running'; prompt: CoachPrompt }
  | { kind: 'complete' };

/** The completion sign-off the overlay shows briefly before fading (kept here so all coach copy lives together). */
export const COACH_COMPLETE = "You've got it. Go fight the fire.";

// UI-pacing constants (not gameplay feel — local consts are fine). dt-accumulated holds debounce a
// one-frame blip so a momentary `dropping`/`overWater` flicker can't skip a step.
const FLY_SPEED_MIN = 5; // units/s that reads as "moving" (cruise cap is 30)
const YAW_MIN = 0.15; // |turn| that reads as a deliberate steer
const FILL_FULL = 0.98; // bucket counts as full at 98% (the last drips lag)

interface Step {
  id: string;
  title: string;
  body: string;
  tone: 'cyan' | 'water' | 'fire';
  highlight: HighlightId | null;
  hold: number; // seconds the complete-condition must persist before advancing
  progress?: (s: CoachSignals, firesAtStart: number) => number;
  complete: (s: CoachSignals, firesAtStart: number) => boolean;
}

const STEPS: Step[] = [
  {
    id: 'fly',
    title: 'Fly',
    body: 'Push the stick to move. Ease off early.',
    tone: 'cyan',
    highlight: 'stick',
    hold: 0.3,
    complete: (s) => s.speed > FLY_SPEED_MIN,
  },
  {
    id: 'steer',
    title: 'Steer',
    body: 'Find a lake on the radar. Blue. Head for it.',
    tone: 'cyan',
    highlight: 'stick',
    hold: 0.2,
    // Soft: a confident pilot who beelines over water satisfies it without a deliberate yaw.
    complete: (s) => s.yawRate > YAW_MIN || s.overWater,
  },
  {
    id: 'descend',
    title: 'Scoop',
    body: 'Over the water. Hold down to dip the bucket in.',
    tone: 'water',
    highlight: 'descend',
    hold: 0,
    complete: (s) => s.scooping,
  },
  {
    id: 'fill',
    title: 'Fill',
    body: 'Stay low. Let it fill.',
    tone: 'water',
    highlight: 'descend',
    hold: 0,
    progress: (s) => (s.capacity > 0 ? s.water / s.capacity : 0),
    complete: (s) => s.capacity > 0 && s.water >= s.capacity * FILL_FULL,
  },
  {
    id: 'dropApproach',
    title: 'Attack',
    body: 'Climb out. Take it to the fire. Red on the radar.',
    tone: 'fire',
    highlight: 'climb',
    hold: 0.4,
    complete: (s) => !s.overWater && s.water > 0,
  },
  {
    id: 'drop',
    title: 'Drop',
    body: 'Line up over the flames. Hit DROP.',
    tone: 'fire',
    highlight: 'drop',
    hold: 0,
    complete: (s) => s.dropping,
  },
  {
    id: 'repeat',
    title: 'Keep at it',
    body: "Knocked down. Refill and keep at it till they're out.",
    tone: 'cyan',
    highlight: null,
    hold: 0,
    complete: (s, firesAtStart) => firesAtStart > 0 && s.firesLeft < firesAtStart,
  },
];

export class CoachDirector {
  private idx = 0;
  private holdT = 0; // dt-accumulated time the current step's complete-condition has held
  private firesAtStart = -1; // latched on the first live frame
  private done = false;
  private skipped = false;

  /** @param enabled false → the director is inert (returns `inactive` forever). Game gates this on
   *  `!tutorialDone() && first campaign mission && !disableCoach`. */
  constructor(private readonly enabled: boolean) {}

  get active(): boolean {
    return this.enabled && !this.done && !this.skipped;
  }

  /** Jump straight to complete (the "Skip tutorial" button). */
  skip(): void {
    this.skipped = true;
  }

  update(s: CoachSignals): CoachState {
    if (!this.enabled || this.skipped) return { kind: 'inactive' };
    if (this.done) return { kind: 'complete' };

    // Latch the starting fire count once the mission is live (engine up, briefing gone).
    if (this.firesAtStart < 0 && s.engineStarted && !s.inBriefing) this.firesAtStart = s.firesLeft;

    // Won the mission outright → the loop is taught, wrap up.
    if (s.won) {
      this.done = true;
      return { kind: 'complete' };
    }

    // Frozen (cold-start not done, briefing up, crashed/lost) → hold quietly; the normal HUD takes over.
    if (s.frozen || s.inBriefing || !s.engineStarted) return { kind: 'inactive' };

    const step = STEPS[this.idx];
    const satisfied = step.complete(s, this.firesAtStart);

    // Debounce: the complete-condition must persist for `hold` seconds (dt-accumulated) before advancing.
    if (satisfied) {
      this.holdT += s.dt;
      if (this.holdT >= step.hold) {
        this.idx++;
        this.holdT = 0;
        if (this.idx >= STEPS.length) {
          this.done = true;
          return { kind: 'complete' };
        }
      }
    } else {
      this.holdT = 0;
    }

    const cur = STEPS[this.idx];
    return {
      kind: 'running',
      prompt: {
        id: cur.id,
        index: this.idx + 1,
        count: STEPS.length,
        title: cur.title,
        body: cur.body,
        tone: cur.tone,
        highlight: cur.highlight,
        progress: cur.progress ? clamp01(cur.progress(s, this.firesAtStart)) : null,
        done: cur.complete(s, this.firesAtStart),
      },
    };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
