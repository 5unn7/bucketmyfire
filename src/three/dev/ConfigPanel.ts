/**
 * Live tuning panel — an auto-generated slider board over EVERY block in `config.ts`.
 *
 * DEV ONLY. Mounted from `main.ts` behind `import.meta.env.DEV || ?qa || ?tune` and lazy-
 * imported so it never enters a normal player's bundle. Toggle with the backtick (`) key
 * or the ⚙ launcher button.
 *
 * It walks `CONFIG_REGISTRY` recursively and builds a control per leaf value:
 *   • number  → slider + exact number input (slider auto-ranges; the input can exceed it)
 *   • colour  → native colour picker (keys matching /colou?r|tint/)
 *   • boolean → toggle
 *   • string  → text field
 *
 * Changing a control MUTATES the live config object (so runtime knobs — flight, bucket,
 * fire, camera, drop, audio… — update on the very next frame) AND saves a sparse diff via
 * `dev/configOverrides.ts`. Load-time knobs (terrain, world-gen, quality, forest…) are
 * flagged with a ↻ and take effect after the Reload button — `config.ts` re-applies the
 * saved overrides at startup. Reset (the dot) restores a value to its source default; the
 * "changed N" badge, "Copy overrides" (paste-ready JSON) and "Reset all" round it out.
 *
 * Pure DOM + inline styles from the shared `theme.ts` tokens — zero new assets, consistent
 * with the rest of the UI layer.
 */

import { CONFIG_REGISTRY, CONFIG_DEFAULTS } from '../config';
import {
  setOverride,
  clearOverride,
  clearAllOverrides,
  overridesJson,
  countOverrides,
} from './configOverrides';
import { UI, FS, FW, R, div, el, setBlur } from '../ui/theme';

type Dict = Record<string, unknown>;

interface RowRef {
  node: HTMLElement;
  text: string;
}
interface SectionRef {
  wrap: HTMLDivElement;
  rows: RowRef[];
  forceOpen: () => void;
  restore: () => void;
}

const COLOR_RE = /colou?r|tint/i;
// Blocks read ONCE at construction — a live tweak won't show until Reload.
const RELOAD_BLOCKS = new Set([
  'WORLD3D', 'MAPGEO', 'TERRAIN', 'LAKE_SHAPE', 'STREAM', 'BIOMES', 'FOREST',
  'COMMUNITIES', 'ROADS', 'STRUCTURES', 'BRIDGE', 'QUALITY', 'GODRAYS', 'FAUNA',
]);

const Z = '99999';
const OPEN_KEY = 'bmf.cfgpanel.open';
const SECTIONS_KEY = 'bmf.cfgpanel.sections'; // JSON array of expanded block names

// --- small utilities --------------------------------------------------------

function getAtPath(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (cur && typeof cur === 'object') cur = (cur as Dict)[k];
    else return undefined;
  }
  return cur;
}

function fmt(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toPrecision(6)));
}

function numToHex(n: number): string {
  return '#' + (Math.round(n) & 0xffffff).toString(16).padStart(6, '0');
}
function hexToNum(h: string): number {
  return parseInt(h.replace('#', ''), 16) || 0;
}

function niceStep(raw: number): number {
  if (raw <= 0) return 0.01;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * mag;
}

/** Pick a sensible slider [min,max,step] from the current value (the input can still exceed it). */
function deriveRange(value: number): { min: number; max: number; step: number } {
  const abs = Math.abs(value);
  const isInt = Number.isInteger(value);
  if (value === 0) return { min: 0, max: 1, step: 0.01 };
  if (abs > 0 && abs < 0.05) return { min: 0, max: abs * 4, step: abs / 100 };
  if (abs <= 1 && !isInt) return { min: value < 0 ? -1 : 0, max: 1, step: 0.005 };
  const min = value < 0 ? value * 2 : 0;
  const max = abs * 3;
  return { min, max, step: isInt ? 1 : niceStep((max - min) / 200) };
}

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

// --- mount ------------------------------------------------------------------

let mounted: { setOpen: (b: boolean) => void; isOpen: () => boolean } | null = null;

/** Build (or toggle) the panel. Safe to call repeatedly — subsequent calls just toggle. */
export function mountConfigPanel(): void {
  if (mounted) {
    mounted.setOpen(!mounted.isOpen());
    return;
  }
  mounted = build();
}

function build(): NonNullable<typeof mounted> {
  injectStyle();

  const expanded = readSet(SECTIONS_KEY);
  const changed = new Set<string>(); // rowId of every value differing from default
  const sections: SectionRef[] = [];

  // --- launcher (shown when the panel is closed) ---
  const launcher = div({
    position: 'fixed',
    top: '12px',
    right: '12px',
    width: '38px',
    height: '38px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.round,
    background: UI.glass,
    border: `1px solid ${UI.strokeStrong}`,
    color: UI.text,
    fontSize: '20px',
    cursor: 'pointer',
    userSelect: 'none',
    boxShadow: UI.shadowBtn,
    zIndex: Z,
  });
  launcher.textContent = '⚙';
  launcher.title = 'Tuning panel (`)';
  setBlur(launcher);

  // --- panel shell ---
  const root = div({
    position: 'fixed',
    top: '10px',
    right: '10px',
    width: '330px',
    maxWidth: 'calc(100vw - 20px)',
    maxHeight: 'calc(100vh - 20px)',
    display: 'none',
    flexDirection: 'column',
    background: UI.cardGlass,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.lg,
    boxShadow: UI.shadowCard,
    color: UI.text,
    fontFamily: UI.font,
    zIndex: Z,
    overflow: 'hidden',
  });
  setBlur(root);
  // Keep WASD / Space / arrows typed into our fields out of the flight controls.
  for (const ev of ['keydown', 'keyup', 'keypress'] as const) {
    root.addEventListener(ev, (e) => e.stopPropagation());
  }

  // --- header ---
  const header = div({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderBottom: `1px solid ${UI.hair}`,
  });
  const title = el('span', { fontSize: FS.body, fontWeight: FW.bold, letterSpacing: '0.04em' }, '⚙ CONFIG');
  const badge = el('span', {
    fontSize: FS.tag,
    fontWeight: FW.semibold,
    color: UI.ink,
    background: UI.accent,
    borderRadius: R.pill,
    padding: '1px 7px',
    display: 'none',
  });
  const spacer = div({ flex: '1' });
  const closeBtn = el('span', { cursor: 'pointer', fontSize: FS.md, color: UI.dim, padding: '0 2px' }, '✕');
  closeBtn.title = 'Close (`)';
  header.append(title, badge, spacer, closeBtn);

  function refreshBadge(): void {
    const n = changed.size;
    badge.textContent = `${n} changed`;
    badge.style.display = n > 0 ? 'inline-block' : 'none';
  }

  // --- search ---
  const searchWrap = div({ padding: '8px 12px', borderBottom: `1px solid ${UI.hair}` });
  const search = el('input', {
    width: '100%',
    boxSizing: 'border-box',
    background: UI.field,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.sm,
    color: UI.text,
    fontSize: FS.sm,
    fontFamily: UI.font,
    padding: '6px 9px',
    outline: 'none',
  }) as HTMLInputElement;
  search.type = 'search';
  search.placeholder = 'Search every knob…';
  searchWrap.appendChild(search);

  // --- scrollable body ---
  const body = div({ overflowY: 'auto', overflowX: 'hidden', flex: '1', padding: '4px 0' });
  body.className = 'bmf-cfg-scroll';

  // Build a section per top-level config block.
  for (const blockName of Object.keys(CONFIG_REGISTRY)) {
    const blockObj = CONFIG_REGISTRY[blockName];
    if (!blockObj || typeof blockObj !== 'object') continue;
    const sec = buildSection(blockName, blockObj, { changed, expanded, refreshBadge });
    sections.push(sec);
    body.appendChild(sec.wrap);
  }
  refreshBadge();

  // single search filter: show matching rows, then show/expand only sections with a hit
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    for (const sec of sections) {
      let any = false;
      for (const r of sec.rows) {
        const hit = q === '' || r.text.includes(q);
        r.node.style.display = hit ? '' : 'none';
        any = any || hit;
      }
      sec.wrap.style.display = any ? '' : 'none';
      if (q === '') sec.restore();
      else if (any) sec.forceOpen();
    }
  });

  // --- footer ---
  const footer = div({ display: 'flex', gap: '6px', padding: '8px 12px', borderTop: `1px solid ${UI.hair}` });
  const reloadBtn = footBtn('↻ Reload', UI.accent);
  const copyBtn = footBtn('⧉ Copy', UI.textCool);
  const resetBtn = footBtn('Reset all', UI.warn);
  footer.append(reloadBtn, copyBtn, resetBtn);

  reloadBtn.addEventListener('click', () => location.reload());
  copyBtn.addEventListener('click', () => {
    const text = overridesJson();
    const flash = (msg: string) => {
      copyBtn.textContent = msg;
      window.setTimeout(() => (copyBtn.textContent = '⧉ Copy'), 1100);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => flash('Copied!'), () => flash('Copy failed'));
    } else {
      flash('Clipboard n/a');
    }
  });
  resetBtn.addEventListener('click', () => {
    if (countOverrides() === 0) return;
    if (!window.confirm('Reset ALL config tweaks back to source defaults and reload?')) return;
    clearAllOverrides();
    location.reload();
  });

  // --- assembly ---
  root.append(header, searchWrap, body, footer);
  document.body.append(launcher, root);

  // --- open / close ---
  const isOpen = () => root.style.display !== 'none';
  const setOpen = (open: boolean) => {
    root.style.display = open ? 'flex' : 'none';
    launcher.style.display = open ? 'none' : 'flex';
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  launcher.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));
  setOpen((() => {
    try {
      return localStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  })());

  // backtick toggles, unless the user is typing in one of our own fields
  window.addEventListener('keydown', (e) => {
    if (e.key !== '`' && e.key !== '~') return;
    const t = e.target as HTMLElement | null;
    if (t && root.contains(t)) return;
    e.preventDefault();
    setOpen(!isOpen());
  });

  return { setOpen, isOpen };
}

// --- section + leaf builders ------------------------------------------------

interface BuildCtx {
  changed: Set<string>;
  expanded: Set<string>;
  refreshBadge: () => void;
}

function buildSection(blockName: string, blockObj: Dict, ctx: BuildCtx): SectionRef {
  const wrap = div({ borderBottom: `1px solid ${UI.hair}` });
  const head = div({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    cursor: 'pointer',
    userSelect: 'none',
  });
  const caret = el('span', { fontSize: FS.tag, color: UI.dim, width: '10px' }, '▸');
  const name = el('span', { fontSize: FS.label, fontWeight: FW.bold, letterSpacing: '0.06em', color: UI.textCool }, blockName);
  head.append(caret, name);
  if (RELOAD_BLOCKS.has(blockName)) {
    const tag = el('span', { fontSize: FS.tag, color: UI.caution, marginLeft: '2px' }, '↻');
    tag.title = 'read once at load — press Reload to apply';
    head.appendChild(tag);
  }
  const content = div({ display: 'none', padding: '2px 0 8px' });

  const rows: RowRef[] = [];
  walk(blockObj, [], blockName, content, blockName, rows, ctx);

  let open = ctx.expanded.has(blockName);
  const apply = () => {
    content.style.display = open ? 'block' : 'none';
    caret.textContent = open ? '▾' : '▸';
  };
  apply();
  head.addEventListener('click', () => {
    open = !open;
    if (open) ctx.expanded.add(blockName);
    else ctx.expanded.delete(blockName);
    writeSet(SECTIONS_KEY, ctx.expanded);
    apply();
  });

  wrap.append(head, content);

  return {
    wrap,
    rows,
    forceOpen: () => {
      content.style.display = 'block';
      caret.textContent = '▾';
    },
    restore: () => apply(),
  };
}

function walk(
  obj: Dict,
  parentPath: string[],
  blockName: string,
  container: HTMLElement,
  groupKey: string,
  sink: RowRef[],
  ctx: BuildCtx,
): void {
  const isArr = Array.isArray(obj);
  for (const key of Object.keys(obj)) {
    const path = [...parentPath, key];
    const val = obj[key];
    if (val == null) continue;
    const t = typeof val;
    if (t === 'object') {
      const sub = makeSubgroup(container, key);
      walk(val as Dict, path, blockName, sub, key, sink, ctx);
    } else if (t === 'number' || t === 'boolean' || t === 'string') {
      const hintKey = isArr ? groupKey : key;
      addLeaf(obj, key, path, blockName, container, hintKey, sink, ctx);
    }
  }
}

function makeSubgroup(container: HTMLElement, key: string): HTMLElement {
  const label = el('div', {
    fontSize: FS.tag,
    color: UI.faint,
    fontWeight: FW.semibold,
    letterSpacing: '0.05em',
    padding: '4px 12px 2px 18px',
  }, key);
  const inner = div({ borderLeft: `1px solid ${UI.hair}`, marginLeft: '18px' });
  container.append(label, inner);
  return inner;
}

function addLeaf(
  obj: Dict,
  key: string,
  path: string[],
  blockName: string,
  container: HTMLElement,
  hintKey: string,
  sink: RowRef[],
  ctx: BuildCtx,
): void {
  const rowId = `${blockName}/${path.join('.')}`;
  const def = getAtPath(CONFIG_DEFAULTS[blockName], path);
  const val = obj[key];

  const row = div({ display: 'flex', alignItems: 'center', gap: '7px', padding: '4px 12px' });
  const dot = el('span', { fontSize: '9px', cursor: 'pointer', width: '10px', textAlign: 'center', flex: '0 0 auto' }, '●');
  dot.title = 'reset to default';
  const label = el('span', {
    fontSize: FS.meta,
    color: UI.text,
    flex: '1 1 auto',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }, path.join('.'));

  const setDot = (isChanged: boolean) => {
    dot.style.color = isChanged ? UI.accent : UI.faint;
    if (isChanged) ctx.changed.add(rowId);
    else ctx.changed.delete(rowId);
    ctx.refreshBadge();
  };

  // commit a new value: mutate live config + persist (or clear if back to default)
  const commit = (value: unknown) => {
    obj[key] = value;
    if (Object.is(value, def)) {
      clearOverride(blockName, path);
      setDot(false);
    } else {
      setOverride(blockName, path, value);
      setDot(true);
    }
  };

  let resetUi: () => void = () => {};
  row.append(dot, label);

  if (typeof val === 'boolean') {
    const cb = el('input', { cursor: 'pointer', flex: '0 0 auto' }) as HTMLInputElement;
    cb.type = 'checkbox';
    cb.checked = val;
    cb.style.accentColor = UI.accent;
    cb.addEventListener('change', () => commit(cb.checked));
    resetUi = () => (cb.checked = def as boolean);
    row.appendChild(cb);
  } else if (typeof val === 'string') {
    const tf = el('input', {
      width: '110px',
      flex: '0 0 auto',
      background: UI.field,
      border: `1px solid ${UI.stroke}`,
      borderRadius: R.xs,
      color: UI.text,
      fontSize: FS.tag,
      fontFamily: UI.font,
      padding: '3px 5px',
      outline: 'none',
    }) as HTMLInputElement;
    tf.value = val;
    tf.addEventListener('change', () => commit(tf.value));
    resetUi = () => (tf.value = def as string);
    row.appendChild(tf);
  } else if (typeof val === 'number' && COLOR_RE.test(hintKey) && Number.isInteger(val) && val >= 0 && val <= 0xffffff) {
    const cp = el('input', {
      width: '30px',
      height: '20px',
      flex: '0 0 auto',
      padding: '0',
      border: `1px solid ${UI.stroke}`,
      borderRadius: R.xs,
      background: 'transparent',
      cursor: 'pointer',
    }) as HTMLInputElement;
    cp.type = 'color';
    cp.value = numToHex(val);
    cp.addEventListener('input', () => commit(hexToNum(cp.value)));
    resetUi = () => (cp.value = numToHex(def as number));
    row.appendChild(cp);
  } else {
    // numeric slider + exact input
    const { min, max, step } = deriveRange(val as number);
    const slider = el('input', { flex: '1 1 64px', minWidth: '54px', cursor: 'pointer' }) as HTMLInputElement;
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(val);
    slider.style.accentColor = UI.accent;

    const num = el('input', {
      width: '58px',
      flex: '0 0 auto',
      background: UI.field,
      border: `1px solid ${UI.stroke}`,
      borderRadius: R.xs,
      color: UI.text,
      fontSize: FS.tag,
      fontFamily: UI.font,
      padding: '3px 4px',
      outline: 'none',
      textAlign: 'right',
    }) as HTMLInputElement;
    num.type = 'number';
    num.step = String(step);
    num.value = fmt(val as number);

    const sync = (v: number, fromSlider: boolean) => {
      if (!fromSlider && Math.abs(v) > Number(slider.max)) slider.max = String(Math.abs(v) * 1.5);
      if (!fromSlider && v < Number(slider.min)) slider.min = String(v);
      slider.value = String(v);
      if (fromSlider) num.value = fmt(v);
      commit(v);
    };
    slider.addEventListener('input', () => sync(parseFloat(slider.value), true));
    num.addEventListener('change', () => {
      const v = parseFloat(num.value);
      if (!Number.isNaN(v)) sync(v, false);
    });
    resetUi = () => {
      const d = def as number;
      slider.value = String(d);
      num.value = fmt(d);
    };
    row.append(slider, num);
  }

  dot.addEventListener('click', () => {
    commit(def);
    resetUi();
  });

  // initial changed state (an override applied at load already differs from default)
  if (!Object.is(val, def)) setDot(true);

  sink.push({ node: row, text: rowId.toLowerCase() });
  container.appendChild(row);
}

// --- styling helpers --------------------------------------------------------

function footBtn(text: string, color: string): HTMLDivElement {
  const b = div({
    flex: '1',
    textAlign: 'center',
    fontSize: FS.tag,
    fontWeight: FW.semibold,
    color,
    background: UI.field,
    border: `1px solid ${UI.stroke}`,
    borderRadius: R.sm,
    padding: '6px 4px',
    cursor: 'pointer',
    userSelect: 'none',
  });
  b.textContent = text;
  return b;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .bmf-cfg-scroll::-webkit-scrollbar { width: 9px; }
    .bmf-cfg-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.16); border-radius: 6px; }
    .bmf-cfg-scroll::-webkit-scrollbar-track { background: transparent; }
  `;
  document.head.appendChild(s);
}
