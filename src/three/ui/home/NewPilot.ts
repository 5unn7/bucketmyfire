/**
 * NewPilotScreen — the first-run registration gate, rebuilt in the warm "dispatch" register that the
 * Home hub uses (the `.bmf-app` stylesheet) instead of the old cyan wizard. A new pilot MUST name a
 * callsign (mandatory — there is no skip) plus an optional cloud-save email, then drops straight onto
 * the Home hub — the same place returning pilots land. Aircraft / Map are chosen later from the rail,
 * so onboarding and the returning-pilot flow are one consistent surface.
 *
 * Brand law (DESIGN.md → Two registers): this is a menu surface, so focus/accent are EMBER (the
 * fight), never cockpit cyan. Single-viewport, no page scroll: one centred card that fits a phone.
 */

import { validateCallsign, MAX_CALLSIGN } from '../callsign';
import { isNameTaken, getClientId } from '../../leaderboard/client';
import { isValidEmail, isConfigured, saveToCloud } from '../../leaderboard/cloudSave';
import { openCloudSave } from '../CloudSave';
import { loadProfile, saveProfile, findItem, firstAvailable, isHeliUnlocked, missionsCleared, MAPS, HELIS } from '../profile';
import { injectHomeStyles, spawnEmbers } from './styles';
import { DEFS, FLAME, HELMET, ic } from './icons';

export class NewPilotScreen {
  private readonly root: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly emailInput: HTMLInputElement;
  private readonly msg: HTMLDivElement;
  private readonly cta: HTMLButtonElement;
  private busy = false;

  /** @param onReady called once a valid callsign is saved — main.ts opens the Home hub. */
  constructor(parent: HTMLElement, private onReady: () => void) {
    injectHomeStyles();
    this.root = document.createElement('div');
    this.root.className = 'bmf-app newpilot';
    this.root.innerHTML = DEFS + this.markup();
    parent.appendChild(this.root);

    const embers = this.root.querySelector<HTMLElement>('.embers');
    if (embers) spawnEmbers(embers, 12);

    this.nameInput = this.root.querySelector('#np-name')!;
    this.emailInput = this.root.querySelector('#np-email')!;
    this.msg = this.root.querySelector('#np-msg')!;
    this.cta = this.root.querySelector('#np-cta')!;

    this.nameInput.value = loadProfile()?.name ?? '';
    this.wire();
    this.setEnabled(this.valid());

    // Desktop only — autofocusing on touch pops the keyboard over the layout.
    if (!('ontouchstart' in window)) requestAnimationFrame(() => this.nameInput.focus());
  }

  dispose(): void {
    this.root.remove();
  }

  // ---- markup ----------------------------------------------------------------
  private markup(): string {
    const cloud = isConfigured()
      ? 'Save your progress and pick up your run on any device.'
      : 'Cloud save is offline right now — your progress stays safe on this device.';
    // Returning pilots who cleared their browser can pull their run back from the cloud (callsign +
    // email). Only offered when cloud save is actually configured — otherwise there's nothing to load.
    const load = isConfigured()
      ? `<button id="np-load" class="btn ghost block" style="margin-top:10px;">${ic('cloud')}Load a saved profile</button>`
      : '';
    return `
<div class="scene"></div><div class="embers"></div>
<div class="pad">
  <div class="reg rise d1">
    <div class="crest">
      <div class="brand">${FLAME}</div>
      <div class="wm">Dispatch · <b>New Pilot</b></div>
    </div>

    <h1>Name your callsign.</h1>
    <div class="accent"></div>
    <p class="lede">It's the name the leaderboard flies under. Pick something you'll wear.</p>

    <div class="fieldlabel">Callsign</div>
    <label class="field">
      <span class="pfx pilot">${HELMET}</span>
      <input id="np-name" type="text" maxlength="${MAX_CALLSIGN}" placeholder="Enter your callsign"
        autocomplete="off" spellcheck="false" enterkeyhint="next" aria-label="Callsign" />
    </label>
    <div id="np-msg" class="fmsg"></div>

    <div class="fieldlabel" style="margin-top:18px;">Email <span class="opt">— optional</span></div>
    <label class="field sm">
      <span class="pfx">${ic('cloud')}</span>
      <input id="np-email" type="email" maxlength="254" placeholder="you@example.com"
        autocomplete="email" inputmode="email" spellcheck="false" enterkeyhint="go" aria-label="Email" />
    </label>
    <p class="fhint">${cloud}</p>

    <button id="np-cta" class="btn primary block" style="margin-top:24px;">${ic('play')}Enter the fight</button>
    ${load}

    <p class="legal" style="margin-top:22px;">By continuing you agree to our
      <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms</a> and
      <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</p>
  </div>
</div>`;
  }

  // ---- logic -----------------------------------------------------------------
  private valid(): boolean {
    return this.nameInput.value.trim().length >= 2;
  }

  private setMsg(text: string, bad: boolean): void {
    this.msg.textContent = text;
    this.msg.className = `fmsg${bad ? ' bad' : ''}`;
  }

  private setEnabled(on: boolean): void {
    this.cta.classList.toggle('is-disabled', !on);
    this.cta.disabled = !on;
  }

  private wire(): void {
    this.nameInput.addEventListener('input', () => {
      this.setMsg('', false);
      this.setEnabled(this.valid());
    });
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.emailInput.focus();
      }
    });
    this.emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.valid()) void this.submit();
      }
    });
    this.cta.addEventListener('click', () => void this.submit());

    // "Load a saved profile" → the cloud restore modal (callsign + email). A successful restore
    // reloads the page, so main.ts re-routes a now-registered pilot straight to the Home hub.
    this.root.querySelector('#np-load')?.addEventListener('click', () => openCloudSave());
  }

  /** Persist the callsign (+ optional cloud link), then hand off to the Home hub. */
  private async submit(): Promise<void> {
    if (this.busy) return;
    const res = validateCallsign(this.nameInput.value);
    if (!res.ok) {
      this.setMsg(res.reason ?? 'Pick a different callsign.', true);
      return;
    }
    const email = this.emailInput.value.trim();
    if (email && !isValidEmail(email)) {
      this.setMsg('Enter a valid email or leave it blank.', true);
      return;
    }
    this.busy = true;
    this.setEnabled(false);
    this.setMsg('Checking name…', false);
    try {
      if (await isNameTaken(res.value, getClientId())) {
        this.setMsg(`"${res.value}" is taken — pick another.`, true);
        this.busy = false;
        this.setEnabled(true);
        return;
      }
    } catch {
      /* offline — let the name through */
    }
    this.persist(res.value);
    if (email && isValidEmail(email) && isConfigured()) {
      try {
        await saveToCloud(res.value, email);
      } catch {
        /* best-effort cloud link */
      }
    }
    this.finish();
  }

  /** Save the profile with a valid/unlocked map + heli (defaults for a brand-new pilot). */
  private persist(name: string): void {
    const cur = loadProfile();
    const savedMap = findItem(MAPS, cur?.mapId);
    const savedHeli = findItem(HELIS, cur?.heliId);
    const cleared = missionsCleared();
    saveProfile({
      name,
      mapId: savedMap?.available ? savedMap.id : firstAvailable(MAPS).id,
      heliId: savedHeli && isHeliUnlocked(savedHeli, cleared) ? savedHeli.id : firstAvailable(HELIS).id,
    });
  }

  private finish(): void {
    this.dispose();
    this.onReady();
  }
}
