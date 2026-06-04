import {
  Profile,
  CatalogItem,
  MAPS,
  HELIS,
  firstAvailable,
  findItem,
  loadProfile,
  saveProfile,
  isHeliUnlocked,
  missionsCleared,
} from './profile';
import { makeIcon } from './icons';
import { validateCallsign, MAX_CALLSIGN } from './callsign';
import { isNameTaken, getClientId } from '../leaderboard/client';
import { isValidEmail, isConfigured, saveToCloud } from '../leaderboard/cloudSave';

/**
 * Interactive onboarding screen (v1). A full-screen DOM overlay — same
 * glass-cockpit visual language as the HUD — shown before the game boots:
 *
 *   - First-time pilots get the full picker: enter a CALLSIGN, choose a MAP,
 *     choose a HELICOPTER, then START.
 *   - Returning pilots (a profile cached in the browser) get a "Welcome back"
 *     quick-start: one big FLY button, plus a "Change details" link that
 *     reopens the full picker pre-filled.
 *
 * It owns no Three.js — pure HTML/CSS over the canvas, like the HUD. The choice
 * is persisted to localStorage (see profile.ts) so the next visit skips ahead.
 *
 * `runOnboarding()` resolves with the chosen Profile and tears the overlay down;
 * main.ts awaits it, then builds the Game. A `?autostart` URL param bypasses the
 * whole screen with the saved-or-default profile, so the headless QA harness
 * (which drives window.__game) still boots straight into the world.
 */

const ACCENT = '#67e8ff'; // shared cockpit cyan (matches HUD)

/** Bypass the screen for headless QA / deep links: /?autostart */
export function shouldAutostart(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('autostart');
  } catch {
    return false;
  }
}

/** The profile used when onboarding is skipped (saved if present, else defaults). */
export function defaultProfile(): Profile {
  return (
    loadProfile() ?? {
      name: 'Pilot',
      mapId: firstAvailable(MAPS).id,
      heliId: firstAvailable(HELIS).id,
    }
  );
}

// One-time stylesheet injection (classes are crisper than inline for hover /
// active / keyframes / media queries, and keep the builder below readable).
let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const css = `
  .bmf-ob {
    position: fixed; inset: 0; z-index: 50;
    display: flex; align-items: flex-start; justify-content: center;
    overflow-y: auto; -webkit-overflow-scrolling: touch;
    padding: max(24px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right))
             max(40px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
    box-sizing: border-box;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: rgba(255,255,255,0.94);
    background:
      radial-gradient(120% 80% at 50% -10%, rgba(103,232,255,0.10), transparent 60%),
      radial-gradient(140% 90% at 80% 110%, rgba(255,122,69,0.10), transparent 55%),
      linear-gradient(180deg, #0b1a14 0%, #0a1410 60%, #0e160f 100%);
    animation: bmf-fade 0.4s ease both;
  }
  .bmf-ob * { box-sizing: border-box; }
  @keyframes bmf-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes bmf-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

  .bmf-panel { width: 100%; max-width: 880px; margin: auto 0; animation: bmf-rise 0.45s ease both; }
  .bmf-brand { text-align: center; margin-bottom: 22px; }
  .bmf-title {
    margin: 0; font-size: clamp(30px, 7vw, 52px); font-weight: 800; letter-spacing: 0.04em;
    line-height: 1.0;
    background: linear-gradient(180deg, #ffffff, #9fe9f7);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    text-shadow: 0 0 28px rgba(103,232,255,0.18);
  }
  .bmf-title .em { color: #ff7a45; -webkit-text-fill-color: #ff7a45; }
  .bmf-sub { margin: 8px 0 0; font-size: 13px; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255,255,255,0.45); }

  .bmf-label { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: ${ACCENT}; opacity: 0.85; margin: 0 0 10px; font-weight: 600; }
  .bmf-section { margin-top: 24px; }

  .bmf-namewrap {
    display: flex; align-items: center; gap: 12px;
    background: rgba(14,20,27,0.5); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px; padding: 4px 6px 4px 16px;
    backdrop-filter: blur(12px) saturate(120%); -webkit-backdrop-filter: blur(12px) saturate(120%);
    box-shadow: 0 6px 28px rgba(0,0,0,0.32);
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .bmf-namewrap:focus-within { border-color: rgba(103,232,255,0.55); box-shadow: 0 0 0 3px rgba(103,232,255,0.12), 0 6px 28px rgba(0,0,0,0.32); }
  .bmf-namewrap .pin { font-size: 18px; opacity: 0.8; }
  .bmf-input {
    flex: 1; min-width: 0; background: transparent; border: none; outline: none;
    color: #fff; font-size: 19px; font-weight: 600; letter-spacing: 0.01em;
    padding: 12px 0; font-family: inherit;
    touch-action: auto; -webkit-user-select: text; user-select: text;
  }
  .bmf-input::placeholder { color: rgba(255,255,255,0.32); font-weight: 500; }

  .bmf-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 620px) { .bmf-cards { grid-template-columns: 1fr; } }

  .bmf-card {
    position: relative; text-align: left; cursor: pointer;
    background: rgba(14,20,27,0.46); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 16px; padding: 0; overflow: hidden; color: inherit;
    font-family: inherit; display: flex; flex-direction: column;
    backdrop-filter: blur(12px) saturate(120%); -webkit-backdrop-filter: blur(12px) saturate(120%);
    box-shadow: 0 6px 28px rgba(0,0,0,0.32);
    transition: transform 0.15s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .bmf-card:hover:not(.is-soon) { transform: translateY(-3px); border-color: rgba(255,255,255,0.22); }
  .bmf-card.is-selected { border-color: ${ACCENT}; box-shadow: 0 0 0 2px rgba(103,232,255,0.55), 0 10px 34px rgba(0,0,0,0.4); }
  .bmf-card.is-soon { cursor: not-allowed; opacity: 0.5; filter: saturate(0.55); }

  .bmf-art { height: 104px; display: flex; align-items: center; justify-content: center; }
  .bmf-art svg { width: 100px; height: 100px; filter: drop-shadow(0 6px 10px rgba(0,0,0,0.4)); }
  .bmf-cardbody { padding: 12px 14px 14px; }
  .bmf-cardname { font-size: 17px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 8px; }
  .bmf-cardtag { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${ACCENT}; opacity: 0.8; margin: 3px 0 0; }
  .bmf-cardblurb { font-size: 12.5px; line-height: 1.45; color: rgba(255,255,255,0.6); margin: 9px 0 0; }

  .bmf-check {
    position: absolute; top: 10px; right: 10px; width: 22px; height: 22px; border-radius: 50%;
    background: ${ACCENT}; color: #06222a; font-size: 13px; font-weight: 800;
    display: none; align-items: center; justify-content: center;
    box-shadow: 0 0 14px rgba(103,232,255,0.6);
  }
  .bmf-card.is-selected .bmf-check { display: flex; }
  .bmf-soon {
    position: absolute; top: 10px; right: 10px; padding: 3px 8px; border-radius: 999px;
    font-size: 9px; letter-spacing: 0.14em; font-weight: 700; text-transform: uppercase;
    background: rgba(255,255,255,0.14); color: rgba(255,255,255,0.85);
  }

  .bmf-specs { margin-top: 12px; display: grid; gap: 6px; }
  .bmf-spec { display: grid; grid-template-columns: 52px 1fr; align-items: center; gap: 8px; }
  .bmf-spec span { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.5); }
  .bmf-spectrack { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.12); overflow: hidden; }
  .bmf-specfill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, ${ACCENT}, #9fe9f7); }

  .bmf-btn {
    width: 100%; margin-top: 28px; padding: 17px 20px; border-radius: 16px; border: none;
    font-family: inherit; font-size: 17px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
    cursor: pointer; color: #04181d;
    background: linear-gradient(180deg, #8df0ff, ${ACCENT});
    box-shadow: 0 10px 30px rgba(103,232,255,0.28); transition: transform 0.12s, box-shadow 0.2s, opacity 0.2s;
  }
  .bmf-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 14px 38px rgba(103,232,255,0.38); }
  .bmf-btn:active:not(:disabled) { transform: translateY(0); }
  .bmf-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; filter: grayscale(0.4); }

  .bmf-link {
    display: block; margin: 16px auto 0; padding: 8px; background: none; border: none;
    color: rgba(255,255,255,0.5); font-family: inherit; font-size: 13px; cursor: pointer;
    text-decoration: underline; text-underline-offset: 3px;
  }
  .bmf-link:hover { color: ${ACCENT}; }

  /* Welcome-back view */
  .bmf-welcome { text-align: center; }
  .bmf-hello { font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255,255,255,0.45); margin: 0 0 6px; }
  .bmf-name { font-size: clamp(28px, 7vw, 46px); font-weight: 800; margin: 0; }
  .bmf-loadout { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin: 24px 0 4px; }
  .bmf-chip {
    display: flex; align-items: center; gap: 10px; text-align: left;
    background: rgba(14,20,27,0.46); border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px; padding: 10px 16px 10px 12px;
    backdrop-filter: blur(12px) saturate(120%); -webkit-backdrop-filter: blur(12px) saturate(120%);
  }
  .bmf-chip .g { width: 46px; height: 46px; flex: none; }
  .bmf-chip .g svg { width: 46px; height: 46px; display: block; }
  .bmf-chip .k { font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: ${ACCENT}; opacity: 0.8; }
  .bmf-chip .v { font-size: 15px; font-weight: 700; margin-top: 1px; }

  /* First-run welcome (callsign required + optional email) */
  .bmf-optional { color: rgba(255,255,255,0.4); font-weight: 500; text-transform: none; letter-spacing: 0; margin-left: 6px; }
  .bmf-help { font-size: 12.5px; line-height: 1.5; color: rgba(255,255,255,0.48); margin: 9px 2px 0; }
  .bmf-msg { font-size: 12.5px; font-weight: 600; min-height: 16px; margin: 8px 2px 0; color: rgba(255,255,255,0.5); }
  `;
  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.appendChild(tag);
}

// --- tiny DOM helper --------------------------------------------------------
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

function specMeter(spec: { label: string; value: number }): HTMLElement {
  const fill = h('div', { className: 'bmf-specfill' });
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, spec.value)) * 100)}%`;
  return h('div', { className: 'bmf-spec' }, [
    h('span', { textContent: spec.label }),
    h('div', { className: 'bmf-spectrack' }, [fill]),
  ]);
}

/**
 * Run the onboarding flow. Resolves with the chosen profile once the pilot hits
 * START (full picker) or FLY (welcome-back), after tearing the overlay down.
 */
export function runOnboarding(): Promise<Profile> {
  injectStyles();

  return new Promise<Profile>((resolve) => {
    const saved = loadProfile();
    const cleared = missionsCleared(); // campaign progress gates which helis are flyable

    // Working selection — pre-filled from a saved profile when present.
    let selMap: CatalogItem = findItem(MAPS, saved?.mapId) ?? firstAvailable(MAPS);
    let selHeli: CatalogItem = findItem(HELIS, saved?.heliId) ?? firstAvailable(HELIS);
    if (!selMap.available) selMap = firstAvailable(MAPS);
    if (!isHeliUnlocked(selHeli, cleared)) selHeli = firstAvailable(HELIS);

    const overlay = h('div', { className: 'bmf-ob' });
    document.body.appendChild(overlay);

    const finish = (name: string): void => {
      const profile: Profile = { name: name.trim().slice(0, 24) || 'Pilot', mapId: selMap.id, heliId: selHeli.id };
      saveProfile(profile);
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s ease';
      window.setTimeout(() => overlay.remove(), 300);
      resolve(profile);
    };

    // --- Full picker view ---------------------------------------------------
    const renderPicker = (presetName: string): void => {
      overlay.replaceChildren();

      const brand = h('div', { className: 'bmf-brand' }, [
        ((): HTMLElement => {
          const t = h('h1', { className: 'bmf-title' });
          t.innerHTML = 'BUCKET MY <span class="em">FIRE</span>';
          return t;
        })(),
        h('p', { className: 'bmf-sub', textContent: 'Water-bomber flight sim' }),
      ]);

      // Callsign
      const input = h('input', {
        className: 'bmf-input',
        type: 'text',
        value: presetName,
        placeholder: 'Enter your callsign',
        maxLength: 24,
        autocomplete: 'off',
        spellcheck: false,
      });
      input.setAttribute('enterkeyhint', 'go');
      const nameSection = h('div', {}, [
        h('p', { className: 'bmf-label', textContent: 'Callsign' }),
        h('div', { className: 'bmf-namewrap' }, [h('span', { className: 'pin', textContent: '🎖️' }), input]),
      ]);

      const startBtn = h('button', { className: 'bmf-btn', type: 'button', textContent: 'Start mission' });

      const updateValid = (): void => {
        startBtn.disabled = input.value.trim().length === 0 || !selMap.available || !isHeliUnlocked(selHeli, cleared);
      };

      // Card builder bound to a selection slot. `gate` decides per-item whether the card is
      // pickable and, if not, the badge text — maps gate on `available` ("Soon"), helis on
      // campaign progress ("🔒 Mission N"). Defaults to the available/Soon behaviour.
      const buildCards = (
        catalog: CatalogItem[],
        getSel: () => CatalogItem,
        setSel: (c: CatalogItem) => void,
        gate: (item: CatalogItem) => { usable: boolean; lockText: string } = (i) => ({
          usable: i.available,
          lockText: 'Soon',
        }),
      ): HTMLElement => {
        const grid = h('div', { className: 'bmf-cards' });
        const cards = catalog.map((item) => {
          const art = h('div', { className: 'bmf-art' }, [makeIcon(item.id)]);
          art.style.background = `radial-gradient(120% 100% at 50% 28%, ${item.accent}3a, transparent 72%)`;

          const nameRow = h('p', { className: 'bmf-cardname', textContent: item.name });
          const body = h('div', { className: 'bmf-cardbody' }, [
            nameRow,
            h('p', { className: 'bmf-cardtag', textContent: item.tagline }),
            h('p', { className: 'bmf-cardblurb', textContent: item.blurb }),
          ]);
          if (item.specs) {
            body.append(h('div', { className: 'bmf-specs' }, item.specs.map(specMeter)));
          }

          const { usable, lockText } = gate(item);
          const card = h('button', { className: 'bmf-card', type: 'button' }, [art, body]);
          card.append(
            usable
              ? h('div', { className: 'bmf-check', textContent: '✓' })
              : h('div', { className: 'bmf-soon', textContent: lockText }),
          );
          if (usable) {
            card.addEventListener('click', () => {
              setSel(item);
              for (const c of cards) c.el.classList.toggle('is-selected', c.item === item);
              updateValid();
            });
          } else {
            card.classList.add('is-soon');
            // A locked-but-real airframe explains itself on hover; "Soon" content stays mute.
            if (item.available && item.unlockAfter) card.title = `Unlocks after clearing Mission ${item.unlockAfter}`;
          }
          if (item === getSel()) card.classList.add('is-selected');
          return { el: card, item };
        });
        for (const c of cards) grid.append(c.el);
        return grid;
      };

      const mapSection = h('div', { className: 'bmf-section' }, [
        h('p', { className: 'bmf-label', textContent: 'Choose your map' }),
        buildCards(MAPS, () => selMap, (c) => (selMap = c)),
      ]);
      const heliSection = h('div', { className: 'bmf-section' }, [
        h('p', { className: 'bmf-label', textContent: 'Choose your helicopter' }),
        buildCards(HELIS, () => selHeli, (c) => (selHeli = c), (item) => ({
          usable: isHeliUnlocked(item, cleared),
          lockText: item.available ? `🔒 Mission ${item.unlockAfter}` : 'Soon',
        })),
      ]);

      startBtn.addEventListener('click', () => {
        if (!startBtn.disabled) finish(input.value);
      });
      input.addEventListener('input', updateValid);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !startBtn.disabled) finish(input.value);
      });

      const panel = h('div', { className: 'bmf-panel' }, [brand, nameSection, mapSection, heliSection, startBtn]);
      overlay.append(panel);
      updateValid();
      // Don't autofocus on touch (pops the keyboard over the cards); desktop only.
      if (!('ontouchstart' in window) && !presetName) input.focus();
    };

    // --- Welcome-back view --------------------------------------------------
    const renderWelcome = (profile: Profile): void => {
      overlay.replaceChildren();
      const map = findItem(MAPS, profile.mapId) ?? selMap;
      const heli = findItem(HELIS, profile.heliId) ?? selHeli;

      const chip = (kind: string, item: CatalogItem): HTMLElement =>
        h('div', { className: 'bmf-chip' }, [
          h('div', { className: 'g' }, [makeIcon(item.id)]),
          h('div', {}, [
            h('div', { className: 'k', textContent: kind }),
            h('div', { className: 'v', textContent: item.name }),
          ]),
        ]);

      const flyBtn = h('button', { className: 'bmf-btn', type: 'button', textContent: '🚁  Fly' });
      flyBtn.addEventListener('click', () => finish(profile.name));

      const changeBtn = h('button', { className: 'bmf-link', type: 'button', textContent: 'Change details' });
      changeBtn.addEventListener('click', () => renderPicker(profile.name));

      const panel = h('div', { className: 'bmf-panel bmf-welcome' }, [
        h('p', { className: 'bmf-hello', textContent: 'Welcome back' }),
        h('h1', { className: 'bmf-name', textContent: profile.name }),
        h('div', { className: 'bmf-loadout' }, [chip('Map', map), chip('Helicopter', heli)]),
        flyBtn,
        changeBtn,
      ]);
      overlay.append(panel);
    };

    if (saved) renderWelcome(saved);
    else renderPicker('');
  });
}

/**
 * First-run IDENTITY gate (launch requirement: "every player must have a name to begin"). A focused
 * full-screen welcome shown once, before the menu, when no named profile exists yet:
 *
 *   - CALLSIGN (required) — validated + a best-effort duplicate-name check; START stays disabled
 *     until it's usable. This is the name the leaderboard submits under, so we capture it up front
 *     instead of letting a player fly anonymously as "Pilot".
 *   - EMAIL (optional)    — if given, we pin progress to the cloud (passwordless, hashed in-browser;
 *     see leaderboard/cloudSave.ts) so scores survive a cleared cache or a device switch. Blank is
 *     fine — the game is fully playable without it.
 *
 * Resolves once the pilot starts; the profile is persisted (and optionally cloud-linked) by then, so
 * the menu reads a real callsign. The `?autostart`/`?qa` headless paths bypass this entirely (main.ts).
 */
export function runWelcome(): Promise<void> {
  injectStyles();

  return new Promise<void>((resolve) => {
    const overlay = h('div', { className: 'bmf-ob' });
    document.body.appendChild(overlay);

    const brand = h('div', { className: 'bmf-brand' }, [
      ((): HTMLElement => {
        const t = h('h1', { className: 'bmf-title' });
        t.innerHTML = 'BUCKET MY <span class="em">FIRE</span>';
        return t;
      })(),
      h('p', { className: 'bmf-sub', textContent: 'Water-bomber flight sim' }),
    ]);

    // Callsign (required)
    const nameInput = h('input', {
      className: 'bmf-input',
      type: 'text',
      placeholder: 'Enter your callsign',
      maxLength: MAX_CALLSIGN,
      autocomplete: 'off',
      spellcheck: false,
    });
    nameInput.setAttribute('enterkeyhint', 'next');
    const nameMsg = h('p', { className: 'bmf-msg' });
    const setNameMsg = (text: string, bad: boolean): void => {
      nameMsg.textContent = text;
      nameMsg.style.color = bad ? '#ff7a45' : 'rgba(255,255,255,0.5)';
    };
    const nameSection = h('div', { className: 'bmf-section' }, [
      h('p', { className: 'bmf-label', textContent: 'Callsign' }),
      h('div', { className: 'bmf-namewrap' }, [h('span', { className: 'pin', textContent: '🎖️' }), nameInput]),
      nameMsg,
    ]);

    // Email (optional)
    const emailInput = h('input', {
      className: 'bmf-input',
      type: 'email',
      placeholder: 'you@example.com',
      maxLength: 254,
      autocomplete: 'email',
      spellcheck: false,
    });
    emailInput.inputMode = 'email';
    emailInput.setAttribute('enterkeyhint', 'go');
    const emailLabel = h('p', { className: 'bmf-label' });
    emailLabel.innerHTML = 'Email <span class="bmf-optional">— optional</span>';
    const emailHelp = isConfigured()
      ? 'Optional — save your scores forever and restore them on any device. Your email is hashed on your device (never shared), used only to sync progress. Your callsign is public on the leaderboard.'
      : 'Cloud save is offline right now — your progress is still kept safely in this browser.';
    const emailSection = h('div', { className: 'bmf-section' }, [
      emailLabel,
      h('div', { className: 'bmf-namewrap' }, [h('span', { className: 'pin', textContent: '✉️' }), emailInput]),
      h('p', { className: 'bmf-help', textContent: emailHelp }),
    ]);

    const startBtn = h('button', { className: 'bmf-btn', type: 'button', textContent: 'Start flying' });
    const updateValid = (): void => {
      startBtn.disabled = nameInput.value.trim().length < 2;
    };

    let busy = false;
    const submit = async (): Promise<void> => {
      if (busy) return;
      const res = validateCallsign(nameInput.value);
      if (!res.ok) {
        setNameMsg(res.reason ?? 'Pick a different callsign.', true);
        return;
      }
      const email = emailInput.value.trim();
      if (email && !isValidEmail(email)) {
        setNameMsg('Enter a valid email or leave it blank.', true);
        return;
      }
      busy = true;
      startBtn.disabled = true;
      startBtn.textContent = 'Saving…';
      // Best-effort, fail-open duplicate-name check (skip when the board is offline / it errors).
      try {
        if (await isNameTaken(res.value, getClientId())) {
          setNameMsg(`"${res.value}" is taken — pick another.`, true);
          busy = false;
          startBtn.textContent = 'Start flying';
          updateValid();
          return;
        }
      } catch {
        /* offline — allow the name through */
      }
      // Persist the profile first so the callsign survives even if the cloud call fails, then pin to
      // the cloud when an email was given (best-effort — never blocks starting the game).
      saveProfile({ name: res.value, mapId: firstAvailable(MAPS).id, heliId: firstAvailable(HELIS).id });
      if (email && isValidEmail(email) && isConfigured()) {
        try {
          await saveToCloud(res.value, email);
        } catch {
          /* best-effort cloud link */
        }
      }
      finish();
    };
    const finish = (): void => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s ease';
      window.setTimeout(() => overlay.remove(), 300);
      resolve();
    };

    startBtn.addEventListener('click', () => void submit());
    nameInput.addEventListener('input', () => {
      setNameMsg('', false);
      updateValid();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        emailInput.focus();
      }
    });
    emailInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void submit();
      }
    });

    overlay.append(h('div', { className: 'bmf-panel' }, [brand, nameSection, emailSection, startBtn]));
    updateValid();
    // Desktop only — autofocusing on touch pops the keyboard over the screen.
    if (!('ontouchstart' in window)) nameInput.focus();
  });
}
