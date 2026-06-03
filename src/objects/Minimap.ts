import Phaser from 'phaser';
import { WORLD, GAME, COLORS } from '../constants';

/**
 * Corner minimap (GTA / Forza HUD style).
 *
 * The world is 3200×3200 but the camera only shows a ~960×540 slice of it, so a
 * pilot scooping from one lake and hunting fires in the far corner has no sense
 * of where anything is. This panel makes the world legible at a glance: a small
 * translucent square that shows every lake, every active fire blip, and the
 * helicopter as a heading arrow — all projected from world space into the panel.
 *
 * It is owned + updated by GameScene (which holds the live fire/lake objects).
 * Everything is drawn in screen space with scrollFactor(0) so it floats fixed
 * over the scrolling world, the same convention the joystick/buttons use.
 */

// Panel geometry in the constant 960×540 screen space. Top-right corner, tucked
// below the "fires" HUD text (~y=20) and clear of the bottom-left joystick and
// bottom-right action buttons.
const PANEL_SIZE = 150;
const PANEL_MARGIN = 24;
const PANEL_X = GAME.width - PANEL_SIZE - PANEL_MARGIN; // left edge
const PANEL_Y = 56; // top edge

// Minimap-specific palette. Lakes/heli reuse COLORS; fires get a hot blip color.
const BG_COLOR = 0x000000;
const BG_ALPHA = 0.4;
const BORDER_COLOR = 0xffffff;
const FIRE_COLOR = 0xff5a2e;
const FIRE_GLOW = 0xffb02e;
const HELI_COLOR = 0xffffff;
const WIND_COLOR = 0x9fd0e0;

// World → panel scale. Keep aspect ratio off the larger world dimension so a
// non-square world still maps without distortion (square today, future-proofed).
const SCALE = PANEL_SIZE / Math.max(WORLD.width, WORLD.height);

export interface MinimapHeli {
  x: number;
  y: number;
  rotation: number;
}

export interface MinimapBlip {
  x: number;
  y: number;
}

export class Minimap {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    // Static background + border: drawn once, never cleared.
    this.bg = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(1000);
    this.bg.fillStyle(BG_COLOR, BG_ALPHA);
    this.bg.fillRoundedRect(PANEL_X, PANEL_Y, PANEL_SIZE, PANEL_SIZE, 8);
    this.bg.lineStyle(2, BORDER_COLOR, 0.3);
    this.bg.strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_SIZE, PANEL_SIZE, 8);

    // Dynamic layer: cleared and redrawn every frame (cheap — a handful of fills).
    this.g = scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(1001);
  }

  /** Map a world coordinate into panel-local screen space. */
  private px(worldX: number): number {
    return PANEL_X + worldX * SCALE;
  }

  private py(worldY: number): number {
    return PANEL_Y + worldY * SCALE;
  }

  /** True if a finite world point falls inside the panel after projection. */
  private inside(x: number, y: number): boolean {
    return (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= 0 &&
      x <= WORLD.width &&
      y >= 0 &&
      y <= WORLD.height
    );
  }

  /**
   * Redraw all blips from the current world state. Call once per frame.
   * Guards against empty arrays and NaN — never throws.
   */
  update(
    heli: MinimapHeli,
    fires: MinimapBlip[],
    lakes: Array<{ x: number; y: number; r: number }>,
    wind?: { angle: number; strength: number },
  ): void {
    const g = this.g;
    g.clear();

    // --- Lakes (filled blue circles, radius scaled to the panel) ---
    g.fillStyle(COLORS.water, 0.85);
    for (const lake of lakes) {
      if (!this.inside(lake.x, lake.y)) continue;
      const r = Math.max(1.5, lake.r * SCALE); // keep tiny lakes visible
      g.fillCircle(this.px(lake.x), this.py(lake.y), r);
    }

    // --- Fires (hot dot with a soft glow ring) ---
    for (const fire of fires) {
      if (!this.inside(fire.x, fire.y)) continue;
      const fx = this.px(fire.x);
      const fy = this.py(fire.y);
      g.fillStyle(FIRE_GLOW, 0.35);
      g.fillCircle(fx, fy, 4);
      g.fillStyle(FIRE_COLOR, 1);
      g.fillCircle(fx, fy, 2.2);
    }

    // --- Optional wind arrow from the panel center ---
    if (wind && Number.isFinite(wind.angle) && Number.isFinite(wind.strength)) {
      const cx = PANEL_X + PANEL_SIZE / 2;
      const cy = PANEL_Y + PANEL_SIZE / 2;
      const len = 10 + Phaser.Math.Clamp(wind.strength, 0, 1) * 18;
      const ex = cx + Math.cos(wind.angle) * len;
      const ey = cy + Math.sin(wind.angle) * len;
      g.lineStyle(1.5, WIND_COLOR, 0.7);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(ex, ey);
      g.strokePath();
    }

    // --- Helicopter (a small triangle pointing along its heading) ---
    if (this.inside(heli.x, heli.y) && Number.isFinite(heli.rotation)) {
      const hx = this.px(heli.x);
      const hy = this.py(heli.y);
      const a = heli.rotation; // nose points +x, so rotation maps straight to heading
      const size = 6;
      // Nose forward, two tail corners splayed ~140° back.
      const nose = new Phaser.Math.Vector2(Math.cos(a), Math.sin(a)).scale(size);
      const left = new Phaser.Math.Vector2(
        Math.cos(a + 2.5),
        Math.sin(a + 2.5),
      ).scale(size * 0.7);
      const right = new Phaser.Math.Vector2(
        Math.cos(a - 2.5),
        Math.sin(a - 2.5),
      ).scale(size * 0.7);
      g.fillStyle(HELI_COLOR, 1);
      g.fillTriangle(
        hx + nose.x,
        hy + nose.y,
        hx + left.x,
        hy + left.y,
        hx + right.x,
        hy + right.y,
      );
    }
  }

  setVisible(v: boolean): void {
    this.bg.setVisible(v);
    this.g.setVisible(v);
  }

  destroy(): void {
    this.bg.destroy();
    this.g.destroy();
  }
}
