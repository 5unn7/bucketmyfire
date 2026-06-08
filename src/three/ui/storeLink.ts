/**
 * Single source of truth for the merch store + how the game reaches it.
 *
 * The store is the standalone **bucketmyfire** storefront at `shop.bucketmyfire.com` — a separate
 * property (a headless Medusa + Next.js site on its own host), NOT part of this game bundle. The
 * three in-game funnel entry points — the title-screen **Shop** button, the home-rail **Shop** tab
 * (`navigateRail('shop')`), and the win-screen **Squadron Store** hook — all call `openStore()`,
 * which opens it in a NEW TAB so the game keeps running underneath. The legacy `/shop.html` waitlist
 * page now just redirects here for any external/bookmarked traffic.
 *
 * One constant so the URL (and the new-tab behaviour) live in exactly one place.
 */
export const STORE_URL = 'https://shop.bucketmyfire.com';

/** Open the merch store in a new tab. Called from a click handler (so the popup isn't blocked);
 *  `noopener,noreferrer` keeps the store from reaching back into the game's `window`. */
export function openStore(): void {
  window.open(STORE_URL, '_blank', 'noopener,noreferrer');
}
