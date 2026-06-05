/**
 * One-shot "first real frame is on screen" signal for the cold-start splash.
 *
 * The branded splash lives in static HTML (`index.html`) so it paints before ~1 MB of game JS even
 * parses. It used to clear the moment a `<canvas>` mounted — but the canvas mounts BEFORE the first
 * frame composites, so on slower devices it could fade onto a black canvas mid shader-compile. This
 * fires once, AFTER the first frame has actually rendered (or a fatal screen is shown), and the inline
 * splash script in `index.html` listens for it — so the splash hands off to real pixels, never a void.
 *
 * ES-module state is a singleton, so `fired` is shared across every caller and the splash hides exactly
 * once per page load (whichever render path — TitleScreen or a booted mission — paints first wins). A
 * full page reload (e.g. menu → mission) reloads the module, re-arming it for the fresh splash.
 */
let fired = false;

export function signalFirstFrame(): void {
  if (fired) return;
  fired = true;
  window.dispatchEvent(new Event('bmf:ready'));
}
