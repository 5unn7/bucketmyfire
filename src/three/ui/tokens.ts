/**
 * Design tokens as CSS custom properties — THE single source, derived from `theme.ts`, for BOTH:
 *   - the live runtime inject (`home/styles.ts` wraps these on `.bmf-app`), and
 *   - the generated `mockups/tokens.css` (`scripts/gen-tokens.ts` writes them on `:root`).
 *
 * Before this existed, `mockups/kit.css` hand-transcribed the same values and drifted silently
 * (see `mockups/README.md`). Now both surfaces read ONE function, so a token change in `theme.ts`
 * propagates to the live UI and the mockups with no hand copy. Pure brand tokens only — screen-local
 * cosmetic extras (the `--metal` instrument gradients, `--rail-h`) stay with their screen, not here.
 */
import { UI, HOME, FS, FW, R } from './theme';

/** The `--token:value;` declarations (no selector wrapper). Callers wrap in `.bmf-app{…}` or `:root{…}`. */
export function tokenDecls(): string {
  return [
    `--ember:${UI.ember};--ember-hi:${UI.emberHi};--fire:${UI.fire};`,
    `--menu:${UI.menu};--menu-soft:${UI.menuSoft};--menu-fill:${UI.menuFill};`,
    `--cta:${UI.cta};--cta-hi:${UI.ctaHi};--cta-ink:${UI.ctaInk};--cta-glow:${UI.ctaGlow};`,
    `--warn:${UI.warn};--ok:${UI.ok};--caution:${UI.caution};--gold:${UI.gold};--silver:${UI.silver};--bronze:${UI.bronze};`,
    `--text:${UI.text};--ink:${UI.ink};--dim:${UI.dim};--faint:${UI.faint};`,
    `--card-glass:${UI.cardGlass};--card-soft:${UI.cardSoft};--warm-glass:${UI.warmGlass};`,
    `--track:${UI.track};--recess:${UI.recess};--field:${UI.field};--rowmine:${UI.rowMine};`,
    `--stroke:${UI.stroke};--stroke-strong:${UI.strokeStrong};--warm-stroke:${UI.warmStroke};--hair:${UI.hair};`,
    `--shadow-card:${UI.shadowCard};--ember-glow:${UI.emberGlow};--blur:${UI.blur};`,
    `--ember-05:${HOME.ember05};--ember-10:${HOME.ember10};--ember-12:${HOME.ember12};--ember-14:${HOME.ember14};--ember-18:${HOME.ember18};--ember-20:${HOME.ember20};--ember-22:${HOME.ember22};--ember-30:${HOME.ember30};--ember-32:${HOME.ember32};--ember-35:${HOME.ember35};--ember-40:${HOME.ember40};--ember-42:${HOME.ember42};--ember-50:${HOME.ember50};`,
    `--fire-06:${HOME.fire06};--fire-12:${HOME.fire12};--fire-16:${HOME.fire16};--fire-28:${HOME.fire28};--fire-55:${HOME.fire55};`,
    `--glow-50:${HOME.glow50};--glow-60:${HOME.glow60};--glow-80:${HOME.glow80};--glow-90:${HOME.glow90};--warm-26:${HOME.warm26};--warm-38:${HOME.warm38};`,
    `--gold-32:${HOME.gold32};--gold-70:${HOME.gold70};--ok-12:${HOME.ok12};--ok-50:${HOME.ok50};`,
    `--warn-10:${HOME.warn10};--warn-16:${HOME.warn16};--warn-18:${HOME.warn18};--warn-22:${HOME.warn22};--warn-50:${HOME.warn50};`,
    `--rank:${HOME.rank};--card-bg:${HOME.cardBg};`,
    `--font:${UI.font};--mono:ui-monospace,"SF Mono","SFMono-Regular","Cascadia Code",Menlo,Consolas,monospace;`,
    `--fs-micro:${FS.micro};--fs-tag:${FS.tag};--fs-label:${FS.label};--fs-meta:${FS.meta};--fs-sm:${FS.sm};--fs-body:${FS.body};--fs-md:${FS.md};--fs-lg:${FS.lg};--fs-xl:${FS.xl};--fs-title:${FS.title};--fs-hero:${FS.hero};--fs-display:${FS.display};--fs-banner:${FS.banner};--fs-mega:${FS.mega};`,
    `--fw-medium:${FW.medium};--fw-semibold:${FW.semibold};--fw-bold:${FW.bold};--fw-heavy:${FW.heavy};--fw-black:${FW.black};`,
    `--r-sm:${R.sm};--r-md:${R.md};--r-lg:${R.lg};--r-xl:${R.xl};--r-pill:${R.pill};--r-round:${R.round};`,
  ].join('\n  ');
}

/** A full stylesheet block scoping the tokens under `selector` (e.g. `:root` for mockups, `.bmf-app` for the live hub). */
export function tokenBlock(selector: string): string {
  return `${selector}{\n  ${tokenDecls()}\n}`;
}
