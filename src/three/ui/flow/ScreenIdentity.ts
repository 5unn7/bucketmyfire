/**
 * Screen 1 — Identity. The ember grid logo, a required callsign, and an optional email (passwordless
 * cloud save). Lifts the proven validation/persist logic out of the old first-run `runWelcome` gate:
 * `validateCallsign` + async `isNameTaken`, optional `isValidEmail` → best-effort `saveToCloud`. The
 * flow's footer "Continue" button runs the submit; it stays disabled until a plausible callsign is in.
 */

import { createGridTitle } from '../GridTitle';
import { UI, FS, FW, R, el, div, setBlur } from '../theme';
import { validateCallsign, MAX_CALLSIGN } from '../callsign';
import { isNameTaken, getClientId } from '../../leaderboard/client';
import { isValidEmail, isConfigured, isCloudLinked, saveToCloud } from '../../leaderboard/cloudSave';
import { loadProfile, saveProfile, findItem, firstAvailable, isHeliUnlocked, MAPS, HELIS } from '../profile';
import { openLeaderboard } from '../Leaderboard';
import { openCloudSave } from '../CloudSave';
import { utilityChip } from '../menuShared';
import type { FlowCtx } from './types';

function flowLabel(text: string, optional = false): HTMLDivElement {
  const d = div({ fontSize: FS.label, letterSpacing: '0.18em', textTransform: 'uppercase', color: UI.accent, opacity: '0.85', fontWeight: FW.semibold, margin: '0 2px 10px' }, text);
  if (optional) d.appendChild(el('span', { color: UI.dim, fontWeight: FW.medium, textTransform: 'none', letterSpacing: '0' }, '  — optional'));
  return d;
}

function field(pin: string, input: HTMLInputElement): HTMLDivElement {
  const wrap = div({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: UI.field,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.lg,
    padding: '4px 6px 4px 16px',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  });
  setBlur(wrap);
  wrap.appendChild(el('span', { fontSize: FS.title, opacity: '0.8' }, pin));
  Object.assign(input.style, {
    flex: '1',
    minWidth: '0',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#fff',
    fontSize: FS.xl,
    fontWeight: FW.semibold,
    padding: '12px 0',
    fontFamily: 'inherit',
  } as Partial<CSSStyleDeclaration>);
  input.addEventListener('focus', () => {
    wrap.style.borderColor = UI.accentSoft;
    wrap.style.boxShadow = `0 0 0 3px ${UI.accent}1f`;
  });
  input.addEventListener('blur', () => {
    wrap.style.borderColor = UI.stroke;
    wrap.style.boxShadow = 'none';
  });
  wrap.appendChild(input);
  return wrap;
}

export function buildIdentityScreen(ctx: FlowCtx): HTMLElement {
  const root = div({ maxWidth: '560px', margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column' });

  // Utility chips, demoted to the top-right.
  const utils = div({ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '14px' });
  utils.append(
    utilityChip('🏆', 'Leaderboard', () => openLeaderboard(ctx.catalog)),
    utilityChip('☁', isCloudLinked() ? 'Saved' : 'Save', () => openCloudSave()),
  );
  root.appendChild(utils);

  // Ember grid logo + tagline.
  const hero = div({ display: 'flex', justifyContent: 'center', margin: '2px 0 8px' });
  hero.appendChild(createGridTitle('BUCKET MY FIRE'));
  root.appendChild(hero);
  root.appendChild(
    div({ textAlign: 'center', fontSize: FS.meta, letterSpacing: '0.22em', textTransform: 'uppercase', color: UI.dim, margin: '0 0 28px' }, 'Water-bomber flight sim'),
  );

  // Callsign (required).
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = MAX_CALLSIGN;
  nameInput.placeholder = 'Enter your callsign';
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.value = loadProfile()?.name ?? '';
  nameInput.setAttribute('enterkeyhint', 'next');
  root.appendChild(flowLabel('Callsign'));
  root.appendChild(field('🎖️', nameInput));
  const nameMsg = div({ fontSize: FS.meta, fontWeight: FW.semibold, minHeight: '16px', margin: '8px 2px 0', color: UI.dim });
  root.appendChild(nameMsg);

  // Email (optional).
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.maxLength = 254;
  emailInput.placeholder = 'you@example.com';
  emailInput.autocomplete = 'email';
  emailInput.spellcheck = false;
  emailInput.inputMode = 'email';
  emailInput.setAttribute('enterkeyhint', 'go');
  const emailSection = div({ marginTop: '20px' });
  emailSection.appendChild(flowLabel('Email', true));
  emailSection.appendChild(field('✉️', emailInput));
  emailSection.appendChild(
    div(
      { fontSize: FS.sm, lineHeight: '1.5', color: UI.dim, margin: '9px 2px 0' },
      isConfigured()
        ? 'Optional — save your scores forever and restore them on any device. Your email is hashed on your device (never shared). Your callsign is public on the leaderboard.'
        : 'Cloud save is offline right now — your progress is still kept safely in this browser.',
    ),
  );
  root.appendChild(emailSection);

  const setMsg = (t: string, bad: boolean): void => {
    nameMsg.textContent = t;
    nameMsg.style.color = bad ? UI.warm : UI.dim;
  };
  const valid = (): boolean => nameInput.value.trim().length >= 2;

  let busy = false;
  const submit = async (): Promise<void> => {
    if (busy) return;
    const res = validateCallsign(nameInput.value);
    if (!res.ok) {
      setMsg(res.reason ?? 'Pick a different callsign.', true);
      return;
    }
    const email = emailInput.value.trim();
    if (email && !isValidEmail(email)) {
      setMsg('Enter a valid email or leave it blank.', true);
      return;
    }
    busy = true;
    ctx.footer.setPrimaryEnabled(false);
    setMsg('Checking name…', false);
    try {
      if (await isNameTaken(res.value, getClientId())) {
        setMsg(`"${res.value}" is taken — pick another.`, true);
        busy = false;
        ctx.footer.setPrimaryEnabled(true);
        return;
      }
    } catch {
      /* offline — allow the name through */
    }
    // Persist the profile first (callsign survives even if the cloud call fails), keeping any valid
    // saved map/heli; then pin to the cloud if an email was given (best-effort, never blocks).
    const cur = loadProfile();
    const savedHeli = findItem(HELIS, cur?.heliId);
    saveProfile({
      name: res.value,
      mapId: findItem(MAPS, cur?.mapId)?.available ? (cur as { mapId: string }).mapId : firstAvailable(MAPS).id,
      heliId: savedHeli && isHeliUnlocked(savedHeli, ctx.cleared) ? savedHeli.id : firstAvailable(HELIS).id,
    });
    ctx.setName(res.value);
    if (email && isValidEmail(email) && isConfigured()) {
      try {
        await saveToCloud(res.value, email);
      } catch {
        /* best-effort cloud link */
      }
    }
    busy = false;
    ctx.goNext();
  };

  nameInput.addEventListener('input', () => {
    setMsg('', false);
    ctx.footer.setPrimaryEnabled(valid());
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
      if (valid()) void submit();
    }
  });

  // Wire the persistent footer button for this screen.
  ctx.footer.setPrimary('Continue', () => void submit());
  ctx.footer.setPrimaryEnabled(valid());

  // Desktop only — autofocusing on touch pops the keyboard over the logo.
  if (!('ontouchstart' in window)) requestAnimationFrame(() => nameInput.focus());

  return root;
}
