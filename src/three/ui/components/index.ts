/**
 * The component kit — one import surface for every screen.
 *
 *   import { makeButton, makeCard, openModal, makeField } from '../components';
 *
 * Each component reads ONLY `theme.ts` tokens and bakes the DESIGN.md rules (two registers,
 * focus rings, touch targets, disabled states) into a reusable factory. Screens compose these;
 * they never hand-roll a `div` + `cursor:pointer` + `addEventListener('click')` again.
 * See `docs/specs/ui-component-system.md`.
 */

export * from './base';
export * from './Button';
export * from './IconButton';
export * from './Card';
export * from './Modal';
export * from './Field';
export * from './Badge';
export * from './Stat';
export * from './ListRow';
export * from './Tabs';
export * from './ProgressBar';
export * from './headers';
