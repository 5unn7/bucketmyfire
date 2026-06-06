/**
 * DOM chrome for the in-3D map editor (src/three/editor/MapEditor.ts) — a self-styled dark control rail
 * over the WebGL canvas: map picker, tool buttons, brush sliders, layer counts, and the Export modal.
 * Pure DOM + callbacks (no Three) so the editor logic and its UI stay separable. Dev-only (the `?editor`
 * route lazy-loads it), so it carries its own minimal styles rather than pulling the game's theme tokens.
 */

type Tool =
  | 'orbit'
  | 'pan'
  | 'raise'
  | 'lower'
  | 'paint-trees'
  | 'clear-trees'
  | 'building'
  | 'erase'
  | 'road'
  | 'river'
  | 'lake'
  | 'select';

export interface EditorUIOptions {
  mapId: string;
  maps: readonly string[];
  buildingKinds: readonly string[];
  onMap(id: string): void;
  onTool(t: Tool): void;
  onBrushKm(v: number): void;
  onTerrainStrength(v: number): void;
  onFoliageStrength(v: number): void;
  onBuildingKind(k: 'cabin' | 'depot'): void;
  onBuildingDensity(v: number): void;
  onToggleLabels(on: boolean): void;
  onExport(): string;
  onDeleteSelected(): void;
  onClearLayers(): void;
}

export interface EditorUI {
  setMap(id: string): void;
  setTool(t: Tool): void;
  setNotice(msg: string): void;
  setCounts(terrain: number, foliage: number, buildings: number, roads: number): void;
  setSelected(kind: string | null): void;
  nudgeBrush(delta: number): void;
}

// keys are matched case-insensitively against the keydown (digits + letters for the overflow tools)
const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'orbit', label: '🧭 Orbit', key: '1' },
  { id: 'pan', label: '✥ Pan', key: '2' },
  { id: 'raise', label: '⛰ Raise', key: '3' },
  { id: 'lower', label: '🕳 Lower', key: '4' },
  { id: 'paint-trees', label: '🌲 Trees +', key: '5' },
  { id: 'clear-trees', label: '🪓 Trees −', key: '6' },
  { id: 'building', label: '🏠 Bldg +', key: '7' },
  { id: 'erase', label: '⌫ Erase', key: '8' },
  { id: 'road', label: '🛣 Road', key: '9' },
  { id: 'river', label: '🌊 River', key: 'R' },
  { id: 'lake', label: '💧 Lake', key: 'L' },
  { id: 'select', label: '✋ Select', key: 'S' },
];
export const EDITOR_TOOL_KEYS: ReadonlyArray<{ id: Tool; key: string }> = TOOLS.map((t) => ({ id: t.id, key: t.key.toLowerCase() }));

export function buildEditorUI(container: HTMLElement, opts: EditorUIOptions): EditorUI {
  injectStyles();

  const panel = el('div', 'me-panel');
  panel.innerHTML = `
    <div class="me-title">Map editor <span>· 3D</span></div>
    <label class="me-row"><span>Map</span>
      <select class="me-map">${opts.maps.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>
    </label>
    <div class="me-notice"></div>
    <div class="me-tools"></div>
    <label class="me-row"><span>Brush km</span><input class="me-brush" type="range" min="1" max="40" step="1" value="8"><b class="me-brush-v">8</b></label>
    <label class="me-row"><span>Height m</span><input class="me-th" type="range" min="5" max="200" step="5" value="40"><b class="me-th-v">40</b></label>
    <label class="me-row"><span>Tree force</span><input class="me-fol" type="range" min="0.25" max="3" step="0.25" value="1"><b class="me-fol-v">1</b></label>
    <label class="me-row me-bk"><span>Build kind</span>
      <select class="me-kind">${opts.buildingKinds.map((k) => `<option value="${k}">${k}</option>`).join('')}</select>
    </label>
    <label class="me-row me-bd"><span>Density</span><input class="me-dens" type="range" min="1" max="10" step="1" value="3"><b class="me-dens-v">3</b></label>
    <label class="me-row"><span>Labels</span><input class="me-labels" type="checkbox" checked></label>
    <div class="me-sel"></div>
    <div class="me-counts"></div>
    <div class="me-actions">
      <button class="me-export me-primary">Export ▾</button>
      <button class="me-clear">Clear layers</button>
    </div>
    <div class="me-help">
      <b>Left-drag</b> uses the active tool · <b>Right-drag</b> or <b>Space+drag</b> pans · <b>wheel</b> zoom.<br>
      Keys <b>1–9 / R L S</b> tools · <b>[ ]</b> brush size · <b>Del</b> remove selected.<br>
      <b>Bldg +</b>: drag to scatter (density). <b>Erase</b>: drag over buildings/roads. <b>Road</b>: drag to paint, release to lay.<br>
      <b>River</b>: click points, dbl-click/Enter finish. <b>Lake</b>: click to dig (brush = size).
    </div>`;
  container.appendChild(panel);

  const $ = <T extends HTMLElement>(s: string) => panel.querySelector(s) as T;
  const mapSel = $<HTMLSelectElement>('.me-map');
  const notice = $<HTMLDivElement>('.me-notice');
  const toolsBox = $<HTMLDivElement>('.me-tools');
  const brush = $<HTMLInputElement>('.me-brush');
  const brushV = $<HTMLElement>('.me-brush-v');
  const th = $<HTMLInputElement>('.me-th');
  const thV = $<HTMLElement>('.me-th-v');
  const fol = $<HTMLInputElement>('.me-fol');
  const folV = $<HTMLElement>('.me-fol-v');
  const kindSel = $<HTMLSelectElement>('.me-kind');
  const dens = $<HTMLInputElement>('.me-dens');
  const densV = $<HTMLElement>('.me-dens-v');
  const selBox = $<HTMLDivElement>('.me-sel');
  const counts = $<HTMLDivElement>('.me-counts');

  mapSel.value = opts.mapId;
  mapSel.onchange = () => opts.onMap(mapSel.value);

  const toolBtns: Partial<Record<Tool, HTMLButtonElement>> = {};
  for (const t of TOOLS) {
    const b = el('button', 'me-tool') as HTMLButtonElement;
    b.textContent = t.label;
    b.title = `${t.label}  (${t.key})`;
    b.onclick = () => opts.onTool(t.id);
    toolBtns[t.id] = b;
    toolsBox.appendChild(b);
  }

  brush.oninput = () => {
    brushV.textContent = brush.value;
    opts.onBrushKm(+brush.value);
  };
  th.oninput = () => {
    thV.textContent = th.value;
    opts.onTerrainStrength(+th.value);
  };
  fol.oninput = () => {
    folV.textContent = fol.value;
    opts.onFoliageStrength(+fol.value);
  };
  kindSel.onchange = () => opts.onBuildingKind(kindSel.value as 'cabin' | 'depot');
  dens.oninput = () => {
    densV.textContent = dens.value;
    opts.onBuildingDensity(+dens.value);
  };
  const labelsCb = $<HTMLInputElement>('.me-labels');
  labelsCb.onchange = () => opts.onToggleLabels(labelsCb.checked);
  $<HTMLButtonElement>('.me-clear').onclick = opts.onClearLayers;
  $<HTMLButtonElement>('.me-export').onclick = () => openExport(opts.onExport());

  function setTool(t: Tool): void {
    for (const id in toolBtns) toolBtns[id as Tool]!.classList.toggle('on', id === t);
    panel.classList.toggle('me-show-kind', t === 'building' || t === 'select');
    panel.classList.toggle('me-show-dens', t === 'building');
  }
  setTool('orbit');

  return {
    setMap: (id) => (mapSel.value = id),
    setTool,
    setNotice: (msg) => {
      notice.textContent = msg;
      notice.style.display = msg ? 'block' : 'none';
    },
    setCounts: (t, f, b, r) =>
      (counts.innerHTML = `terrain <b>${t}</b> · foliage <b>${f}</b> · bldgs <b>${b}</b> · roads <b>${r}</b>`),
    setSelected: (kind) => {
      selBox.innerHTML = kind
        ? `Selected <b>${kind}</b> — drag to move · <button class="me-del">Delete</button>`
        : '';
      const del = selBox.querySelector('.me-del') as HTMLButtonElement | null;
      if (del) del.onclick = opts.onDeleteSelected;
    },
    nudgeBrush: (delta) => {
      brush.value = String(Math.max(1, Math.min(40, +brush.value + delta)));
      brushV.textContent = brush.value;
      opts.onBrushKm(+brush.value);
    },
  };
}

function openExport(text: string): void {
  const bg = el('div', 'me-modal-bg');
  bg.innerHTML = `
    <div class="me-modal">
      <div class="me-modal-h">Export — paste into the map's regions file<button class="me-x">✕</button></div>
      <textarea class="me-ta" spellcheck="false" readonly></textarea>
      <div class="me-modal-a"><button class="me-copy me-primary">Copy</button><span class="me-copied"></span></div>
    </div>`;
  document.body.appendChild(bg);
  const ta = bg.querySelector('.me-ta') as HTMLTextAreaElement;
  ta.value = text;
  const close = () => bg.remove();
  (bg.querySelector('.me-x') as HTMLButtonElement).onclick = close;
  bg.onclick = (e) => {
    if (e.target === bg) close();
  };
  (bg.querySelector('.me-copy') as HTMLButtonElement).onclick = async () => {
    try {
      await navigator.clipboard.writeText(ta.value);
    } catch {
      ta.select();
      document.execCommand('copy');
    }
    (bg.querySelector('.me-copied') as HTMLElement).textContent = 'Copied ✓';
  };
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

function injectStyles(): void {
  if (document.getElementById('me-styles')) return;
  const s = document.createElement('style');
  s.id = 'me-styles';
  s.textContent = `
  .me-panel{position:fixed;top:12px;left:12px;width:230px;background:rgba(16,22,28,.92);color:#d7e3ea;
    border:1px solid #2a3741;border-radius:10px;padding:12px;font:13px/1.4 system-ui,sans-serif;z-index:40;
    backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}
  .me-title{font-weight:600;margin-bottom:8px}.me-title span{color:#8fa3b0;font-weight:400}
  .me-row{display:flex;align-items:center;gap:6px;margin:6px 0;color:#8fa3b0}
  .me-row>span{flex:0 0 60px}.me-row input[type=range]{flex:1 1 auto;min-width:0}
  .me-row>b{flex:0 0 28px;text-align:right;color:#d7e3ea;font-variant-numeric:tabular-nums}
  .me-row select{flex:1 1 auto;background:#0e1418;color:#d7e3ea;border:1px solid #2a3741;border-radius:5px;padding:4px}
  .me-notice{display:none;background:rgba(202,162,74,.16);border:1px solid #6b5a2a;color:#f3e2b8;
    border-radius:6px;padding:6px 8px;margin:6px 0;font-size:12px}
  .me-tools{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin:8px 0}
  .me-tool{background:#1d272e;color:#d7e3ea;border:1px solid #2a3741;border-radius:6px;padding:6px 4px;
    cursor:pointer;font:inherit;font-size:12px}
  .me-tool:hover{background:#25323b}.me-tool.on{background:#4ea3ff;color:#05121d;border-color:#4ea3ff;font-weight:600}
  .me-bk{display:none}.me-show-kind .me-bk{display:flex}
  .me-bd{display:none}.me-show-dens .me-bd{display:flex}
  .me-sel{color:#9fd9a0;font-size:12px;margin:4px 0;min-height:0}
  .me-sel .me-del,.me-clear{background:#3a1f1f;color:#ff9b9b;border:1px solid #6b2a2a;border-radius:5px;
    padding:3px 8px;cursor:pointer;font:inherit;font-size:12px;margin-left:6px}
  .me-counts{color:#8fa3b0;font-size:12px;margin:6px 0}.me-counts b{color:#d7e3ea}
  .me-actions{display:flex;gap:6px;margin:8px 0}
  .me-primary{background:#4ea3ff;color:#05121d;border:1px solid #4ea3ff;border-radius:6px;padding:6px 10px;
    cursor:pointer;font:inherit;font-weight:600}.me-primary:hover{background:#6fb6ff}
  .me-clear{margin-left:0}
  .me-help{color:#8fa3b0;font-size:11px;margin-top:8px;line-height:1.5;border-top:1px solid #2a3741;padding-top:8px}
  .me-help b{color:#d7e3ea;font-weight:600}
  .me-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;
    justify-content:center;z-index:60}
  .me-modal{background:#161e24;border:1px solid #2a3741;border-radius:10px;width:min(760px,92vw);
    max-height:86vh;display:flex;flex-direction:column;color:#d7e3ea;font:13px system-ui,sans-serif}
  .me-modal-h{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;
    border-bottom:1px solid #2a3741;font-weight:600}
  .me-x{background:none;border:none;color:#8fa3b0;cursor:pointer;font-size:16px}
  .me-ta{margin:12px 14px;min-height:340px;resize:none;background:#0e1418;color:#cfe9c8;
    border:1px solid #2a3741;border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre}
  .me-modal-a{display:flex;align-items:center;gap:10px;padding:0 14px 14px}.me-copied{color:#8fa3b0}
  `;
  document.head.appendChild(s);
}
