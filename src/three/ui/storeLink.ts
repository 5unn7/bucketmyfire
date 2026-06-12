/**
 * Single source of truth for the merch store + how the game reaches it.
 *
 * The store's permanent home is the standalone **bucketmyfire** storefront at `shop.bucketmyfire.com`
 * (a headless Medusa + Next.js site on its own host) — but that domain isn't resolving yet, so for now
 * `STORE_URL` points at the SAME-DOMAIN coming-soon page (`/shop/`: the "Wear the fight." hero + the
 * Notify-me waitlist capture). Flip the constant back to the external URL once the shop domain is live;
 * nothing downstream changes. The three in-game funnel entry points — the title-screen **Shop** button,
 * the home-rail **Shop** tab (`navigateRail('shop')`), and the win-screen **Squadron Store** hook — all
 * call `openStore()`, which navigates in the SAME tab (a full context switch to the store).
 *
 * One constant so the URL (and the navigation behaviour) live in exactly one place.
 */
export const STORE_URL = '/shop/';

/** Where in the game the player clicked through to the store. Tagged onto the URL as standard UTM
 *  params so the storefront's analytics can attribute WHICH in-game moment actually sells — the
 *  win screen (highest intent), the home rail, or the title screen. The funnel is the brand's
 *  scoreboard; you can't grow what you can't measure. */
export type StoreSource = 'win' | 'home-rail' | 'title';

/** The store URL with funnel attribution baked in. (Resolved against the current origin so the
 *  constant can stay a same-domain path today and an absolute URL once the shop domain is live.) */
export function storeUrl(source: StoreSource): string {
  const u = new URL(STORE_URL, window.location.origin);
  u.searchParams.set('utm_source', 'bucketmyfire-game');
  u.searchParams.set('utm_medium', 'in-game');
  u.searchParams.set('utm_campaign', source);
  return u.toString();
}

/** Navigate to the merch store in the SAME tab — a full context switch (the player leaves the game
 *  for the store, exactly like the old `/shop.html` link did). Pass the funnel `source` so the click
 *  is still attributable on the storefront side via UTM. */
export function openStore(source: StoreSource): void {
  window.location.href = storeUrl(source);
}
