/**
 * Image score-card for the end-of-mission Share — the single biggest virality upgrade (audit FIX #9).
 *
 * `HUD.shareRun` currently shares TEXT only; a shared text blob doesn't unfurl, but a shared IMAGE
 * posts as a picture on the native sheet and on every social platform. This renders a branded card
 * and shares it as a PNG FILE via the Web Share API, with graceful fallbacks: copy the image to the
 * clipboard (desktop) -> download the PNG -> copy a text link. Standalone + DOM-only (no Three.js),
 * so it drops into the HUD with a single call:
 *
 *     import { shareScoreCard } from './ui/shareCard';
 *     await shareScoreCard({ missionName: this.missionName, location, score: s.score,
 *                            stars: s.stars, won: s.won, callsign });
 *
 * Brand colours come from the shared UI palette (theme.ts) so the card matches the HUD.
 */
import { UI } from './theme';

// The app's solid background hexes (index.html / DESIGN.md). The UI palette only exposes TRANSLUCENT
// panel fills (the WebGL canvas is the real backdrop), so the card's opaque base lives here.
const BRAND_BG = '#0e160f';
const BRAND_PANEL = '#16241a';

export interface ScoreCardData {
  missionName: string; // e.g. "First Light"
  location?: string; // the place saved, e.g. "Weyakwin" (falls back to missionName)
  score: number;
  stars?: number; // 0..3
  won?: boolean;
  callsign?: string;
  url?: string; // default https://bucketmyfire.com
}

export type ShareOutcome = 'shared' | 'image-copied' | 'downloaded' | 'link-copied' | 'failed';

const CARD_W = 1200;
const CARD_H = 630; // OG ratio — also the right shape for X/Discord/iMessage previews

/**
 * Draw the branded score card to a canvas (no I/O). Reusable for an in-DOM preview as well as the
 * share blob.
 */
export function renderScoreCard(data: ScoreCardData): HTMLCanvasElement {
  const url = data.url ?? 'https://bucketmyfire.com';
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Base: dark vertical gradient + a warm "fire" glow rising from the lower centre.
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, BRAND_PANEL);
  bg.addColorStop(1, BRAND_BG);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = ctx.createRadialGradient(CARD_W / 2, CARD_H + 70, 50, CARD_W / 2, CARD_H + 70, 520);
  glow.addColorStop(0, 'rgba(255,122,69,0.30)');
  glow.addColorStop(1, 'rgba(255,122,69,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Hairline frame.
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, CARD_W - 48, CARD_H - 48);

  ctx.textBaseline = 'alphabetic';

  // Wordmark (top-left).
  ctx.textAlign = 'left';
  ctx.font = '700 34px system-ui, sans-serif';
  ctx.fillStyle = UI.text;
  const lead = '🚁  BUCKET ';
  ctx.fillText(lead, 64, 92);
  ctx.fillStyle = UI.warm;
  ctx.fillText('MY FIRE', 64 + ctx.measureText(lead).width, 92);

  // Outcome eyebrow.
  ctx.font = '600 26px system-ui, sans-serif';
  ctx.fillStyle = UI.accent;
  ctx.fillText(data.won ? 'MISSION COMPLETE' : 'SORTIE FLOWN', 64, 152);

  // Hero score.
  ctx.font = '800 170px system-ui, sans-serif';
  ctx.fillStyle = UI.text;
  ctx.fillText(data.score.toLocaleString(), 60, 352);
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.fillStyle = UI.dim;
  ctx.fillText('SCORE', 70, 396);

  // Stars (filled/dim out of 3).
  if (typeof data.stars === 'number') {
    const full = Math.max(0, Math.min(3, Math.round(data.stars)));
    ctx.font = '48px system-ui, sans-serif';
    ctx.fillStyle = UI.gold;
    let sx = 66;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = i < full ? 1 : 0.22;
      ctx.fillText('★', sx, 474);
      sx += 58;
    }
    ctx.globalAlpha = 1;
  }

  // Right block: what was saved + setting + pilot.
  ctx.textAlign = 'right';
  ctx.font = '700 46px system-ui, sans-serif';
  ctx.fillStyle = UI.text;
  const place = data.location || data.missionName;
  ctx.fillText(truncate(ctx, data.won ? `Saved ${place}` : place, 540), CARD_W - 64, 300);
  ctx.font = '500 28px system-ui, sans-serif';
  ctx.fillStyle = UI.dim;
  ctx.fillText('northern Saskatchewan', CARD_W - 64, 346);
  if (data.callsign) {
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.fillStyle = UI.water;
    ctx.fillText(truncate(ctx, `Pilot ${data.callsign}`, 540), CARD_W - 64, 394);
  }

  // Footer: domain + CTA.
  ctx.textAlign = 'left';
  ctx.font = '600 30px system-ui, sans-serif';
  ctx.fillStyle = UI.warm;
  ctx.fillText(url.replace(/^https?:\/\//, ''), 64, CARD_H - 58);
  ctx.textAlign = 'right';
  ctx.font = '500 26px system-ui, sans-serif';
  ctx.fillStyle = UI.dim;
  ctx.fillText('Beat my score ↗', CARD_W - 64, CARD_H - 58);

  return canvas;
}

/** Render + share the score card as an IMAGE, degrading gracefully. Returns what actually happened. */
export async function shareScoreCard(data: ScoreCardData): Promise<ShareOutcome> {
  const url = data.url ?? 'https://bucketmyfire.com';
  const place = data.location || data.missionName;
  const text = data.won
    ? `I saved ${place} with ${data.score.toLocaleString()} pts${starsText(data.stars)} in Bucket My Fire!`
    : `I scored ${data.score.toLocaleString()} pts in Bucket My Fire!`;

  let blob: Blob | null = null;
  try {
    blob = await canvasToBlob(renderScoreCard(data));
  } catch {
    blob = null;
  }

  if (blob) {
    const file = new File([blob], 'bucketmyfire-score.png', { type: 'image/png' });

    // 1) Native share with the image file (best — posts as a picture on the mobile sheet).
    try {
      const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
      if (typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: `${text} ${url}`, title: 'Bucket My Fire' });
        return 'shared';
      }
    } catch {
      /* user cancelled or share rejected the file — fall through to copy/download */
    }

    // 2) Copy the image to the clipboard (desktop browsers).
    try {
      const Clip = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (Clip && navigator.clipboard && 'write' in navigator.clipboard) {
        await navigator.clipboard.write([new Clip({ 'image/png': blob })]);
        return 'image-copied';
      }
    } catch {
      /* clipboard image blocked — fall through */
    }

    // 3) Download the PNG as a visual last resort.
    try {
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = 'bucketmyfire-score.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 4000);
      return 'downloaded';
    } catch {
      /* fall through to a text link */
    }
  }

  // 4) Text-link fallback (no canvas/blob support at all).
  try {
    await navigator.clipboard?.writeText(`${text} — play free at ${url}`);
    return 'link-copied';
  } catch {
    return 'failed';
  }
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

function starsText(stars?: number): string {
  if (typeof stars !== 'number' || stars <= 0) return '';
  const n = Math.max(0, Math.min(3, Math.round(stars)));
  return ` (${'★'.repeat(n)})`;
}
