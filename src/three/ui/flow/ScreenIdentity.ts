/**
 * Screen 1 — Identity. New pilot registration: a required callsign and an optional cloud-save email.
 *
 * Brand register: focus/accent states use ember (warm), not cyan — menu surfaces are the fight,
 * the cockpit stays cool. (DESIGN.md → Two registers.)
 */

import { UI, FS, FW, R, el, div } from '../theme';
import { validateCallsign, MAX_CALLSIGN } from '../callsign';
import { isNameTaken, getClientId } from '../../leaderboard/client';
import { isValidEmail, isConfigured, saveToCloud } from '../../leaderboard/cloudSave';
import { loadProfile, saveProfile, findItem, firstAvailable, isHeliUnlocked, MAPS, HELIS } from '../profile';
import type { FlowCtx } from './types';

/** Uppercase field label in the warm/ember register for brand surfaces. */
function fieldLabel(text: string, optional = false): HTMLDivElement {
  const d = div(
    {
      fontSize: FS.label,
      letterSpacing: '0.20em',
      textTransform: 'uppercase',
      fontWeight: FW.bold,
      color: UI.ember,
      margin: '0 0 8px',
    },
    text,
  );
  if (optional) {
    d.appendChild(
      el(
        'span',
        { color: UI.faint, fontWeight: FW.medium, textTransform: 'none', letterSpacing: '0', fontSize: FS.sm },
        ' — optional',
      ),
    );
  }
  return d;
}

/**
 * A styled text input with an ember focus ring — warm register for brand/menu surfaces.
 * Accepts `size` to set font-size + vertical padding so the name field is larger than the email.
 */
function inputField(
  input: HTMLInputElement,
  size: 'lg' | 'md' = 'lg',
): HTMLDivElement {
  const wrap = div({
    display: 'flex',
    alignItems: 'center',
    background: UI.field,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.lg,
    padding: '0 16px',
    transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
  });

  const fontSize = size === 'lg' ? FS.xl : FS.md;
  const fontWeight = size === 'lg' ? FW.semibold : FW.medium;
  const padding = size === 'lg' ? '14px 0' : '11px 0';

  Object.assign(input.style, {
    flex: '1',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#fff',
    fontSize,
    fontWeight,
    padding,
    fontFamily: 'inherit',
  } as Partial<CSSStyleDeclaration>);

  input.addEventListener('focus', () => {
    wrap.style.borderColor = UI.ember;
    wrap.style.boxShadow = `0 0 0 3px ${UI.ember}28, 0 2px 16px ${UI.ember}14`;
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

  // — Header: registration moment —
  root.appendChild(
    div(
      { fontSize: FS.hero, fontWeight: FW.black, letterSpacing: '-0.01em', color: UI.text, marginBottom: '8px' },
      'New Pilot',
    ),
  );

  // Ember accent bar
  root.appendChild(
    div({
      height: '3px',
      width: '42px',
      background: `linear-gradient(90deg, ${UI.ember} 0%, ${UI.emberHi} 100%)`,
      borderRadius: R.pill,
      marginBottom: '10px',
    }),
  );

  root.appendChild(
    div(
      { fontSize: FS.body, color: UI.dim, lineHeight: '1.5', marginBottom: '30px' },
      'Choose a callsign. This is the name the leaderboard flies under.',
    ),
  );

  // — Callsign (required) —
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = MAX_CALLSIGN;
  nameInput.placeholder = 'Enter your callsign';
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.value = loadProfile()?.name ?? '';
  nameInput.setAttribute('enterkeyhint', 'next');

  root.appendChild(fieldLabel('Callsign'));
  root.appendChild(inputField(nameInput, 'lg'));

  const nameMsg = div({
    fontSize: FS.meta,
    fontWeight: FW.semibold,
    minHeight: '18px',
    margin: '7px 0 26px',
    color: UI.dim,
  });
  root.appendChild(nameMsg);

  // — Email (optional, secondary) —
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.maxLength = 254;
  emailInput.placeholder = 'you@example.com';
  emailInput.autocomplete = 'email';
  emailInput.spellcheck = false;
  emailInput.inputMode = 'email';
  emailInput.setAttribute('enterkeyhint', 'go');

  const emailSection = div({});
  emailSection.appendChild(fieldLabel('Email', true));
  emailSection.appendChild(inputField(emailInput, 'md'));
  emailSection.appendChild(
    div(
      { fontSize: FS.sm, color: UI.faint, lineHeight: '1.5', margin: '8px 0 0' },
      isConfigured()
        ? 'Cloud-saves your scores. Hashed on device — never shared.'
        : 'Cloud save is offline right now. Progress is kept safely in this browser.',
    ),
  );
  root.appendChild(emailSection);

  // — Legal —
  const legal = div({ textAlign: 'center', fontSize: FS.sm, color: UI.faint, margin: '28px 0 0', lineHeight: '1.6' });
  const policyLink = (label: string, href: string): HTMLAnchorElement => {
    const a = el('a', { color: UI.dim, textDecoration: 'underline', cursor: 'pointer' }, label) as HTMLAnchorElement;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  };
  legal.append('By continuing you agree to our ', policyLink('Terms', '/terms.html'), ' and ', policyLink('Privacy Policy', '/privacy.html'), '.');
  root.appendChild(legal);

  // — Logic —
  const setMsg = (t: string, bad: boolean): void => {
    nameMsg.textContent = t;
    nameMsg.style.color = bad ? UI.warn : UI.dim;
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
    // Persist the profile (callsign survives even if the cloud call fails), keeping any valid
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

  ctx.footer.setPrimary('Continue', () => void submit());
  ctx.footer.setPrimaryEnabled(valid());

  // Desktop only — autofocusing on touch pops the keyboard over the layout.
  if (!('ontouchstart' in window)) requestAnimationFrame(() => nameInput.focus());

  return root;
}
