import Phaser from 'phaser';
import { WORLD, BUCKET, FIRE, LAKES, COLORS } from '../constants';
import { Helicopter } from '../objects/Helicopter';
import { Lake } from '../objects/Lake';
import { Fire } from '../objects/Fire';
import { Bucket } from '../objects/Bucket';
import { Wind } from '../objects/Wind';
import { Minimap } from '../objects/Minimap';
import { InputController } from '../controls/InputController';

export class GameScene extends Phaser.Scene {
  private heli!: Helicopter;
  private controls!: InputController;
  private bucket!: Bucket;
  private wind!: Wind;
  private minimap!: Minimap;
  private lakes: Lake[] = [];
  private fires: Fire[] = [];
  private spray!: Phaser.GameObjects.Particles.ParticleEmitter;
  private water = 0;
  private won = false;

  constructor() {
    super('Game');
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);

    this.drawGround();
    this.lakes = LAKES.map((l) => new Lake(l.x, l.y, l.r));
    const lakeGfx = this.add.graphics().setDepth(2);
    this.lakes.forEach((lake) => lake.draw(lakeGfx));
    this.scatterTrees(260);
    this.spawnFires(FIRE.count);

    this.heli = new Helicopter(this, WORLD.width / 2, WORLD.height / 2);
    (this.heli.sprite.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(true);
    this.cameras.main.startFollow(this.heli.sprite, true, 0.08, 0.08);

    // The Bambi bucket swings on a rope under the heli; water drops from where
    // the *bucket* is, so smooth flying bombs true and aggressive flying doesn't.
    this.bucket = new Bucket(this, this.heli.x, this.heli.y);

    this.spray = this.add.particles(0, 0, 'drop', {
      speed: { min: 40, max: 120 },
      scale: { start: 0.9, end: 0.2 },
      alpha: { start: 0.9, end: 0 },
      lifespan: 500,
      emitting: false,
    });
    this.spray.setDepth(90);

    // Living-world wind: biases fire spread and bends smoke. Minimap shows it.
    this.wind = new Wind();
    this.minimap = new Minimap(this);

    this.controls = new InputController(this);

    // Fires creep outward on a timer.
    this.time.addEvent({
      delay: FIRE.spreadIntervalMs,
      loop: true,
      callback: this.spreadFires,
      callbackScope: this,
    });

    this.syncHud();
  }

  update(_time: number, deltaMs: number): void {
    if (this.won) return;
    const input = this.controls.read();

    this.wind.update(deltaMs);
    this.heli.update(deltaMs, { move: input.move, descend: input.descend });

    // Swing the slung bucket below the heli; a fuller bucket lags more.
    this.bucket.update(
      deltaMs,
      this.heli.x,
      this.heli.y,
      this.heli.velocityX,
      this.heli.velocityY,
      this.water / BUCKET.capacity,
    );

    this.handleScoop(input.descend, deltaMs);
    this.handleDrop(input.drop, deltaMs);

    this.fires.forEach((f) => f.grow(deltaMs));
    this.minimap.update(
      this.heli,
      this.fires.filter((f) => !f.isExtinguished),
      this.lakes,
      { angle: this.wind.angle, strength: this.wind.strength },
    );
    this.syncHud();

    if (this.fires.every((f) => f.isExtinguished) && !this.won) {
      this.won = true;
      this.registry.set('won', true);
    }
  }

  private handleScoop(descend: boolean, dtMs: number): void {
    const canFill =
      descend &&
      this.heli.canScoop &&
      this.water < BUCKET.capacity &&
      this.lakes.some((l) => l.contains(this.heli.x, this.heli.y));

    if (canFill) {
      this.water = Math.min(BUCKET.capacity, this.water + BUCKET.refillRate * (dtMs / 1000));
    }
  }

  private handleDrop(drop: boolean, dtMs: number): void {
    if (!drop || this.water <= 0) return;

    this.water = Math.max(0, this.water - BUCKET.dropRate * (dtMs / 1000));

    // Water leaves the *bucket*, not the heli — a swung bucket misses.
    const dropX = this.bucket.x;
    const dropY = this.bucket.y;
    this.spray.emitParticleAt(dropX, dropY, 4);

    for (const fire of this.fires) {
      if (fire.isExtinguished) continue;
      if (Phaser.Math.Distance.Between(dropX, dropY, fire.x, fire.y) <= BUCKET.dropRadius) {
        fire.douse(dtMs);
      }
    }
  }

  private spreadFires(): void {
    if (this.won) return;
    const active = this.fires.filter((f) => !f.isExtinguished);
    let liveCount = active.length;
    for (const fire of active) {
      if (liveCount >= FIRE.maxActive) break; // cap: spread can't run away
      if (Math.random() > FIRE.spreadChance) continue;
      // Wind biases which way the fire creeps, so it advances on a downwind front.
      const angle = this.wind.biasAngle(Math.random() * Math.PI * 2);
      const x = Phaser.Math.Clamp(fire.x + Math.cos(angle) * FIRE.spreadDistance, 40, WORLD.width - 40);
      const y = Phaser.Math.Clamp(fire.y + Math.sin(angle) * FIRE.spreadDistance, 40, WORLD.height - 40);
      if (this.lakes.some((l) => l.contains(x, y))) continue; // fire can't cross water
      this.fires.push(new Fire(this, x, y));
      liveCount++;
    }
  }

  private spawnFires(count: number): void {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < 500) {
      const x = Phaser.Math.Between(200, WORLD.width - 200);
      const y = Phaser.Math.Between(200, WORLD.height - 200);
      const nearSpawn = Phaser.Math.Distance.Between(x, y, WORLD.width / 2, WORLD.height / 2) < 500;
      const inLake = this.lakes.some((l) => l.contains(x, y));
      if (nearSpawn || inLake) continue;
      this.fires.push(new Fire(this, x, y));
      placed++;
    }
  }

  private scatterTrees(count: number): void {
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(0, WORLD.width);
      const y = Phaser.Math.Between(0, WORLD.height);
      if (this.lakes.some((l) => l.contains(x, y))) continue;
      this.add.image(x, y, 'tree').setDepth(y * 0.001 + 10);
    }
  }

  private drawGround(): void {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(COLORS.forest, 1);
    g.fillRect(0, 0, WORLD.width, WORLD.height);
    // Static dappled patches — drawn once, no per-frame cost.
    g.fillStyle(COLORS.forestDark, 0.5);
    for (let i = 0; i < 400; i++) {
      const x = Phaser.Math.Between(0, WORLD.width);
      const y = Phaser.Math.Between(0, WORLD.height);
      g.fillCircle(x, y, Phaser.Math.Between(12, 40));
    }
  }

  private syncHud(): void {
    this.registry.set('water', Math.round(this.water));
    this.registry.set('waterMax', BUCKET.capacity);
    this.registry.set('fires', this.fires.filter((f) => !f.isExtinguished).length);
    this.registry.set('canScoop', this.heli.canScoop && this.lakes.some((l) => l.contains(this.heli.x, this.heli.y)));
  }
}
