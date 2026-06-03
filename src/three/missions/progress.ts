import type { MissionDef, CompletionRecord } from './types';

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

// --- Selected-mission handoff (menu → reload → Game) ------------------------
// The menu and the end-banner buttons stash the chosen mission here, then reload;
// `main.ts` reads it to boot straight into that mission (no Three.js teardown needed).

const SEL = 'bmf.selected.v1';

export function getSelectedId(): string | null {
  try {
    return localStorage.getItem(SEL);
  } catch {
    return null;
  }
}

export function setSelectedId(id: string): void {
  try {
    localStorage.setItem(SEL, id);
  } catch {
    /* ignore */
  }
}

export function clearSelectedId(): void {
  try {
    localStorage.removeItem(SEL);
  } catch {
    /* ignore */
  }
}
