import type { MissionDef, CompletionRecord } from './types';
import { isDailyId } from './daily';

/**
 * Campaign progress persistence — a tiny localStorage wrapper. The campaign unlocks linearly:
 * mission 0 is always open, and finishing mission k unlocks k+1. We also keep the best score
 * per mission for the menu. Everything degrades gracefully if storage is unavailable (private
 * mode / blocked) — the campaign just won't remember between sessions.
 */

const KEY = 'bmf.campaign.v1';

export interface Progress {
  completed: string[]; // mission ids cleared at least once
  best: Record<string, number>; // mission id → best score
  completions: Record<string, CompletionRecord>; // mission id → best run's sub-task breakdown
}

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Progress>;
      return { completed: p.completed ?? [], best: p.best ?? {}, completions: p.completions ?? {} };
    }
  } catch {
    /* storage unavailable — fall through to defaults */
  }
  return { completed: [], best: {}, completions: {} };
}

function save(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore — progress just won't persist */
  }
}

export function getProgress(): Progress {
  return load();
}

/**
 * Record a win: mark the mission completed, keep the best score, and store the run's verified
 * sub-task completion breakdown (the ledger) when it's the best score so far.
 */
export function recordWin(id: string, score: number, completion?: CompletionRecord): void {
  // Daily Burn is isolated from campaign progression: its wins never enter `completed[]`, so they
  // can't inflate the linear-unlock count that gates helicopters. Its record lives on the global
  // per-day leaderboard instead (submitScore under the daily id). See missions/daily.ts.
  if (isDailyId(id)) return;
  const p = load();
  if (!p.completed.includes(id)) p.completed.push(id);
  const isBest = !(id in p.best) || score > p.best[id];
  if (isBest) p.best[id] = score;
  if (completion && (isBest || !(id in p.completions))) p.completions[id] = completion;
  save(p);
}

/** The persisted sub-task breakdown of a mission's best run (or null if never cleared). */
export function getCompletion(id: string): CompletionRecord | null {
  return load().completions[id] ?? null;
}

/**
 * Clear ALL campaign progress — unlocks, best scores, and completion ledgers. Used by the one-time
 * storage reset when the campaign itself is RESTRUCTURED (mission ids changed), so stale ids can't
 * leave a returning pilot half-unlocked (locked missions but an inflated heli-unlock count). The
 * pilot profile / cloud link live under separate keys and are untouched.
 */
export function clearCampaign(): void {
  save({ completed: [], best: {}, completions: {} });
}

/** The full progress snapshot (for cloud-save upload). Same shape `recordWin` maintains. */
export function exportProgress(): Progress {
  return load();
}

/**
 * Fold an imported progress (a cloud restore) into the local one. Non-destructive by design: the
 * union of completed missions, the MAX best score per mission, and the completion ledger of
 * whichever side won that mission — so loading an old save can only ever ADD unlocks/scores, never
 * wipe local ones. `incoming` may be partial/untrusted (it comes off the network), so every field
 * is read defensively.
 */
export function importProgress(incoming: Partial<Progress>): void {
  const cur = load();
  const inCompleted = Array.isArray(incoming.completed) ? incoming.completed : [];
  const inBest = incoming.best && typeof incoming.best === 'object' ? incoming.best : {};
  const inCompletions = incoming.completions && typeof incoming.completions === 'object' ? incoming.completions : {};

  const out: Progress = {
    completed: Array.from(new Set([...cur.completed, ...inCompleted.filter((id) => typeof id === 'string')])),
    best: { ...cur.best },
    completions: { ...cur.completions },
  };

  for (const [id, score] of Object.entries(inBest)) {
    if (typeof score !== 'number' || !isFinite(score)) continue;
    if (!(id in out.best) || score > out.best[id]) {
      out.best[id] = score;
      if (inCompletions[id]) out.completions[id] = inCompletions[id]; // keep the winning side's ledger
    }
  }
  // Fill in any completion ledgers for missions local never recorded at all.
  for (const [id, rec] of Object.entries(inCompletions)) {
    if (rec && !(id in out.completions)) out.completions[id] = rec;
  }

  save(out);
}

/** Linear unlock: the first mission, or any whose predecessor (by index) has been completed. */
export function isUnlocked(def: MissionDef, catalog: MissionDef[]): boolean {
  if (def.index <= 0) return true;
  const prev = catalog.find((m) => m.index === def.index - 1);
  if (!prev) return true;
  return load().completed.includes(prev.id);
}

export function bestScore(id: string): number | null {
  const b = load().best[id];
  return b ?? null;
}

/**
 * Best-run star medal for a mission: 0 if never cleared, else 1..3. A completion persisted before
 * the `stars` field existed has no count — but any persisted completion means the mission was WON,
 * so it backfills to 1★ (cleared) until the player replays for a fresh rating.
 */
export function bestStars(id: string): number {
  const rec = load().completions[id];
  if (!rec) return 0;
  return rec.stars ?? 1;
}
