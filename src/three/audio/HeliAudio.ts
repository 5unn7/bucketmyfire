import { AUDIO } from '../config';
import rotorLoopUrl from './helicopter-loop.mp3';

/**
 * Helicopter audio. The rotor is a REAL recorded helicopter loop (a free,
 * no-attribution Mixkit clip — "Video game helicopter", chosen for its strong,
 * recognizable ~16 Hz blade-chop and clean loopability), played seamlessly via
 * the Web Audio API. The scoop / drop / win cues are short procedural one-shots
 * (no extra assets needed).
 *
 * Why a sample and not a synth: a real rotor recording carries the engine + blade
 * harmonics + chop together — far more convincing than oscillators. We keep it a
 * CONSTANT drone (it just loops): working harder only nudges the VOLUME and a tiny
 * playback-rate, never sweeps pitch like a car engine.
 *
 * The decoded clip is rebuilt once into an equal-power CROSSFADE loop so there is
 * no click at the loop seam (the raw clip's head and tail don't match).
 *
 * Browser autoplay policy: an AudioContext starts suspended until a user gesture,
 * so we lazily unlock on the first pointer/key/touch and ramp the master in.
 * 'M' toggles mute.
 */

// Rotor dynamics — kept deliberately subtle so it reads as a steady rotor, not a
// revving engine. (Local, not in config, to avoid churn in the shared tuning file.)
const ROTOR_BASE_GAIN = 0.85; // loop volume at idle
const ROTOR_LOAD_GAIN = 0.18; // extra volume at full effort
const ROTOR_RATE_LOAD = 0.05; // tiny playback-rate rise at full effort (≤5%)
const CROSSFADE_SEC = 0.35; // seam crossfade length

export class HeliAudio {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly rotorGain: GainNode;
  private rotorSrc: AudioBufferSourceNode | null = null;
  private rotorBuffer: AudioBuffer | null = null;

  private started = false; // a user gesture has unlocked + nodes are running
  private pendingStart = false; // unlock happened before the clip finished loading
  private muted = false;

  // Edge trackers so Game can pass raw per-frame booleans.
  private wasScooping = false;
  private wasDropping = false;
  private wasWon = false;

  private readonly unlockHandler: () => void;

  constructor() {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0; // ramped up on unlock
    this.master.connect(this.ctx.destination);

    this.rotorGain = this.ctx.createGain();
    this.rotorGain.gain.value = ROTOR_BASE_GAIN;
    this.rotorGain.connect(this.master);

    // Load + decode + crossfade-loop the rotor clip (async; may finish after unlock).
    void this.loadRotor();

    // Unlock on the first user gesture (autoplay policy), then self-detach.
    this.unlockHandler = (): void => this.ensureStarted();
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(ev, this.unlockHandler);
    }

    // Mute toggle.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggleMute();
    });
  }

  private async loadRotor(): Promise<void> {
    try {
      // Fetch as a media range (like an <audio> element would) — servers/CDNs
      // serve audio more reliably this way, and it dodges environments that
      // short-circuit a plain fetch of a media MIME type to an empty 204.
      const res = await fetch(rotorLoopUrl, { headers: { Range: 'bytes=0-' } });
      const raw = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(raw);
      this.rotorBuffer = this.makeSeamlessLoop(decoded);
      if (this.pendingStart) this.startRotor();
    } catch {
      // Audio is non-essential; fail silently if decode/fetch is unavailable.
    }
  }

  /** Resume the context and start the rotor loop once a gesture has occurred. */
  ensureStarted(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.started) return;
    this.started = true;
    const t = this.ctx.currentTime;
    this.master.gain.setValueAtTime(0, t);
    this.master.gain.linearRampToValueAtTime(AUDIO.masterVolume, t + AUDIO.fadeInSec);
    if (this.rotorBuffer) this.startRotor();
    else this.pendingStart = true;
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.removeEventListener(ev, this.unlockHandler);
    }
  }

  private startRotor(): void {
    if (this.rotorSrc || !this.rotorBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.rotorBuffer;
    src.loop = true;
    src.connect(this.rotorGain);
    src.start();
    this.rotorSrc = src;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : AUDIO.masterVolume,
      this.ctx.currentTime,
      0.05,
    );
  }

  /**
   * Per-frame update. `effort` (how hard the aircraft is working) only nudges the
   * rotor VOLUME and a tiny playback-rate — never a big pitch sweep. Booleans are
   * edge-detected internally so Game can pass its raw per-frame flags.
   */
  update(p: {
    throttle: number;
    lift: number;
    speed: number;
    maxSpeed: number;
    scooping: boolean;
    dropping: boolean;
    won: boolean;
  }): void {
    if (!this.started) return;
    const now = this.ctx.currentTime;
    const ease = AUDIO.paramEaseSec;

    const speedN = Math.min(1, p.speed / p.maxSpeed);
    const effort = Math.min(
      1,
      Math.abs(p.throttle) * 0.55 + Math.max(0, p.lift) * 0.5 + speedN * 0.4,
    );

    this.rotorGain.gain.setTargetAtTime(ROTOR_BASE_GAIN + ROTOR_LOAD_GAIN * effort, now, ease);
    if (this.rotorSrc) {
      this.rotorSrc.playbackRate.setTargetAtTime(1 + ROTOR_RATE_LOAD * effort, now, ease);
    }

    // Edge-triggered one-shots.
    if (p.scooping && !this.wasScooping) this.playSplash();
    if (p.dropping && !this.wasDropping) this.playPour();
    if (p.won && !this.wasWon) this.playWin();
    this.wasScooping = p.scooping;
    this.wasDropping = p.dropping;
    this.wasWon = p.won;
  }

  // === One-shots (procedural, no assets) ==================================

  /** Bucket bites the lake — a short watery "ker-sploosh." */
  private playSplash(): void {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(0.5);
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(900, t);
    band.frequency.exponentialRampToValueAtTime(300, t + 0.35);
    band.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(AUDIO.scoopVolume, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    src.connect(band).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.45);
  }

  /** Payload release — an airy water "whoosh" as the bucket pours. */
  private playPour(): void {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(0.7);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(300, t);
    hp.frequency.exponentialRampToValueAtTime(1200, t + 0.45);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(AUDIO.dropVolume, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.65);
  }

  /** Victory — a short three-note ascending chime. */
  private playWin(): void {
    const base = this.ctx.currentTime + 0.05;
    const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
    notes.forEach((freq, i) => {
      const t = base + i * 0.16;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(AUDIO.winVolume, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }

  // === Helpers ============================================================

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * Rebuild a clip into a seam-free loop. The output is `crossfade` shorter than
   * the input; its head is an equal-power blend of the clip's head with the clip's
   * overflowing tail, so when looped the tail flows into the head with no click.
   */
  private makeSeamlessLoop(src: AudioBuffer): AudioBuffer {
    const sr = src.sampleRate;
    const cf = Math.min(Math.floor(CROSSFADE_SEC * sr), Math.floor(src.length / 3));
    const outLen = src.length - cf;
    const out = this.ctx.createBuffer(src.numberOfChannels, outLen, sr);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const inD = src.getChannelData(ch);
      const outD = out.getChannelData(ch);
      for (let i = 0; i < outLen; i++) outD[i] = inD[i];
      // Blend the overflow tail (samples [outLen, src.length)) over the head.
      for (let k = 0; k < cf; k++) {
        const t = k / cf;
        const fadeIn = Math.sin((t * Math.PI) / 2); // head rising
        const fadeOut = Math.cos((t * Math.PI) / 2); // tail falling
        outD[k] = outD[k] * fadeIn + inD[outLen + k] * fadeOut;
      }
    }
    return out;
  }
}
