/**
 * MenuFlow — the guided 4-screen pre-flight wizard that is the game's home screen, replacing the
 * old single-scroll MissionSelect hub and the separate first-run identity gate.
 *
 *   ① Identity → ② Aircraft → ③ Map → ④ Mission
 *
 * It is a SINGLE-PAGE controller: screens swap in place (no reloads) and only picking a mission on
 * Screen 4 navigates into the game (via `onSelect(id)` → the router's `?m=` reload). It owns the
 * persistent chrome (brand mark, step-progress dots, Back, "Skip to missions →" for returning
 * pilots, and the primary advance button) and the working selection (callsign, heli, map), which it
 * writes straight to the profile so a FLY always boots the chosen loadout — even if the player skips
 * ahead. New AND returning pilots start at Screen 1 (the user's "full wizard every visit" choice);
 * returning pilots get the prominent skip.
 *
 * Construction mirrors the old MissionSelect: `new MenuFlow(parent, catalog, onSelect)`.
 */

import type { MissionDef } from '../../missions/types';
import {
  loadProfile,
  saveProfile,
  findItem,
  firstAvailable,
  isHeliUnlocked,
  missionsCleared,
  hasNamedProfile,
  HELIS,
  MAPS,
  type CatalogItem,
} from '../profile';
import { UI, div } from '../theme';
import { randomCallsign } from '../callsign';
import { section, creditsFooter } from '../menuShared';
import { brandMark, stepDots, primaryButton, ghostButton, fadeSwap, type StepDots, type PrimaryButton } from './chrome';
import type { FlowCtx } from './types';
import { buildIdentityScreen } from './ScreenIdentity';
import { buildAircraftScreen } from './ScreenAircraft';
import { buildMapScreen } from './ScreenMap';
import { buildMissionScreen } from './ScreenMission';

const STEPS = 4;

export class MenuFlow {
  private readonly root: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly dots: StepDots;
  private readonly primary: PrimaryButton;
  private readonly backBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly quickBtn: HTMLButtonElement;
  private readonly ctx: FlowCtx;

  private readonly catalog: MissionDef[];
  private readonly onSelect: (id: string) => void;
  private readonly cleared: number;

  private step = 0;
  private name: string;
  private selHeli: CatalogItem;
  private selMap: CatalogItem;

  constructor(parent: HTMLElement, catalog: MissionDef[], onSelect: (id: string) => void) {
    this.catalog = catalog;
    this.onSelect = onSelect;
    this.cleared = missionsCleared();

    // Working selection, seeded from any saved profile (clamped to a valid/unlocked choice).
    const saved = loadProfile();
    this.name = saved?.name ?? '';
    const sh = findItem(HELIS, saved?.heliId);
    this.selHeli = sh && isHeliUnlocked(sh, this.cleared) ? sh : firstAvailable(HELIS);
    const sm = findItem(MAPS, saved?.mapId);
    this.selMap = sm && sm.available ? sm : firstAvailable(MAPS);
    // A returning pilot who skips straight to missions still flies a valid, saved loadout. (For a
    // first-run pilot `this.name` is '', which saveProfile records but loadProfile treats as "no
    // profile" — so the identity gate on Screen 1 still applies.)
    this.persist();

    this.root = div({
      position: 'fixed',
      inset: '0',
      zIndex: '50',
      overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 0%, rgba(20,32,44,0.86), rgba(4,7,11,0.94))',
      fontFamily: UI.font,
      color: UI.text,
      padding:
        'max(16px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) ' +
        'max(40px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))',
      boxSizing: 'border-box',
    });

    // --- Chrome ---
    this.dots = stepDots(STEPS);
    this.primary = primaryButton();
    this.backBtn = ghostButton('← Back', () => this.ctx.goBack());
    this.skipBtn = ghostButton('Skip to missions →', () => this.ctx.jumpToMissions());
    // First-run "instant fly": skip the whole identity gate + wizard with an auto callsign (audit
    // FIX #10). Shown only to un-named first-time pilots on Screen 1; returning pilots use "Skip to
    // missions →" instead. The two never show together (one needs a named profile, the other not).
    this.quickBtn = ghostButton('⚡ Quick fly', () => this.quickFly());

    const header = section({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', margin: '0 auto 22px', flexWrap: 'wrap' });
    const actions = div({ display: 'flex', alignItems: 'center', gap: '8px' });
    actions.append(this.quickBtn, this.skipBtn);
    header.append(brandMark(), this.dots.el, actions);
    this.root.appendChild(header);

    this.content = div({ width: '100%' });
    this.root.appendChild(this.content);

    const footer = section({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', margin: '26px auto 0' });
    footer.append(this.backBtn, this.primary.el);
    this.root.appendChild(footer);

    this.root.appendChild(creditsFooter());

    // --- Shared context handed to every screen ---
    this.ctx = {
      catalog: this.catalog,
      cleared: this.cleared,
      footer: {
        setPrimary: (label, onClick) => {
          this.primary.show();
          this.primary.setLabel(label);
          this.primary.setAction(onClick);
        },
        setPrimaryEnabled: (on) => this.primary.setEnabled(on),
        hidePrimary: () => this.primary.hide(),
      },
      goNext: () => this.goTo(this.step + 1),
      goBack: () => this.goTo(this.step - 1),
      flyMission: (id) => this.onSelect(id),
      jumpToMissions: () => this.goTo(STEPS - 1),
      currentHeli: () => this.selHeli,
      selectHeli: (h) => {
        this.selHeli = h;
        this.persist();
      },
      currentMap: () => this.selMap,
      selectMap: (m) => {
        this.selMap = m;
        this.persist();
      },
      setName: (n) => {
        this.name = n;
        this.persist();
      },
    };

    this.render();
    parent.appendChild(this.root);
  }

  dispose(): void {
    this.root.remove();
  }

  /** Write the working selection to the profile (keeps an empty name "unnamed" — see constructor). */
  private persist(): void {
    saveProfile({ name: this.name, mapId: this.selMap.id, heliId: this.selHeli.id });
  }

  /** First-run instant-fly: stamp an auto callsign if still unnamed, then boot the campaign's first
   *  mission on the selected map — bypassing the identity gate and the rest of the wizard (FIX #10).
   *  The player can rename later from Screen 1; uniqueness is enforced only at score-submit. */
  private quickFly(): void {
    if (!this.name.trim()) {
      this.name = randomCallsign();
      this.persist();
    }
    const first = this.catalog.find((m) => (m.map ?? '') === this.selMap.id) ?? this.catalog[0];
    this.onSelect(first.id);
  }

  private goTo(step: number): void {
    this.step = Math.max(0, Math.min(STEPS - 1, step));
    this.render();
  }

  private render(): void {
    const step = this.step;
    this.dots.set(step);
    this.backBtn.style.visibility = step > 0 ? 'visible' : 'hidden';
    // Skip is for returning pilots (a real saved callsign) who aren't already on the mission screen.
    this.skipBtn.style.display = hasNamedProfile() && step < STEPS - 1 ? '' : 'none';
    // Quick fly is its mirror: first-run (un-named) pilots on Screen 1 only.
    this.quickBtn.style.display = !hasNamedProfile() && step === 0 ? '' : 'none';
    this.primary.show(); // default; a screen may hide it (the mission screen does)

    const screen =
      step === 0
        ? buildIdentityScreen(this.ctx)
        : step === 1
          ? buildAircraftScreen(this.ctx)
          : step === 2
            ? buildMapScreen(this.ctx)
            : buildMissionScreen(this.ctx);
    fadeSwap(this.content, screen);
    this.root.scrollTo({ top: 0 });
  }
}
