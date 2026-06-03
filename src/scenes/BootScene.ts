import Phaser from 'phaser';

/**
 * First scene. Nothing to load from disk yet (textures are generated in
 * PreloadScene), so this just hands straight off. Kept as a seam for future
 * boot-time config (save data, device checks, analytics init).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Preload');
  }
}
