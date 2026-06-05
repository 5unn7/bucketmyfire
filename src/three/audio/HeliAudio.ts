import { AUDIO } from '../config';

// Two REAL recorded helicopter clips, served from public/audio (BASE_URL keeps the path
// correct under the GitHub-Pages base). Both are free to use, no attribution required.
const ROTOR_LOOP_URL = import.meta.env.BASE_URL + 'audio/helicopter-flying-loop.mp3';
const ENGINE_START_URL = import.meta.env.BASE_URL + 'audio/helicopter-start.mp3';

/**
 * Helicopter audio. Two REAL recorded clips drive it:
 *   - a ~7s ENGINE-START one-shot that fires the moment the cold-start spool begins
 *     (the crank/whine), timed to the 7s START hold (`STARTUP.holdSeconds`), and
 *   - a steady FLYING LOOP that plays seamlessly underneath and is the constant rotor
 *     drone once airborne.
 * The scoop / drop / win cues stay short procedural one-shots (no extra assets).
 *
 * Why samples and not a synth: a real recording carries the engine + blade harmonics +
 * chop together — far more convincing than oscillators. The flying loop is a CONSTANT
 * drone (it just loops): working harder only nudges the VOLUME and a tiny playback-rate,
 * never sweeps pitch like a car engine. The cold-start crank is the start clip's job; the
 * loop's rpm-scaled volume just swells the rotor up to speed underneath it.
 *
 * The decoded loop is rebuilt once into an equal-power CROSSFADE loop so there is
 * no click at the loop seam (the raw clip's head and tail don't match). The start clip
 * is played as-is (a one-shot, never looped).
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
const ROTOR_SPOOL_RATE = 0.5; // playback-rate floor at zero RPM — the cold-start spool winds it UP to 1.0
const CROSSFADE_SEC = 0.35; // seam crossfade length
// Shave this much off EACH end of the raw flying loop before it's made seamless. The recorded clip
// ramps in/out at its boundaries; since the seam crossfade blends the tail INTO the head, an
// untrimmed end smears that artifact across every loop. Trimming first keeps the drone clean. (Local,
// not in config, to match the other rotor constants here.)
const ROTOR_TRIM_SEC = 0.25;
const COMMS_GAIN = 0.16; // radio-squelch blip level (the "kshh" before a dispatch line)
const START_GAIN = 0.9; // engine-start crank one-shot level (peak, before it dissolves into the loop)
// Two-clip handoff: the recorded crank and the flying loop are different recordings, so a hard cut
// from one to the other steps in level/timbre. Instead we CROSSFADE — duck the crank toward silence as
// the rotor spools up, back-loaded past this RPM so the crank stays dominant through most of the start,
// then dissolves into the swelling loop over the last stretch, landing silent exactly at full RPM.
const START_DISSOLVE_RPM = 0.6; // spool fraction past which the crank begins crossfading into the loop

/** Hermite ease 0→1 across [e0, e1] (flat outside) — shapes the back-loaded crank→loop crossfade. */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// The mute preference persists across sessions (an on-screen button + the 'M' key both drive it),
// so a player who silenced the rotor stays silenced next visit.
const MUTE_KEY = 'bmf.audio.muted.v1';
function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export class HeliAudio {
  private readonly ctx!: AudioContext;
  private readonly master!: GainNode;
  private readonly rotorGain!: GainNode;
  // Web Audio may be absent or throw on construction (old/embedded WebViews, no audio device); when it
  // does we degrade to a silent no-op (every public method early-returns) instead of blank-screening
  // the game. Audio is non-essential — a failure here must never take the whole game down.
  private disabled = false;
  private rotorSrc: AudioBufferSourceNode | null = null;
  private rotorBuffer: AudioBuffer | null = null;
  private startBuffer: AudioBuffer | null = null; // ~7s engine-start crank (one-shot)
  private startSrc: AudioBufferSourceNode | null = null; // the crank currently sounding (so we can cut it)
  private startGain: GainNode | null = null; // its gain — ramped to 0 for a click-free abort

  private started = false; // a user gesture has unlocked + nodes are running
  private pendingStart = false; // unlock happened before the clip finished loading
  private muted = loadMuted(); // persisted mute preference (button + 'M' key)
  private suspended = false; // tab hidden → AudioContext suspended (independent of user mute)
  private readonly muteListeners = new Set<(m: boolean) => void>(); // notify the on-screen toggle

  // Cold-start crank: fired ONCE the first frame the rotor begins spooling (rpm enters 0..1).
  // Latched so a release/re-hold of the START dial doesn't replay it, and so the headless
  // skip-cold-start path (rpm pinned at 1) never triggers it.
  private engineStartFired = false;

  // Edge trackers so Game can pass raw per-frame booleans.
  private wasScooping = false;
  private wasDropping = false;
  private wasWon = false;

  private readonly unlockHandler!: () => void; // assigned only on the non-disabled path (see constructor)

  constructor() {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    // Guard construction: a missing Web Audio API or a throwing constructor (no audio hardware, a
    // locked-down embedded browser) must not take the game down. Fall back to a silent no-op.
    let ctx: AudioContext | null = null;
    try {
      if (Ctx) ctx = new Ctx();
    } catch {
      ctx = null;
    }
    if (!ctx) {
      this.disabled = true;
      return; // graph never built; every public method early-returns and the game runs silently.
    }
    this.ctx = ctx;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0; // ramped up on unlock
    this.master.connect(this.ctx.destination);

    this.rotorGain = this.ctx.createGain();
    this.rotorGain.gain.value = ROTOR_BASE_GAIN;
    this.rotorGain.connect(this.master);

    // Load + decode both clips (async; may finish after unlock).
    void this.loadClips();

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

  private async loadClips(): Promise<void> {
    // Both decode independently — a failure on one must not block the other (audio is
    // non-essential; fail silently per-clip if decode/fetch is unavailable).
    await Promise.all([
      this.decode(ROTOR_LOOP_URL)
        .then((b) => {
          // Trim the clip's ramped ends BEFORE the seam crossfade (which blends tail→head), then loop.
          this.rotorBuffer = this.makeSeamlessLoop(this.trimEnds(b, ROTOR_TRIM_SEC));
          if (this.pendingStart) this.startRotor();
        })
        .catch(() => {}),
      this.decode(ENGINE_START_URL)
        .then((b) => {
          this.startBuffer = b; // one-shot, no loop treatment
        })
        .catch(() => {}),
    ]);
  }

  /**
   * Fetch + decode an audio clip. Fetched as a media range (like an <audio> element
   * would) — servers/CDNs serve audio more reliably this way, and it dodges
   * environments that short-circuit a plain fetch of a media MIME type to an empty 204.
   */
  private async decode(url: string): Promise<AudioBuffer> {
    const res = await fetch(url, { headers: { Range: 'bytes=0-' } });
    const raw = await res.arrayBuffer();
    return this.ctx.decodeAudioData(raw);
  }

  /** Resume the context and start the rotor loop once a gesture has occurred. */
  ensureStarted(): void {
    if (this.disabled) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.started) return;
    this.started = true;
    const t = this.ctx.currentTime;
    this.master.gain.setValueAtTime(0, t);
    // Ramp in to the user's level — straight to silent if they arrived already muted.
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : AUDIO.masterVolume, t + AUDIO.fadeInSec);
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

  /** Current mute state — the on-screen toggle reads this to pick its glyph. */
  get isMuted(): boolean {
    return this.muted;
  }

  /** Subscribe to mute changes (so the on-screen button stays in sync when 'M' flips it too). */
  onMuteChange(cb: (muted: boolean) => void): void {
    this.muteListeners.add(cb);
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  /** Set + persist the mute state, ramp the master bus, and notify any on-screen toggle. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* storage blocked — mute still works this session, just won't persist */
    }
    if (!this.disabled) {
      this.master.gain.setTargetAtTime(muted ? 0 : AUDIO.masterVolume, this.ctx.currentTime, 0.05);
    }
    for (const cb of this.muteListeners) cb(muted);
  }

  /**
   * Suspend/resume the whole audio graph for a backgrounded tab (driven by Game off visibilitychange).
   * Uses the AudioContext's own suspend/resume so a hidden tab goes truly silent (Web Audio keeps
   * playing through a throttled rAF otherwise) WITHOUT touching the user's mute state — coming back to
   * the tab restores exactly the level they left, muted or not.
   */
  setSuspended(suspended: boolean): void {
    if (this.disabled) return;
    if (suspended === this.suspended) return;
    this.suspended = suspended;
    try {
      if (suspended) void this.ctx.suspend();
      else if (this.started) void this.ctx.resume();
    } catch {
      /* suspend/resume is best-effort */
    }
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
    rpm?: number; // main-rotor spin fraction 0..1 (cold start spools it up); default 1 = full
    engineHolding?: boolean; // START dial currently held — gates the crank so a release cuts it
  }): void {
    if (this.disabled || !this.started) return;
    const now = this.ctx.currentTime;
    const ease = AUDIO.paramEaseSec;

    const rpm = p.rpm === undefined ? 1 : Math.max(0, Math.min(1, p.rpm));
    const holding = p.engineHolding ?? false;

    // Cold-start crank: fire the ~7s engine-start clip while the pilot HOLDS the START dial and the
    // rotor is spooling (rpm in the open interval 0..1). The clip is a one-shot the player can't
    // pause, so we gate it on `holding`: release the dial before full RPM and we cut the crank (with
    // a short fade) and re-arm it, so a fresh hold re-cranks from the top. A continuous hold to full
    // RPM plays through naturally (rpm reaches 1 → the cut below no longer applies). The skip-cold-
    // start path (rpm pinned at 1, never holding) stays silent. We keep retrying the fire each frame
    // until it actually plays — covering the rare case where the clip hasn't finished decoding yet.
    if (!this.engineStartFired && holding && rpm > 0 && rpm < 1) this.playEngineStart();
    else if (this.engineStartFired && !holding && rpm < 1) this.abortEngineStart();

    // Smooth the two-clip handoff: while the recorded crank is still sounding, DUCK it as the rotor
    // nears full RPM so it dissolves INTO the swelling flying loop instead of hard-cutting at the clip's
    // end. Back-loaded (START_DISSOLVE_RPM) so the crank stays dominant through most of the spool, then
    // crossfades out over the last stretch — landing silent exactly as the loop reaches the full drone.
    if (this.startSrc && this.startGain && rpm < 1) {
      const dissolve = 1 - smoothstep(START_DISSOLVE_RPM, 1, rpm);
      this.startGain.gain.setTargetAtTime(START_GAIN * dissolve, now, ease);
    }

    const speedN = Math.min(1, p.speed / p.maxSpeed);
    const effort = Math.min(
      1,
      Math.abs(p.throttle) * 0.55 + Math.max(0, p.lift) * 0.5 + speedN * 0.4,
    );

    // Volume scales with effort AND the spin-up RPM: silent on the deck, swelling to the full drone
    // as the rotor comes up to speed, then the usual effort nudge once flying.
    this.rotorGain.gain.setTargetAtTime((ROTOR_BASE_GAIN + ROTOR_LOAD_GAIN * effort) * rpm, now, ease);
    if (this.rotorSrc) {
      // The cold-start spool also pitches the loop UP from a low idle to full (ROTOR_SPOOL_RATE → 1),
      // selling the wind-up; at full RPM it's just the tiny effort-driven rate rise as before.
      const spool = ROTOR_SPOOL_RATE + (1 - ROTOR_SPOOL_RATE) * rpm;
      this.rotorSrc.playbackRate.setTargetAtTime(spool * (1 + ROTOR_RATE_LOAD * effort), now, ease);
    }

    // Edge-triggered one-shots.
    if (p.scooping && !this.wasScooping) this.playSplash();
    if (p.dropping && !this.wasDropping) this.playPour();
    if (p.won && !this.wasWon) this.playWin();
    this.wasScooping = p.scooping;
    this.wasDropping = p.dropping;
    this.wasWon = p.won;
  }

  /**
   * The recorded engine-start crank — a ~7s one-shot played as the cold-start spool begins.
   * Timed to the START hold (`STARTUP.holdSeconds`), so a continuous hold lands the crank's
   * tail right as the rotor reaches full RPM; the flying loop swells up underneath it. No
   * loop treatment — it plays once through its own gain on the master bus (so 'M' mutes it).
   * We keep the source + gain so an early release can cut it (`abortEngineStart`).
   */
  private playEngineStart(): void {
    if (!this.started || !this.startBuffer) return; // not unlocked / not decoded yet — retry next frame
    const src = this.ctx.createBufferSource();
    src.buffer = this.startBuffer;
    const g = this.ctx.createGain();
    // Start near-silent; the per-frame dissolve (in update) ramps it in and back out, so the crank both
    // eases ON from silence (no onset click) and crossfades OFF into the loop — one envelope, no hard cut.
    g.gain.value = 0.0001;
    src.connect(g).connect(this.master);
    src.start();
    // Self-clear when it ends naturally (a hold held to full RPM), so a stale handle isn't aborted.
    src.onended = (): void => {
      if (this.startSrc === src) {
        this.startSrc = null;
        this.startGain = null;
      }
    };
    this.startSrc = src;
    this.startGain = g;
    this.engineStartFired = true; // latch only on success
  }

  /**
   * Cut a crank still sounding when the pilot lets go of the START dial before full RPM — a short
   * gain fade (click-free) then stop, and re-arm `engineStartFired` so the next hold re-cranks.
   */
  private abortEngineStart(): void {
    if (!this.startSrc) return;
    const t = this.ctx.currentTime;
    try {
      if (this.startGain) {
        this.startGain.gain.cancelScheduledValues(t);
        this.startGain.gain.setValueAtTime(this.startGain.gain.value, t);
        this.startGain.gain.linearRampToValueAtTime(0.0001, t + 0.08);
      }
      this.startSrc.stop(t + 0.1);
    } catch {
      /* already stopped — ignore */
    }
    this.startSrc = null;
    this.startGain = null;
    this.engineStartFired = false; // re-arm: a fresh hold re-cranks from the top
  }

  // === One-shots (procedural, no assets) ==================================

  /**
   * A radio-squelch blip for a posted DISPATCH/CREW/WARNING comms line — the "kshh" of a transmission
   * opening plus a short carrier chirp so it reads as RADIO, not just noise. Urgency brightens the
   * filter + chirp (alert = a quick double-blip). No assets; reuses the unlock + master bus.
   */
  playSquelch(urgency: 'info' | 'warn' | 'alert' = 'info'): void {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const dur = urgency === 'alert' ? 0.16 : 0.12;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(dur + 0.05);
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = urgency === 'warn' ? 1800 : urgency === 'alert' ? 2200 : 1500;
    band.Q.value = 0.7;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(COMMS_GAIN, t + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(ng).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);

    // A short square-wave carrier under the noise; alert fires a quick double to read as urgent.
    const beeps = urgency === 'alert' ? [0, 0.13] : [0];
    const f0 = urgency === 'info' ? 620 : urgency === 'warn' ? 760 : 900;
    for (const off of beeps) {
      const bt = t + off;
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f0, bt);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.8, bt + 0.05);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, bt);
      g.gain.linearRampToValueAtTime(COMMS_GAIN * 0.5, bt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.09);
      osc.connect(g).connect(this.master);
      osc.start(bt);
      osc.stop(bt + 0.1);
    }
  }

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

  /**
   * Crash — the impact boom when the airframe hits the ground or explodes. A deep low sine swept DOWN
   * (the gut-punch) under a burst of broadband debris noise lowpassed to a closing rumble (the crunch).
   * The loudest one-shot in the game (`AUDIO.crashVolume`) — it's a crash. Fired once by Game.detonate.
   */
  playCrash(): void {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    // Low boom: a sine swept down from a thud to sub-bass.
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.5);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(AUDIO.crashVolume, t + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.95);
    // Debris burst: broadband noise through a lowpass that closes down — the crunch + rolling rumble.
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(0.9);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.7);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(AUDIO.crashVolume * 0.8, t + 0.015);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    src.connect(lp).connect(ng).connect(this.master);
    src.start(t);
    src.stop(t + 0.9);
  }

  // === Helpers ============================================================

  /**
   * Slice `trim` seconds off BOTH ends of a decoded clip, returning a fresh shorter buffer.
   * Drops the recording's ramped-in/out boundaries so the seam crossfade has clean material to
   * loop. Clamped so a too-large trim can never invert the length (keeps at least a third of the
   * clip); a non-positive trim returns the clip untouched.
   */
  private trimEnds(src: AudioBuffer, trim: number): AudioBuffer {
    const sr = src.sampleRate;
    const cut = Math.max(0, Math.floor(trim * sr));
    const outLen = src.length - cut * 2;
    if (cut === 0 || outLen < Math.floor(src.length / 3)) return src; // nothing to do / would over-trim
    const out = this.ctx.createBuffer(src.numberOfChannels, outLen, sr);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const inD = src.getChannelData(ch);
      const outD = out.getChannelData(ch);
      for (let i = 0; i < outLen; i++) outD[i] = inD[cut + i];
    }
    return out;
  }

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
