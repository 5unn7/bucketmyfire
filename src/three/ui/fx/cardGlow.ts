/**
 * Card glow FX — a faint cursor-follow spotlight + a floating "glazing" rim glow on the flat
 * glass-cockpit cards. The look is pure CSS (the `.cardfx` block in `home/styles.ts`, token-only);
 * this module is the thin behaviour half: it (a) tags the qualifying `.card`s with `.cardfx` and
 * (b) feeds the live cursor position into the `--mx`/`--my`/`--rim-ang` custom properties through ONE
 * delegated pointer listener, so a hovered card's spotlight tracks the mouse and its rim specular
 * angles toward the cursor.
 *
 * Image-backed heroes/posters are skipped on purpose — they keep their cinematic scrim + zoom instead
 * of a glaze that would fight the photo. Mouse-only (touch has no hover, so the glass stays calm and
 * the listener no-ops), pointer-events on the pseudo layers are off (taps pass straight through), and
 * the returned teardown unbinds the listener on dispose.
 */

// Cards that own their surface art OR their own ::after layer (swipe / CRT scanlines) — they keep their
// existing treatment rather than the glaze (the rim pseudo would otherwise clobber that ::after).
// `.fhome-map` is the cool/instrument-register map tile: it carries its own cyan cartographic-grid FX,
// so it skips the WARM ember glaze (the two-register law — don't warm the cockpit).
const SKIP = '.artcard, .fhome-hero, .fhome-play, .shopbanner, .crt, .fhome-map';

/** Tag the glass cards under `root` and wire cursor tracking. Returns a teardown to call on dispose. */
export function attachCardGlow(root: HTMLElement): () => void {
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.card')).filter((c) => !c.matches(SKIP));
  if (!cards.length) return () => {};
  for (const c of cards) c.classList.add('cardfx');

  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // no hover on touch — leave the glass calm
    const card = (e.target as HTMLElement | null)?.closest?.('.cardfx') as HTMLElement | null;
    if (!card) return;
    const r = card.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    card.style.setProperty('--mx', x.toFixed(1) + '%');
    card.style.setProperty('--my', y.toFixed(1) + '%');
    // Slide the rim's specular toward the cursor — light catching the edge of the glass.
    const ang = Math.round((Math.atan2(y - 50, x - 50) * 180) / Math.PI + 90);
    card.style.setProperty('--rim-ang', ang + 'deg');
  };

  root.addEventListener('pointermove', onMove, { passive: true });
  return () => root.removeEventListener('pointermove', onMove);
}
