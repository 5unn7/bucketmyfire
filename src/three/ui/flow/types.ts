/**
 * Shared contract between the MenuFlow controller and its four screens. Each screen is a pure
 * builder `buildXScreen(ctx): HTMLElement` that reads/writes the working selection through `ctx`
 * and drives the persistent footer (the primary advance button) via `ctx.footer`. Keeping the
 * interface here (not in MenuFlow) avoids a screen ↔ controller import cycle.
 */

import type { MissionDef } from '../../missions/types';
import type { CatalogItem } from '../profile';

/** The persistent footer the controller owns; screens configure its primary button on build. */
export interface FlowFooter {
  /** Set the primary advance button's label + action (and show it). */
  setPrimary(label: string, onClick: () => void): void;
  /** Enable/disable the primary button (e.g. until a valid callsign is entered). */
  setPrimaryEnabled(on: boolean): void;
  /** Hide the primary button entirely (Screen 4 advances per-card via FLY). */
  hidePrimary(): void;
}

export interface FlowCtx {
  /** The campaign — for the mission screen + map mission-counts. */
  catalog: MissionDef[];
  /** Sorties cleared — gates heli unlocks + the pilot record. */
  cleared: number;
  /** The footer the screen drives. */
  footer: FlowFooter;
  /** Advance to the next screen. */
  goNext(): void;
  /** Step back one screen. */
  goBack(): void;
  /** Pick a mission → navigate into the game (page reload, existing router path). */
  flyMission(id: string): void;
  /** Returning-pilot shortcut → jump straight to the mission screen (no reload). */
  jumpToMissions(): void;
  /** Working aircraft selection (persisted on change). */
  currentHeli(): CatalogItem;
  selectHeli(h: CatalogItem): void;
  /** Working map selection (persisted on change). */
  currentMap(): CatalogItem;
  selectMap(m: CatalogItem): void;
  /** Commit the validated callsign into the working profile. */
  setName(name: string): void;
}
