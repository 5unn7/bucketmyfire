/**
 * Open Skies live presence — the FREE-FOR-ALL multiplayer transport (Slice 3). Each pilot broadcasts
 * its heli pose over a Supabase Realtime **broadcast** channel keyed by the FFA session id; every peer
 * renders everyone else as a ghost (RemotePilots). This is PURE COSMETIC PRESENCE: no host, no shared
 * authority, no fire sync, no reconciliation — you fly your own local sim and just SEE the others. That
 * makes the whole thing tiny next to the old host-authoritative co-op plan (docs/COOP-PLAN.md).
 *
 * This module is **number-only** (no Three / DOM) and is the ONLY place `@supabase/realtime-js` is
 * imported — and it is reached **only** via a dynamic `import()` from Game (when a free-for-all round is
 * live AND Supabase is configured), so the realtime client is **code-split** and a solo player never
 * downloads it. Unconfigured → `connectOpenSkies` returns null and Game runs byte-for-byte solo.
 *
 * Broadcast is EPHEMERAL pub/sub (no table, no schema change). Best-effort throughout: every network
 * call is wrapped so a transport hiccup degrades to "no ghosts", never a thrown frame.
 */
import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';

/** The compact pose a pilot broadcasts each tick (the heli's world transform + a little state). */
export interface OwnPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  bank: number;
  pitch: number;
  agl: number; // height above the flight floor — lets a peer gate collisions on "both airborne"
  fill: number; // bucket fill 0..1 (for a ghost's bucket sag, later)
  flags: number; // bitfield (bucketAttached / dropping / crashing) — reserved
  score: number; // live free-for-all score (lets a peer show a live ladder without a DB read)
}

/** A remote pilot's last-known state, tagged with our local receipt time for staleness pruning. */
export interface RemoteState extends OwnPose {
  id: string;
  name: string;
  heli: string; // their heli model id → the ghost flies their airframe
  recv: number; // performance.now() at receipt
}

/**
 * A water-drop douse, broadcast so peers can knock the SAME fire down on their OWN field. Open Skies runs
 * an independent fire sim per client (only the seeded fires are shared), so without this a remote pour
 * visibly sprays but never changes your ground. The dropping client resolves the geometry once (its
 * wind-drifted impact centre + height-scaled footprint + litres released) and shares the RESULT; each peer
 * simply replays `fireSystem.douse(...)` at that spot. Pure numbers — no Three / DOM, like everything here.
 */
export interface DouseEvent {
  cx: number; // resolved impact centre X (world units)
  cz: number; // resolved impact centre Z
  radius: number; // footprint radius
  released: number; // litres released into this douse
  densityMul: number; // height/coverage density multiplier the dropper applied
}

/** The live transport handle Game drives. All methods are best-effort + never throw. */
export interface OpenSkiesNet {
  readonly self: { id: string; name: string; heli: string };
  sendPose(p: OwnPose): void;
  sendDouse(d: DouseEvent): void; // broadcast a resolved douse so peers extinguish the same fire
  drainDouses(): DouseEvent[]; // peer douses received since the last call (cleared on read)
  remotes(): RemoteState[]; // live (non-stale) remote pilots; prunes on read
  count(): number;
  close(): void;
}

// Hard cap on the unread-douse backlog: drain runs every frame, so this only bites if a frame stalls; it
// bounds memory rather than ever letting a burst pile up unboundedly.
const MAX_DOUSE_BACKLOG = 64;
const NO_DOUSES: DouseEvent[] = [];

const URL_BASE = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** True when Supabase is configured — gates the whole presence layer (else: solo, no ghosts). */
export function openSkiesConfigured(): boolean {
  return URL_BASE.length > 0 && ANON_KEY.length > 0;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Open the shared presence channel for a free-for-all session and start listening for peers. Returns a
 * best-effort transport handle, or null when Supabase is unconfigured / the client failed to construct.
 */
export function connectOpenSkies(
  sessionId: string,
  self: { id: string; name: string; heli: string },
  staleMs: number,
): OpenSkiesNet | null {
  if (!openSkiesConfigured()) return null;
  const peers = new Map<string, RemoteState>();
  let douses: DouseEvent[] = []; // peer douses received but not yet replayed onto our fire field
  let subscribed = false; // gate sends until the WS JOIN completes — else send() falls back to a REST POST
  let client: RealtimeClient;
  let channel: RealtimeChannel;
  try {
    client = new RealtimeClient(`${URL_BASE}/realtime/v1`, { params: { apikey: ANON_KEY } });
    channel = client.channel(`os:${sessionId}`, { config: { broadcast: { self: false } } });
    channel.on('broadcast', { event: 'pose' }, (msg) => {
      const p = (msg as { payload?: Record<string, unknown> }).payload;
      if (!p || typeof p.id !== 'string' || p.id === self.id) return;
      // Trust nothing: coerce every field to a finite number / string before it reaches the renderer.
      peers.set(p.id, {
        id: p.id,
        name: typeof p.name === 'string' ? p.name : 'Pilot',
        heli: typeof p.heli === 'string' ? p.heli : '',
        x: num(p.x),
        y: num(p.y),
        z: num(p.z),
        yaw: num(p.yaw),
        bank: num(p.bank),
        pitch: num(p.pitch),
        agl: num(p.agl),
        fill: num(p.fill),
        flags: num(p.flags),
        score: num(p.score),
        recv: nowMs(),
      });
    });
    channel.on('broadcast', { event: 'douse' }, (msg) => {
      const p = (msg as { payload?: Record<string, unknown> }).payload;
      if (!p || p.id === self.id) return; // ignore our own echo (self:false already drops it; belt + braces)
      douses.push({
        cx: num(p.cx),
        cz: num(p.cz),
        radius: num(p.radius),
        released: num(p.released),
        densityMul: num(p.densityMul),
      });
      if (douses.length > MAX_DOUSE_BACKLOG) douses.splice(0, douses.length - MAX_DOUSE_BACKLOG);
    });
    // Track JOIN state: only push poses once SUBSCRIBED. Any other status (joining / CHANNEL_ERROR /
    // CLOSED / TIMED_OUT) leaves `subscribed` false, so sendPose drops the pose instead of triggering
    // realtime-js's per-call REST fallback + console.warn (a 12 Hz flood if the WS never joins).
    channel.subscribe((status) => {
      subscribed = status === 'SUBSCRIBED';
    });
  } catch {
    return null;
  }
  const ch = channel;
  const cl = client;
  return {
    self,
    sendPose(p: OwnPose): void {
      if (!subscribed) return; // drop poses (cosmetic-only) until the WS JOIN lands — avoids the REST flood
      try {
        void ch.send({ type: 'broadcast', event: 'pose', payload: { ...p, id: self.id, name: self.name, heli: self.heli } });
      } catch {
        /* best-effort */
      }
    },
    sendDouse(d: DouseEvent): void {
      if (!subscribed) return; // drop until the WS JOIN lands — avoids the REST flood (same gate as poses)
      try {
        void ch.send({ type: 'broadcast', event: 'douse', payload: { ...d, id: self.id } });
      } catch {
        /* best-effort */
      }
    },
    drainDouses(): DouseEvent[] {
      if (douses.length === 0) return NO_DOUSES; // no alloc on the common empty frame
      const out = douses;
      douses = [];
      return out;
    },
    remotes(): RemoteState[] {
      const cut = nowMs() - staleMs;
      const out: RemoteState[] = [];
      for (const [id, r] of peers) {
        if (r.recv < cut) peers.delete(id);
        else out.push(r);
      }
      return out;
    },
    count(): number {
      return peers.size;
    },
    close(): void {
      try {
        void ch.unsubscribe();
      } catch {
        /* ignore */
      }
      try {
        void cl.disconnect();
      } catch {
        /* ignore */
      }
      peers.clear();
      douses = [];
    },
  };
}

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}
