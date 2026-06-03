import Phaser from 'phaser';

/**
 * Generates every texture procedurally so the game ships with zero binary
 * assets and zero network load time — important for a "fast performance" mobile
 * web game. Swap any makeX() for this.load.image() once real art lands; keep
 * the texture keys identical and nothing else has to change.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  create(): void {
    this.makeHelicopter();
    this.makeRotor();
    this.makeShadow();
    this.makeWaterDrop();
    this.makeFire();
    this.makeSmoke();
    this.makeTree();
    this.scene.start('Game');
    this.scene.launch('HUD');
  }

  /** Nose points +x (0 radians) so rotation maps directly to heading. */
  private makeHelicopter(): void {
    const g = this.add.graphics();
    // tail boom
    g.fillStyle(0xb23a2e, 1);
    g.fillRect(8, 26, 40, 8);
    // body
    g.fillStyle(0xd84a3a, 1);
    g.fillRoundedRect(36, 14, 40, 32, 8);
    // cockpit glass
    g.fillStyle(0x9fd0e6, 1);
    g.fillRoundedRect(60, 18, 16, 18, 6);
    // tail fin
    g.fillStyle(0xb23a2e, 1);
    g.fillTriangle(8, 22, 8, 38, 0, 30);
    // skids
    g.fillStyle(0x2a2a2a, 1);
    g.fillRect(40, 48, 34, 3);
    g.generateTexture('heli', 84, 56);
    g.destroy();
  }

  private makeRotor(): void {
    const g = this.add.graphics();
    g.fillStyle(0x111111, 0.55);
    g.fillRect(0, 30, 124, 4);
    g.fillRect(60, 0, 4, 64);
    g.generateTexture('rotor', 124, 64);
    g.destroy();
  }

  private makeShadow(): void {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 1);
    g.fillEllipse(40, 20, 80, 40);
    g.generateTexture('shadow', 80, 40);
    g.destroy();
  }

  private makeWaterDrop(): void {
    const g = this.add.graphics();
    g.fillStyle(0x8fd3e8, 1);
    g.fillCircle(8, 8, 8);
    g.generateTexture('drop', 16, 16);
    g.destroy();
  }

  private makeFire(): void {
    const g = this.add.graphics();
    g.fillStyle(0xff7a18, 1);
    g.fillCircle(16, 18, 14);
    g.fillStyle(0xffd33d, 1);
    g.fillCircle(16, 20, 8);
    g.generateTexture('fire', 32, 32);
    g.destroy();
  }

  private makeSmoke(): void {
    const g = this.add.graphics();
    g.fillStyle(0xcfd2cf, 1);
    g.fillCircle(16, 16, 16);
    g.generateTexture('smoke', 32, 32);
    g.destroy();
  }

  private makeTree(): void {
    const g = this.add.graphics();
    g.fillStyle(0x1f3a1c, 1);
    g.fillTriangle(12, 0, 24, 30, 0, 30);
    g.fillStyle(0x162c14, 1);
    g.fillTriangle(12, 8, 22, 30, 2, 30);
    g.generateTexture('tree', 24, 32);
    g.destroy();
  }
}
