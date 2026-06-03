import Phaser from 'phaser';
import { GAME } from '../constants';

export interface ControlState {
  move: Phaser.Math.Vector2; // direction * throttle, magnitude 0..1
  descend: boolean; // dip the bucket / scoop
  drop: boolean; // release water onto fire
}

/**
 * Unified input: an on-screen left-thumb joystick + two right-thumb buttons for
 * touch, and WASD/arrows + Shift(scoop)/Space(drop) for desktop. All UI is
 * pinned to the camera (scrollFactor 0) and lives in screen space, which stays
 * a constant 960×540 thanks to Scale.FIT.
 */
export class InputController {
  private readonly state: ControlState = {
    move: new Phaser.Math.Vector2(0, 0),
    descend: false,
    drop: false,
  };

  private readonly baseX = 140;
  private readonly baseY = GAME.height - 130;
  private readonly radius = 80;
  private stickPointerId = -1;

  private readonly scoopBtn: Phaser.Geom.Circle;
  private readonly dropBtn: Phaser.Geom.Circle;
  private scoopHeld = false;
  private dropHeld = false;

  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>;
  private readonly thumb: Phaser.GameObjects.Arc;

  constructor(private readonly scene: Phaser.Scene) {
    scene.input.addPointer(2); // allow up to 3 simultaneous touches

    // --- Joystick visuals ---
    scene.add
      .circle(this.baseX, this.baseY, this.radius, 0xffffff, 0.08)
      .setStrokeStyle(2, 0xffffff, 0.25)
      .setScrollFactor(0)
      .setDepth(1000);
    this.thumb = scene.add
      .circle(this.baseX, this.baseY, 32, 0xffffff, 0.25)
      .setScrollFactor(0)
      .setDepth(1001);

    // --- Action buttons ---
    this.scoopBtn = new Phaser.Geom.Circle(GAME.width - 230, GAME.height - 90, 56);
    this.dropBtn = new Phaser.Geom.Circle(GAME.width - 100, GAME.height - 140, 64);
    this.drawButton(this.scoopBtn, 0x2f7d96, 'SCOOP');
    this.drawButton(this.dropBtn, 0xb23a2e, 'DROP');

    // --- Keyboard fallback ---
    const kb = scene.input.keyboard!;
    this.keys = {
      up: kb.addKey('W'),
      down: kb.addKey('S'),
      left: kb.addKey('A'),
      right: kb.addKey('D'),
      arrowUp: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      arrowDown: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      arrowLeft: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      arrowRight: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      scoop: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      drop: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    };

    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointermove', this.onPointerMove, this);
    scene.input.on('pointerup', this.onPointerUp, this);
  }

  /** Read the current frame's combined input. */
  read(): ControlState {
    const move = this.state.move.clone();

    // Keyboard overrides when no touch stick is active.
    if (this.stickPointerId === -1) {
      const kx =
        (this.down('left') || this.down('arrowLeft') ? -1 : 0) +
        (this.down('right') || this.down('arrowRight') ? 1 : 0);
      const ky =
        (this.down('up') || this.down('arrowUp') ? -1 : 0) +
        (this.down('down') || this.down('arrowDown') ? 1 : 0);
      if (kx !== 0 || ky !== 0) move.set(kx, ky).normalize();
    }

    return {
      move,
      descend: this.scoopHeld || this.down('scoop'),
      drop: this.dropHeld || this.down('drop'),
    };
  }

  private down(key: string): boolean {
    return this.keys[key].isDown;
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (Phaser.Geom.Circle.Contains(this.scoopBtn, p.x, p.y)) {
      this.scoopHeld = true;
      return;
    }
    if (Phaser.Geom.Circle.Contains(this.dropBtn, p.x, p.y)) {
      this.dropHeld = true;
      return;
    }
    // Anything on the left half drives the joystick.
    if (p.x < GAME.width / 2 && this.stickPointerId === -1) {
      this.stickPointerId = p.id;
      this.updateStick(p);
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (p.id === this.stickPointerId) this.updateStick(p);
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (p.id === this.stickPointerId) {
      this.stickPointerId = -1;
      this.state.move.set(0, 0);
      this.thumb.setPosition(this.baseX, this.baseY);
    }
    // A lifted finger clears both buttons; cheap and avoids stuck states.
    if (!this.scene.input.activePointer.isDown) {
      this.scoopHeld = false;
      this.dropHeld = false;
    }
  }

  private updateStick(p: Phaser.Input.Pointer): void {
    const dx = p.x - this.baseX;
    const dy = p.y - this.baseY;
    const dist = Math.min(Math.hypot(dx, dy), this.radius);
    const angle = Math.atan2(dy, dx);
    this.thumb.setPosition(
      this.baseX + Math.cos(angle) * dist,
      this.baseY + Math.sin(angle) * dist,
    );
    this.state.move.set((Math.cos(angle) * dist) / this.radius, (Math.sin(angle) * dist) / this.radius);
  }

  private drawButton(circle: Phaser.Geom.Circle, color: number, label: string): void {
    this.scene.add
      .circle(circle.x, circle.y, circle.radius, color, 0.35)
      .setStrokeStyle(3, color, 0.9)
      .setScrollFactor(0)
      .setDepth(1000);
    this.scene.add
      .text(circle.x, circle.y, label, { fontFamily: 'system-ui', fontSize: '18px', color: '#ffffff' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001);
  }
}
