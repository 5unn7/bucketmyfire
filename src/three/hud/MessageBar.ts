/**
 * MessageBar — the ONE top-center glass advisory bar. It replaces the old split surfaces: the transient
 * top-center status "tip bubble" AND the dispatch/comms toast stack that used to live under the radar.
 * Every radio line, contextual teaching cue, and idle piloting tip now flows through this single frosted
 * pill, one message at a time, so the cockpit has a single place to look for "what should I do".
 *
 * Three lanes, by priority — higher always owns the bar:
 *   1. FUNCTIONAL comms (dispatch / crew / warning) — pushed as events, queued FIFO, each auto-expiring;
 *      an `alert` preempts whatever's showing. The colored speaker tag + edge are preserved.
 *   2. HINT — the per-frame contextual cue (scoop / re-rig / crew). Shows once when the bar is otherwise
 *      idle, then auto-fades, and never re-nags the same string (the old "show once" behaviour).
 *   3. TIPS — a slow rotation of flying + firefighting technique (FLIGHT_TIPS) that fills the quiet,
 *      paced so it never overwhelms: a tip holds briefly, then the bar rests before the next.
 *
 * Self-contained + event-driven — it owns its own timers, so there's no per-frame cost beyond the
 * deduped setHint() write. Cockpit register throughout (cyan), so the tips never warm the instrument.
 */
import { UI, el } from '../ui/theme';
import type { CommsSpeaker, CommsUrgency } from '../missions/types';
import { FLIGHT_TIPS } from './tips';

const HINT_MS = 3600; // a teaching hint holds this long, then fades (matches the retired status pill)
const TIP_FIRST_MS = 15000; // the first idle tip waits this long after load — let the player settle in
const TIP_HOLD_MS = 6500; // a tip stays up this long…
const TIP_GAP_MS = 16000; // …then the bar rests this long before the next (paced — ambient, not a nag)
const TTL: Record<CommsUrgency, number> = { info: 3500, warn: 4600, alert: 5500 };
const MAX_QUEUE = 3; // bound the backlog so a burst of score pops can't pile up

interface FuncMsg {
  tag: string;
  text: string;
  color: string;
  glow: boolean; // alert → a soft edge glow (and marks it un-droppable from the queue)
  ttl: number;
}

export class MessageBar {
  readonly root: HTMLDivElement; // mounted by the HUD into the top-center anchor
  private readonly tagEl: HTMLSpanElement; // colored uppercase speaker label (hidden for hints)
  private readonly textEl: HTMLSpanElement; // the message body

  // FUNCTIONAL lane (comms / warnings)
  private readonly queue: FuncMsg[] = [];
  private funcActive = false;
  private funcHideT = 0;

  // HINT lane (per-frame contextual cue)
  private hintKey: string | null = null; // last text seen — the dedup key; NOT reset on auto-fade
  private hintVisible = false;
  private hintHideT = 0;

  // TIP lane (idle rotation)
  private tipT = 0; // next-tip timer
  private tipHoldT = 0; // current-tip hold→fade timer
  private tipIdx = 0;

  private hideT = 0; // display:none after a fade-out completes

  constructor() {
    // Size / glass / placement are CSS now (`.bmf-hud .comms` in hud/styles.ts); only the per-message STATE
    // (tag + border colour, alert glow, fade opacity, show/hide) is written from JS in paint() / fade().
    this.root = el('div', {});
    this.root.className = 'comms';
    this.tagEl = el('span', {});
    this.tagEl.className = 'tag';
    this.textEl = el('span', {});
    this.textEl.className = 'body';
    this.root.append(this.tagEl, this.textEl);
    this.scheduleTip(TIP_FIRST_MS); // idle tips start once the player has settled in
  }

  // --- Functional lane -------------------------------------------------------

  /** Post a radio line. dispatch/crew/warning keep their colored tag + edge; an `alert` jumps the queue
   *  and shows immediately. Non-alert lines queue FIFO (capped) so a burst can't build a long backlog. */
  push(speaker: CommsSpeaker, text: string, urgency: CommsUrgency): void {
    const color =
      speaker === 'warning' || urgency === 'alert'
        ? UI.warn
        : speaker === 'crew'
          ? UI.commsAmber
          : speaker === 'pilot'
            ? UI.text
            : UI.accent;
    const msg: FuncMsg = { tag: speaker.toUpperCase(), text, color, glow: urgency === 'alert', ttl: TTL[urgency] };

    if (urgency === 'alert') {
      // Urgent — drop whatever's showing and run this next, ahead of any queued chatter.
      window.clearTimeout(this.funcHideT);
      this.funcActive = false;
      this.queue.unshift(msg);
    } else {
      if (this.queue.length >= MAX_QUEUE) {
        const i = this.queue.findIndex((m) => !m.glow); // shed the oldest droppable (never an alert)
        if (i >= 0) this.queue.splice(i, 1);
      }
      this.queue.push(msg);
    }
    if (!this.funcActive) this.pumpFunc();
  }

  /** Show the next queued line; when the queue drains, fade out and hand the bar back to the ambient lane. */
  private pumpFunc(): void {
    if (this.funcActive) return;
    const m = this.queue.shift();
    if (!m) {
      this.fade();
      this.resumeAmbient();
      return;
    }
    this.funcActive = true;
    this.cancelAmbient(); // tips/hint yield the bar while comms are talking
    this.paint(m.tag, m.text, m.color, m.glow);
    this.funcHideT = window.setTimeout(() => {
      this.funcActive = false;
      if (this.queue.length) this.pumpFunc();
      else {
        this.fade();
        this.resumeAmbient();
      }
    }, m.ttl);
  }

  // --- Hint lane -------------------------------------------------------------

  /**
   * Drive the contextual teaching cue (Game recomputes it every frame). Deduped on the string so a held
   * condition shows once and then stays quiet; functional comms always win the bar. `null` clears it.
   */
  setHint(text: string | null): void {
    if (text === this.hintKey) return; // unchanged since last frame — don't re-trigger
    this.hintKey = text;
    window.clearTimeout(this.hintHideT);
    if (this.funcActive) {
      this.hintVisible = false; // comms own the bar — skip the hint for now
      return;
    }
    if (!text) {
      if (this.hintVisible) {
        this.hintVisible = false;
        this.fade();
        this.scheduleTip(TIP_GAP_MS);
      }
      return;
    }
    this.hintVisible = true;
    this.cancelTip();
    this.paint('', text, UI.accent, false); // tagless cyan cue
    this.hintHideT = window.setTimeout(() => {
      this.hintVisible = false;
      this.fade();
      this.scheduleTip(TIP_GAP_MS);
    }, HINT_MS);
  }

  // --- Tip lane --------------------------------------------------------------

  private scheduleTip(delay: number): void {
    window.clearTimeout(this.tipT);
    this.tipT = window.setTimeout(() => this.showTip(), delay);
  }

  private showTip(): void {
    if (this.funcActive || this.hintVisible) {
      this.scheduleTip(TIP_GAP_MS); // bar is busy — try again after a rest
      return;
    }
    const text = FLIGHT_TIPS[this.tipIdx % FLIGHT_TIPS.length];
    this.tipIdx++;
    this.paint('TIP', text, UI.accent, false);
    this.tipHoldT = window.setTimeout(() => {
      this.fade();
      this.scheduleTip(TIP_GAP_MS);
    }, TIP_HOLD_MS);
  }

  /** After comms finish, rest, then resume the idle tip rotation. */
  private resumeAmbient(): void {
    this.hintVisible = false;
    this.scheduleTip(TIP_GAP_MS);
  }

  // --- Shared bar paint ------------------------------------------------------

  private paint(tag: string, text: string, color: string, glow: boolean): void {
    window.clearTimeout(this.hideT);
    this.tagEl.textContent = tag;
    this.tagEl.style.display = tag ? '' : 'none';
    this.tagEl.style.color = color;
    this.textEl.textContent = text;
    this.root.style.borderLeftColor = color;
    this.root.style.boxShadow = glow ? `0 0 12px ${color}66, ${UI.shadow}` : UI.shadow;
    this.root.style.display = 'flex';
    void this.root.offsetWidth; // force a reflow so the fade-in runs from opacity 0
    this.root.style.opacity = '1';
  }

  private fade(): void {
    this.root.style.opacity = '0';
    this.hideT = window.setTimeout(() => {
      this.root.style.display = 'none';
    }, 360);
  }

  private cancelTip(): void {
    window.clearTimeout(this.tipT);
    window.clearTimeout(this.tipHoldT);
  }

  private cancelAmbient(): void {
    window.clearTimeout(this.hintHideT);
    this.hintVisible = false;
    this.cancelTip();
  }

  /** Clear every tracked timer (the root is removed when the HUD root is). Idempotent. */
  dispose(): void {
    window.clearTimeout(this.funcHideT);
    window.clearTimeout(this.hintHideT);
    window.clearTimeout(this.hideT);
    this.cancelTip();
  }
}
