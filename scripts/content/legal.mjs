/**
 * The legal pages (Privacy Policy, Terms of Use) as pure string builders, so they wear the SAME shared
 * chrome as the rest of the site: the siteNav appbar + mobile tab bar + a `Home / <page>` breadcrumb,
 * over the design tokens (warm "fight" register, DESIGN.md). The prose is the source of record here —
 * `scripts/build-legal.mjs` renders these into committed `public/privacy.html` + `public/terms.html`
 * (the same generated-and-committed pattern as `mockups/tokens.css`; re-run `npm run build:legal` after a
 * nav/token change). Plain Node, no DOM, no Vite.
 */

import { appbarHtml, tabbarHtml, breadcrumbHtml, footerBrandHtml, NAV_DEFS } from '../../src/site/siteNav.mjs';

const BASE_URL = 'https://bucketmyfire.com';

/** The shared legal document shell. `css` = tokens + navCss + LEGAL_CSS (assembled by build-legal.mjs). */
function legalShell({ title, slug, crumb, updated, css, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#05080b" />
    <meta name="robots" content="index,follow" />
    <link rel="icon" type="image/svg+xml" href="/icon.svg" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>${title} — Bucket My Fire</title>
    <link rel="canonical" href="${BASE_URL}/${slug}.html" />
    <style>${css}</style>
  </head>
  <body class="fn">
    <a class="fn-skip" href="#fn-main">Skip to content</a>
    ${NAV_DEFS}
    ${appbarHtml({ active: '', actions: 'none' })}
    <main id="fn-main" class="fn-wrap">
      ${breadcrumbHtml([{ label: 'Home', href: '/' }, { label: crumb }])}
      <header class="fd-hero"><div class="fd-hero-main">
        <p class="fd-hero-eyebrow">Bucket My Fire</p>
        <h1 class="fd-hero-head">${title}</h1>
      </div></header>
      <p class="fn-dateline">Last updated ${updated}</p>
      <div class="fn-legal">
${body}
      </div>
    </main>
    ${tabbarHtml('')}
    <footer class="fn-foot">
      ${footerBrandHtml()}
      <p class="fn-disclaimer">General information, not an emergency tool. In an emergency, follow official sources and local authorities.</p>
      <div class="fn-foot-links"><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></div>
    </footer>
    <!-- Embedded view: when opened in the front-door modal iframe (#embed) hide our own chrome so only the
         legal text shows; the modal supplies the title + close. -->
    <script>if(location.hash==='#embed')document.documentElement.classList.add('embed');</script>
  </body>
</html>
`;
}

const PRIVACY_BODY = `        <div class="fn-takeaways"><strong>The short version:</strong> Bucket My Fire is a free game you can play without giving us anything. The only personal data we ever touch is a <em>callsign</em> you choose (shown publicly on the leaderboard) and, <em>only if you opt in</em>, an email that is scrambled (hashed) on your own device before it ever leaves your browser. No passwords, no payment details, no advertising cookies, and we never sell your data.</div>

        <h2>Who we are</h2>
        <p>Bucket My Fire ("the game", "we", "us") is a free, browser-based game operated by an independent developer based in Saskatchewan, Canada. Questions or requests: <a href="mailto:privacy@bucketmyfire.com">privacy@bucketmyfire.com</a>.</p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Callsign</strong> — the name you choose. It is shown <strong>publicly</strong> on the global leaderboard. Please don't use your real name or anything private if you want to stay anonymous.</li>
          <li><strong>Email (optional)</strong> — only if you turn on cloud save. Your email is hashed (SHA-256) <em>on your device</em> before it is sent; we store only that hash, never the plain email, and we never send you marketing. It is used solely to save and restore your progress across devices.</li>
          <li><strong>Gameplay data</strong> — scores, mission results and best times, linked to your callsign so the leaderboard works.</li>
          <li><strong>Crash diagnostics</strong> — if the game errors, we may receive a technical error message and your browser type/version (user-agent), with no name, email, or other personal identifier attached, so we can fix bugs.</li>
          <li><strong>On-device storage</strong> — your progress and settings are kept in your browser's local storage, on your device. Clearing your browser data removes them.</li>
          <li><strong>Aggregate analytics</strong> — privacy-first, <em>cookieless</em> visitor counts via Cloudflare Web Analytics. No cookies, no cross-site tracking, no individual profiles.</li>
        </ul>

        <h2>What we do NOT collect</h2>
        <ul>
          <li>No passwords.</li>
          <li>No payment information. If you buy merchandise, the purchase is handled entirely by a third-party store with its own privacy policy — we never see your card details.</li>
          <li>No precise location, no advertising or tracking cookies, and we never sell your data.</li>
        </ul>

        <h2>Children</h2>
        <p>Bucket My Fire is not directed to children under 13, and we do not knowingly collect personal information from children under 13. The email field is always optional and is never required to play. If you believe a child has given us an email, contact <a href="mailto:privacy@bucketmyfire.com">privacy@bucketmyfire.com</a> and we will delete it.</p>

        <h2>Where your data lives</h2>
        <p>Leaderboard and cloud-save data is stored with Supabase (a third-party database provider); the site is delivered and analyzed via Cloudflare. These providers process data on our behalf under their own security and privacy terms, and data may be stored on servers outside Canada.</p>

        <h2>Your rights</h2>
        <p>Consistent with Canadian privacy law (PIPEDA) and, where applicable, the GDPR/CCPA, you may ask us to access, correct, or delete your personal data. To remove your cloud save or your leaderboard entry, email <a href="mailto:privacy@bucketmyfire.com">privacy@bucketmyfire.com</a> with your callsign and we will action it.</p>

        <h2>Changes</h2>
        <p>We may update this policy as the game grows; the "last updated" date above will change. Material changes will be noted in the game.</p>`;

const TERMS_BODY = `        <p>By playing Bucket My Fire ("the game") you agree to these Terms. If you don't agree, please don't use the game.</p>

        <h2>The game</h2>
        <p>Bucket My Fire is provided free of charge, "as is," for personal entertainment. We may change, suspend, or discontinue any part of it — including the leaderboard and cloud save — at any time, and features may be reset or removed.</p>

        <h2>Your licence to play</h2>
        <p>We grant you a personal, non-commercial, revocable licence to play the game in your browser. You may not copy, resell, redistribute, reverse-engineer, scrape, or clone the game or its assets, or use it to build a competing product.</p>

        <h2>Fair play &amp; conduct</h2>
        <ul>
          <li>Choose an appropriate callsign. Names that are offensive, hateful, impersonate others, or contain another person's private information may be removed.</li>
          <li>Don't cheat, exploit, automate, or tamper with the leaderboard or cloud save. We may remove scores or entries we believe are fraudulent or abusive.</li>
        </ul>

        <h2>Merchandise</h2>
        <p>Any merchandise is sold through a third-party print-on-demand store under that provider's own terms, pricing, shipping, and return policies. Your purchase contract is with that store, not with us, and your payment details are handled entirely by them.</p>

        <h2>Intellectual property &amp; fictional setting</h2>
        <p>"Bucket My Fire," its name, art, and code are owned by the operator. All other product names, trademarks, place names, and brands belong to their respective owners and are used for descriptive or setting purposes only. The game is a work of fiction: it is not affiliated with, sponsored by, or endorsed by any government, agency, community, manufacturer, or company, and any resemblance to real operations is for atmosphere, not accuracy.</p>

        <h2>No warranty; limitation of liability</h2>
        <p>The game is provided "as is," without warranties of any kind. To the fullest extent permitted by law, we are not liable for any indirect, incidental, or consequential damages arising from your use of the game. Some jurisdictions don't allow certain limitations, so some of these may not apply to you.</p>

        <h2>Governing law</h2>
        <p>These Terms are governed by the laws of the Province of Saskatchewan and the federal laws of Canada applicable there, without regard to conflict-of-laws rules.</p>

        <h2>Changes &amp; contact</h2>
        <p>We may update these Terms; the "last updated" date will change. Questions: <a href="mailto:privacy@bucketmyfire.com">privacy@bucketmyfire.com</a>.</p>`;

/** The compact prose CSS for the legal pages (the shared appbar/tab bar/breadcrumb come from navCss). */
export const LEGAL_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body.fn{ background: radial-gradient(130% 60% at 50% -8%, var(--ember-20) 0%, var(--ember-05) 30%, transparent 56%), linear-gradient(180deg,#0a0d10 0%,#0b0e10 42%,#07090b 100%); background-attachment:fixed; color:var(--text); font-family:var(--font); line-height:1.65; -webkit-font-smoothing:antialiased; }
a{color:var(--ember-hi);text-decoration:none} a:hover{color:var(--ember)}
.fn-skip{position:absolute;left:-9999px;top:0;background:var(--menu);color:#3a2406;padding:8px 12px;border-radius:8px}
.fn-skip:focus{left:8px;top:8px;z-index:50}
h1,h2,h3{font-weight:800;letter-spacing:-0.01em;line-height:1.2;color:#fff}
.fn-wrap{max-width:760px;margin:0 auto;padding:26px max(16px,env(safe-area-inset-left)) 64px}
/* Page title (eyebrow + headline) uses the SHARED .fd-hero standard from siteNav navCss. */
.fn-dateline{font-family:var(--mono);font-size:var(--fs-sm);color:var(--dim);margin:10px 0 26px}
.fn-legal{font-size:var(--fs-lg);line-height:1.65}
.fn-legal h2{font-size:clamp(18px,2.6vw,22px);margin:30px 0 10px;color:var(--ember-hi)}
.fn-legal p{margin:0 0 16px;color:var(--text-subtle)}
.fn-legal ul{margin:0 0 16px;padding-left:22px;color:var(--text-subtle)}
.fn-legal li{margin:7px 0}
.fn-legal a{font-weight:600}
.fn-takeaways{background:var(--card-soft);border:1px solid var(--stroke);border-left:3px solid var(--ember);border-radius:var(--r-md);padding:16px 20px;margin:0 0 26px;color:var(--text-subtle)}
.fn-foot{max-width:760px;margin:0 auto;padding:30px max(16px,env(safe-area-inset-left)) calc(40px + env(safe-area-inset-bottom));border-top:1px solid var(--hair);display:flex;flex-wrap:wrap;align-items:flex-end;column-gap:24px;row-gap:10px}
.fn-disclaimer{order:1;flex:1 1 100%;color:var(--dim);font-size:var(--fs-sm);max-width:60ch;line-height:1.55;margin:0}
.fn-foot-links{order:2;flex:0 1 auto;min-width:0;display:flex;flex-wrap:wrap;gap:8px 18px}
.fn-foot-links a{font-family:var(--mono);font-size:var(--fs-meta);letter-spacing:0.1em;text-transform:uppercase;color:var(--dim)}
.fn-foot-links a:hover{color:var(--ember-hi)}
/* Embedded in the front-door modal iframe (#embed → html.embed): hide our own chrome + the duplicate page
   title (the modal supplies title + close); the legal prose blends onto the modal's frosted card. */
html.embed .fhome-bar,html.embed .fd-tabbar,html.embed .fn-foot,html.embed .site-crumbs,html.embed .fd-hero{display:none!important}
html.embed body.fn{background:transparent}
html.embed .fn-wrap{padding-top:6px;padding-bottom:24px}
/* Branded "liquid glass" scrollbar — matches the front-door modal (.bmf-kit-scroll): a translucent ember
   thumb with a white-sheen top, floating on a clear track. So the legal page reads on-brand inside the
   modal iframe (and standalone). */
html{scrollbar-width:thin;scrollbar-color:var(--ember-50) transparent}
html::-webkit-scrollbar{width:10px}
html::-webkit-scrollbar-track{background:transparent}
html::-webkit-scrollbar-thumb{border-radius:var(--r-pill);border:2px solid transparent;background-clip:padding-box;background:linear-gradient(180deg,var(--bevel-top),var(--ember-50))}
html::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,var(--bevel-top),var(--ember))}
`;

/** Build the two legal pages. `css` = tokens + navCss + LEGAL_CSS. Returns `[{file, html}]`. */
export function legalPages(css) {
  return [
    {
      file: 'privacy.html',
      html: legalShell({ title: 'Privacy Policy', slug: 'privacy', crumb: 'Privacy', updated: '4 June 2026', css, body: PRIVACY_BODY }),
    },
    {
      file: 'terms.html',
      html: legalShell({ title: 'Terms of Use', slug: 'terms', crumb: 'Terms', updated: '4 June 2026', css, body: TERMS_BODY }),
    },
  ];
}
