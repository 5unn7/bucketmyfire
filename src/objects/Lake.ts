import Phaser from 'phaser';
import { COLORS } from '../constants';

/** A circular lake you can dip the Bambi bucket into. Purely top-down. */
export class Lake {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly r: number,
  ) {}

  draw(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(COLORS.waterDeep, 1);
    g.fillCircle(this.x, this.y, this.r);
    g.fillStyle(COLORS.water, 1);
    g.fillCircle(this.x, this.y, this.r - 10);
  }

  contains(px: number, py: number): boolean {
    return Phaser.Math.Distance.Between(px, py, this.x, this.y) <= this.r;
  }
}
