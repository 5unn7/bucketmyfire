import Phaser from 'phaser';
import { GAME } from '../constants';

/** Runs in parallel over GameScene; reads shared state from the registry. */
export class HUDScene extends Phaser.Scene {
  private bar!: Phaser.GameObjects.Graphics;
  private firesText!: Phaser.GameObjects.Text;
  private scoopHint!: Phaser.GameObjects.Text;
  private victory?: Phaser.GameObjects.Text;

  constructor() {
    super('HUD');
  }

  create(): void {
    this.add.text(24, 20, 'WATER', { fontFamily: 'system-ui', fontSize: '14px', color: '#cfe8f2' });
    this.bar = this.add.graphics();

    this.firesText = this.add.text(GAME.width - 24, 20, '', {
      fontFamily: 'system-ui',
      fontSize: '18px',
      color: '#ffd0c4',
    });
    this.firesText.setOrigin(1, 0);

    this.scoopHint = this.add
      .text(GAME.width / 2, 40, 'Over water — hold SCOOP to fill', {
        fontFamily: 'system-ui',
        fontSize: '16px',
        color: '#bfe9ff',
      })
      .setOrigin(0.5)
      .setVisible(false);
  }

  update(): void {
    const water = (this.registry.get('water') as number) ?? 0;
    const max = (this.registry.get('waterMax') as number) ?? 100;
    const fires = (this.registry.get('fires') as number) ?? 0;

    this.bar.clear();
    this.bar.fillStyle(0x000000, 0.4).fillRoundedRect(24, 40, 220, 18, 4);
    this.bar.fillStyle(0x3fa9d6, 1).fillRoundedRect(24, 40, 220 * (water / max), 18, 4);

    this.firesText.setText(`FIRES: ${fires}`);
    this.scoopHint.setVisible(Boolean(this.registry.get('canScoop')) && water < max);

    if (this.registry.get('won') && !this.victory) {
      this.victory = this.add
        .text(GAME.width / 2, GAME.height / 2, 'FIRE OUT.\nGreat flying, pilot.', {
          fontFamily: 'system-ui',
          fontSize: '40px',
          color: '#ffffff',
          align: 'center',
          backgroundColor: '#00000088',
          padding: { x: 24, y: 18 },
        })
        .setOrigin(0.5);
    }
  }
}
