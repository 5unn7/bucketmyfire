/**
 * Component-kit gallery — the `?kit` route. Renders every kit component across its variants /
 * registers / states on one scrollable page. This is the repo's visual-QA surface: there is no
 * test runner, so "did the kit render and behave" is verified by eye here (and headlessly, by
 * loading `?kit` and asserting 0 console errors). Lazy-loaded; never in the player bundle.
 */

import { UI, FS, FW, div, el } from '../theme';
import {
  makeButton,
  makeIconButton,
  makeCard,
  openModal,
  makeField,
  makeBadge,
  makeGradeChip,
  makeStars,
  makeStat,
  makeListRow,
  makeTabs,
  makeProgress,
  sectionHeading,
  selectHeading,
  stepHeading,
  type ButtonVariant,
  type Register,
} from './index';
import { signalFirstFrame } from '../../splashSignal';

/** A titled group with a wrapping row of demo nodes. */
function group(title: string, nodes: HTMLElement[]): HTMLDivElement {
  const wrap = div({ marginBottom: '34px' });
  wrap.appendChild(
    div({ fontSize: FS.label, fontWeight: FW.heavy, letterSpacing: '2.5px', textTransform: 'uppercase', color: UI.faint, marginBottom: '14px' }, title),
  );
  const row = div({ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center' });
  nodes.forEach((n) => row.appendChild(n));
  wrap.appendChild(row);
  return wrap;
}

export function mountKitGallery(host: HTMLElement): void {
  host.innerHTML = '';
  const page = div({
    position: 'absolute',
    inset: '0',
    overflowY: 'auto',
    background: 'radial-gradient(120% 100% at 50% 0%, #14202b 0%, #070c11 70%)',
    color: UI.text,
    fontFamily: UI.font,
    padding: '32px 24px 80px',
    boxSizing: 'border-box',
  });
  const col = div({ maxWidth: '900px', margin: '0 auto', width: '100%' });
  page.appendChild(col);
  host.appendChild(page);

  col.appendChild(el('h1', { margin: '0 0 4px', fontSize: FS.banner, fontWeight: FW.black, letterSpacing: '0.02em' }, 'Component kit'));
  col.appendChild(
    div({ fontSize: FS.sm, color: UI.dim, marginBottom: '30px' }, 'src/three/ui/components — the layer between theme.ts tokens and the screens. ?kit'),
  );

  // Buttons — every variant × register.
  const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'pill', 'danger'];
  const registers: Register[] = ['cockpit', 'fight'];
  for (const register of registers) {
    col.appendChild(
      group(
        `Button · ${register}`,
        variants.map((variant) => makeButton({ label: variant, variant, register, onClick: () => {} }).el),
      ),
    );
  }
  col.appendChild(
    group('Button · sizes / icon / states', [
      makeButton({ label: 'Small', size: 'sm' }).el,
      makeButton({ label: 'Medium', size: 'md' }).el,
      makeButton({ label: 'Large', size: 'lg' }).el,
      makeButton({ label: 'Fly', icon: '🚁', variant: 'primary', register: 'fight' }).el,
      (() => {
        const b = makeButton({ label: 'Disabled' });
        b.setEnabled(false);
        return b.el;
      })(),
      (() => {
        const b = makeButton({ label: 'Loading…', icon: '◐' });
        b.setLoading(true);
        return b.el;
      })(),
    ]),
  );

  // IconButtons.
  col.appendChild(
    group('IconButton', [
      makeIconButton({ glyph: '?', title: 'Help' }).el,
      makeIconButton({ glyph: '⌖', variant: 'accent', title: 'Free-look' }).el,
      makeIconButton({ glyph: '💧', variant: 'warm', title: 'Drop', size: 72 }).el,
    ]),
  );

  // Field.
  const f1 = makeField({ label: 'Callsign', icon: '🎖️', placeholder: 'Enter your callsign', maxLength: 16, hint: 'Shown on the leaderboard.' });
  const f2 = makeField({ label: 'Email', optional: true, icon: '✉️', type: 'email', placeholder: 'you@example.com' });
  f2.setError('Enter a valid email or leave it blank.');
  const fields = div({ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '420px', width: '100%' });
  fields.append(f1.el, f2.el);
  col.appendChild(group('Field', [fields]));

  // Cards.
  const plain = makeCard({ title: 'First Light', meta: 'Mission 1', trailing: makeBadge('NEXT', 'accent') });
  plain.body.appendChild(div({ fontSize: FS.sm, color: UI.dim, lineHeight: '1.5' }, 'A spot fire near Weyakwin. Scoop the lake, knock it down before it reaches the cabins.'));
  const sel = makeCard({ title: 'Black Hawk', meta: 'Aircraft', register: 'fight', selectable: true, trailing: makeStars(3) });
  sel.setSelected(true);
  sel.body.appendChild(div({ fontSize: FS.sm, color: UI.dim }, 'Selected state (fight register ring).'));
  const cards = div({ display: 'flex', flexWrap: 'wrap', gap: '14px' });
  plain.el.style.maxWidth = '280px';
  sel.el.style.maxWidth = '280px';
  cards.append(plain.el, sel.el);
  col.appendChild(group('Card', [cards]));

  // Badges / grade / stars.
  col.appendChild(
    group('Badge · grade · stars', [
      makeBadge('SOON', 'accent'),
      makeBadge('LOCKED', 'neutral'),
      makeBadge('CLEARED', 'ok'),
      makeBadge('THREAT', 'warn'),
      makeBadge('DAILY', 'fight'),
      makeGradeChip('S'),
      makeGradeChip('A'),
      makeGradeChip('C'),
      makeStars(2),
    ]),
  );

  // Stats.
  col.appendChild(
    group('Stat', [
      makeStat({ label: 'Missions', value: '5/8' }),
      makeStat({ label: 'Career score', value: '48,210' }),
      makeStat({ label: 'Best mission', value: '12,640', layout: 'label-top' }),
    ]),
  );

  // ListRow.
  const list = makeCard({ surface: 'soft' });
  list.el.style.maxWidth = '440px';
  list.body.append(
    makeListRow({ leading: '1', primary: 'ASH', secondary: 'British Columbia', trailing: makeGradeChip('S') }),
    makeListRow({ leading: '2', primary: 'You', secondary: 'Saskatchewan', trailing: '12,640', mine: true }),
    makeListRow({ leading: '3', primary: 'EMBER', secondary: 'Saskatchewan', trailing: '11,980' }),
  );
  col.appendChild(group('ListRow (in a soft Card)', [list.el]));

  // Tabs + ProgressBar.
  const tabState = div({ fontSize: FS.sm, color: UI.dim, marginTop: '10px' }, 'Selected: Career');
  const tabs = makeTabs(['Career', 'This mission'], (i) => (tabState.textContent = `Selected: ${i === 0 ? 'Career' : 'This mission'}`));
  const tabsWrap = div({});
  tabsWrap.append(tabs.el, tabState);
  const prog = makeProgress({ label: 'Campaign 0% complete' });
  prog.el.style.maxWidth = '440px';
  prog.set(0.62, 'Campaign 62% complete');
  col.appendChild(group('Tabs · ProgressBar', [tabsWrap, prog.el]));

  // Headers.
  const heads = div({ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' });
  heads.append(sectionHeading('Pre-flight', 'Pick your aircraft and confirm the loadout.'), selectHeading('Map Select', 'Choose a province to begin'), stepHeading(1, 'Callsign'));
  col.appendChild(group('Headers', [heads]));

  // Modal (opened on demand).
  col.appendChild(
    group('Modal', [
      makeButton({
        label: 'Open modal',
        variant: 'secondary',
        onClick: () => {
          const m = openModal({ title: 'Squadron Store', width: '440px' });
          m.body.appendChild(div({ fontSize: FS.sm, color: UI.dim, lineHeight: '1.6', padding: '4px 0 8px' }, 'A shared overlay: blurred scrim, titlebar, ✕, ESC to close, click-outside to close, Tab focus-trap, focus restore.'));
          m.footer.append(makeButton({ label: 'Close', variant: 'ghost', onClick: () => m.close() }).el, makeButton({ label: 'Notify me', variant: 'primary', register: 'fight', onClick: () => m.close() }).el);
        },
      }).el,
    ]),
  );

  signalFirstFrame(); // no canvas renders on this route — clear the cold-start splash
}
