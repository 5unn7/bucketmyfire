import { computeScore } from './score';
import type {
  MissionDef,
  MissionSignals,
  MissionState,
  Objective,
  FailCondition,
  FailKind,
  TrackerItem,
  SubTask,
  LedgerEvent,
  CompletionRecord,
  ScoreBreakdown,
} from './types';

/**
 * Engine-agnostic mission evaluator + completion ledger (the campaign's brain) — numbers only,
 * no Three.js / DOM, mirroring `FireSystem`/`Structures`. `Game` builds a `MissionSignals`
 * snapshot each frame and calls `update`; this tracks completion and decides the outcome.
 *
 * Each objective/fail is a SUB-TASK. Completion is **latched**: the moment a goal is first met
 * (or a constraint first tripped) its status flips done/failed for good and the time is recorded —
 * it can't un-complete, so a momentary dip can't revoke a finished sub-task and the HUD checklist
 * is stable. A mission is **verified complete** only when every goal sub-task is latched done;
 * it's lost when any constraint latches failed. An event log captures the timeline (sub-task
 * done/failed → mission won/lost) for the HUD, `window.__game.debug`, and persistence. The final
 * score is computed once on the active→won/lost transition, reusing the `SCORE` weights.
 */
export class MissionRuntime {
  private _state: MissionState = 'active';
  private _score = 0;
  private _breakdown: ScoreBreakdown | null = null;
  private readonly subtasks: SubTask[];
  private readonly objs: (Objective | FailCondition)[]; // parallel to subtasks (same order)
  private readonly _events: LedgerEvent[] = [];

  constructor(private readonly def: MissionDef) {
    const goals = def.objectives;
    const fails = def.fails ?? [];
    this.subtasks = [
      ...goals.map((o, i) => mk(`g${i}`, 'goal', this.objectiveLabel(o))),
      ...fails.map((f, i) => mk(`c${i}`, 'constraint', this.failLabel(f))),
    ];
    this.objs = [...goals, ...fails];
  }

  get state(): MissionState {
    return this._state;
  }

  get score(): number {
    return this._score;
  }

  /** The line-itemed score + grade, computed once at the outcome (null until then). */
  get breakdown(): ScoreBreakdown | null {
    return this._breakdown;
  }

  /** Whether every GOAL sub-task is latched done (the mission's completion is verified). */
  get verified(): boolean {
    return this.subtasks.filter((t) => t.kind === 'goal').every((t) => t.status === 'done');
  }

  /** The FailKind of the first constraint that latched failed — what actually lost the mission, so
   *  Game can pick the right loss copy without re-guessing from signals. Null while still active/won. */
  get failedKind(): FailKind | null {
    for (let i = 0; i < this.subtasks.length; i++) {
      if (this.subtasks[i].kind === 'constraint' && this.subtasks[i].status === 'failed') {
        return (this.objs[i] as FailCondition).kind;
      }
    }
    return null;
  }

  /** The latched sub-task ledger (stable; statuses only ever advance pending→done/failed). */
  get tasks(): readonly SubTask[] {
    return this.subtasks;
  }

  /** Auditable timeline of latch events. */
  get events(): readonly LedgerEvent[] {
    return this._events;
  }

  /** The HUD checklist view (derived from the latched sub-tasks). */
  get tracker(): readonly TrackerItem[] {
    return this.subtasks.map((t) => ({
      label: t.label,
      current: t.current,
      target: t.target,
      timeLeft: t.timeLeft,
      done: t.status === 'done',
      failed: t.status === 'failed',
      kind: t.kind,
      completedAt: t.completedAt,
    }));
  }

  update(s: MissionSignals): void {
    if (this._state !== 'active') return;
    const now = s.elapsed;

    for (let i = 0; i < this.subtasks.length; i++) {
      const t = this.subtasks[i];
      const p = t.kind === 'goal' ? this.probeObjective(this.objs[i] as Objective, s) : this.probeFail(this.objs[i] as FailCondition, s);
      if (t.status === 'pending') {
        // Refresh live progress only while still pending; freeze the numbers once latched.
        t.current = p.current;
        t.target = p.target;
        t.timeLeft = p.timeLeft;
        if (t.kind === 'goal' && p.met) this.latch(t, 'done', now);
        else if (t.kind === 'constraint' && p.failed) this.latch(t, 'failed', now);
      }
    }

    if (this.verified) this.end('won', now, s);
    else if (this.subtasks.some((t) => t.status === 'failed')) this.end('lost', now, s);
  }

  /**
   * Append a GOAL objective at runtime — a mid-mission rescue/task that "pops up" (the `addObjective`
   * beat). It enters PENDING, so `verified` (and the win) now also waits on it. No-op once the run is
   * over, so a beat firing on the same frame the mission would otherwise end can't resurrect it — fire
   * the beat on a trigger that holds while other goals are still pending.
   */
  addObjective(o: Objective): void {
    if (this._state !== 'active') return;
    const t = mk(`g${this.subtasks.length}`, 'goal', this.objectiveLabel(o)); // monotonic id → unique
    this.subtasks.push(t);
    this.objs.push(o);
  }

  /** Build a persistable record of this run (call after a win). */
  completion(): CompletionRecord {
    const won = this._events.find((e) => e.type === 'won');
    return {
      wonAt: won?.at ?? 0,
      score: this._score,
      grade: this._breakdown?.grade ?? null,
      stars: this._breakdown?.stars ?? null,
      subtasks: this.subtasks.map((t) => ({ label: t.label, completedAt: t.completedAt ?? null })),
    };
  }

  // --- Internals -------------------------------------------------------------

  private latch(t: SubTask, status: 'done' | 'failed', at: number): void {
    t.status = status;
    t.completedAt = at;
    this._events.push({ at, type: status, id: t.id, label: t.label });
  }

  private end(state: MissionState, at: number, s: MissionSignals): void {
    this._state = state;
    this._breakdown = computeScore(this.def, state, at, s.tally);
    this._score = this._breakdown.total;
    this._events.push({ at, type: state === 'won' ? 'won' : 'lost', id: 'mission', label: this.def.name });
  }

  // --- Probes (live progress + met/failed) -----------------------------------

  private probeObjective(o: Objective, s: MissionSignals): Probe {
    switch (o.kind) {
      case 'extinguishAll':
        return { current: Math.max(0, s.firesInitial - s.firesActive), target: s.firesInitial, met: s.firesInitial > 0 && s.firesActive === 0 };
      case 'extinguishCount': {
        const target = o.n ?? 1;
        return { current: Math.min(target, s.firesDoused), target, met: s.firesDoused >= target };
      }
      case 'deliver':
      case 'evacuate': {
        const target = o.n ?? s.crewsTotal;
        return { current: s.crewsDelivered, target, met: target > 0 && s.crewsDelivered >= target };
      }
      case 'survive': {
        const secs = o.seconds ?? 0;
        return { timeLeft: Math.max(0, secs - s.elapsed), met: s.elapsed >= secs };
      }
    }
  }

  private probeFail(f: FailCondition, s: MissionSignals): Probe {
    switch (f.kind) {
      case 'protect': {
        const min = f.all ? s.structuresTotal : f.min ?? 1;
        return { current: s.structuresAlive, target: min, failed: s.structuresAlive < min };
      }
      case 'timeout': {
        const secs = f.seconds ?? 0;
        return { timeLeft: Math.max(0, secs - s.elapsed), failed: s.elapsed >= secs };
      }
      case 'fuelOut':
        return { failed: s.starved };
      case 'rescue': {
        const tolerated = f.n ?? 0; // families that may be lost before the mission fails (default 0)
        return { current: s.crewsLost, target: tolerated, failed: s.crewsLost > tolerated };
      }
    }
  }

  // --- Labels (computed once; dynamic-count goals fall back to the def's n) ---

  private objectiveLabel(o: Objective): string {
    if (o.label) return o.label;
    switch (o.kind) {
      case 'extinguishAll':
        return 'Extinguish all fires';
      case 'extinguishCount':
        return `Knock down ${o.n ?? 1} fires`;
      case 'deliver':
        return `Insert ${o.n ?? ''} crews`.replace('  ', ' ');
      case 'evacuate':
        return `Evacuate ${o.n ?? ''} crews`.replace('  ', ' ');
      case 'survive':
        return 'Hold the line';
    }
  }

  private failLabel(f: FailCondition): string {
    if (f.label) return f.label;
    switch (f.kind) {
      case 'protect':
        return f.all ? 'Protect every structure' : 'Defend the community';
      case 'timeout':
        return 'Time limit';
      case 'fuelOut':
        return "Don't run the tank dry";
      case 'rescue':
        return 'Get every family out';
    }
  }
}

interface Probe {
  current?: number;
  target?: number;
  timeLeft?: number;
  met?: boolean;
  failed?: boolean;
}

function mk(id: string, kind: 'goal' | 'constraint', label: string): SubTask {
  return { id, label, kind, status: 'pending' };
}
