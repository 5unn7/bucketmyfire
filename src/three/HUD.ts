/**
 * Lightweight DOM heads-up display. Three.js renders the world; the HUD is just
 * absolutely-positioned HTML over the canvas — cheaper and crisper than drawing
 * text in WebGL, and it scales with the viewport for free. Pure presentation: it
 * reads values handed in by the game each frame and never touches the scene.
 */
export class HUD {
  private readonly waterFill: HTMLDivElement;
  private readonly firesText: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private banner?: HTMLDivElement;
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      fontFamily: 'system-ui, sans-serif',
      color: '#eaf6ff',
      userSelect: 'none',
    });

    // --- Water gauge (top-left) ---
    const waterWrap = el('div', { position: 'absolute', left: '20px', top: '18px' });
    waterWrap.appendChild(
      el('div', { fontSize: '13px', letterSpacing: '1px', marginBottom: '5px', opacity: '0.9' }, 'WATER'),
    );
    const track = el('div', {
      width: '220px',
      height: '16px',
      background: 'rgba(0,0,0,0.4)',
      borderRadius: '4px',
      overflow: 'hidden',
    });
    this.waterFill = el('div', {
      width: '0%',
      height: '100%',
      background: 'linear-gradient(90deg,#3fa9d6,#7fe0ff)',
      transition: 'width 0.08s linear',
    });
    track.appendChild(this.waterFill);
    waterWrap.appendChild(track);
    this.root.appendChild(waterWrap);

    // --- Fire counter (top-right) ---
    this.firesText = el('div', {
      position: 'absolute',
      right: '20px',
      top: '18px',
      fontSize: '18px',
      fontWeight: '600',
      color: '#ffd0c4',
    });
    this.root.appendChild(this.firesText);

    // --- Status hint (top-center) ---
    this.hint = el('div', {
      position: 'absolute',
      left: '50%',
      top: '20px',
      transform: 'translateX(-50%)',
      fontSize: '15px',
      color: '#bfe9ff',
      background: 'rgba(0,0,0,0.3)',
      padding: '4px 10px',
      borderRadius: '6px',
      display: 'none',
    });
    this.root.appendChild(this.hint);

    parent.appendChild(this.root);
  }

  update(water: number, waterMax: number, firesLeft: number, hint: string | null, won: boolean): void {
    this.waterFill.style.width = `${Math.max(0, Math.min(1, water / waterMax)) * 100}%`;
    this.firesText.textContent = `FIRES: ${firesLeft}`;
    if (hint) {
      this.hint.textContent = hint;
      this.hint.style.display = 'block';
    } else {
      this.hint.style.display = 'none';
    }

    if (won && !this.banner) {
      this.banner = el('div', {
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%,-50%)',
        textAlign: 'center',
        fontSize: '40px',
        fontWeight: '700',
        lineHeight: '1.3',
        padding: '24px 32px',
        background: 'rgba(0,0,0,0.55)',
        borderRadius: '12px',
      }, 'FIRE OUT.\nGreat flying, pilot.');
      this.banner.style.whiteSpace = 'pre';
      this.root.appendChild(this.banner);
    }
  }
}

/** Tiny helper: create a styled div with optional text. */
function el(tag: 'div', style: Partial<CSSStyleDeclaration>, text?: string): HTMLDivElement {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}
