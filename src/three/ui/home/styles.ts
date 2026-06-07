/**
 * One injected stylesheet for the Home hub + its rail menus (HomeScreen, menus.ts). Everything is
 * scoped under `.bmf-app`, and the CSS custom properties are generated FROM `theme.ts` (the single
 * token source — DESIGN.md) so the menu uses the same palette/scale as the rest of the UI. The
 * instrument "metal" gradients are local extras (derived, not brand tokens).
 *
 * SINGLE-VIEWPORT, NO-SCROLL (CLAUDE.md hard rule): `.bmf-app` is a fixed full-viewport flex column;
 * its content area fits above the fixed rail and only scrolls internally as a safety net.
 */
import { tokenDecls } from '../tokens';
import { injectKitStyles } from '../components/base';

// Brand tokens come from the ONE source (ui/tokens.ts), shared verbatim with the generated
// mockups/tokens.css. Only the home-local instrument cosmetics (--metal*, --bevel-top, --rail-h)
// live here — they are screen decoration, not brand tokens.
const VARS = `.bmf-app{
  ${tokenDecls()}
  --metal:linear-gradient(160deg,#22262a 0%,#15191d 40%,#0d1013 100%);
  --metal-hi:linear-gradient(160deg,#2c3137 0%,#1a1e23 55%,#101317 100%);
  --bevel-top:rgba(255,255,255,0.14); --rail-h:72px;
}`;

const CSS = `
.bmf-app{ position:fixed; inset:0; z-index:50; height:100vh; height:100svh; height:100dvh; display:flex; flex-direction:column;
  font-family:var(--font); color:var(--text); background:#05080b; overflow:hidden; -webkit-font-smoothing:antialiased;
  -webkit-tap-highlight-color:transparent; }
.bmf-app *{ box-sizing:border-box; }
.bmf-app .scene{ position:absolute; inset:0; z-index:0; overflow:hidden;
  background:radial-gradient(130% 60% at 50% -8%, var(--ember-20) 0%, var(--ember-05) 30%, transparent 56%),
    radial-gradient(150% 90% at 50% 118%, rgba(255,120,40,0.12) 0%, transparent 52%),
    linear-gradient(180deg,#0a0d10 0%, #0b0e10 42%, #07090b 100%); }
.bmf-app .scene::after{ content:""; position:absolute; inset:0; pointer-events:none; box-shadow:inset 0 0 160px 50px rgba(0,0,0,0.7); }
.bmf-app .embers{ position:absolute; inset:0; z-index:1; pointer-events:none; overflow:hidden; }
.bmf-app .mote{ position:absolute; bottom:-12px; width:3px; height:3px; border-radius:50%;
  background:radial-gradient(circle, #ffd27a 0%, #ff7a2c 55%, transparent 75%); box-shadow:0 0 6px var(--glow-80); animation:bmf-rise-mote linear infinite; opacity:0; }
@keyframes bmf-rise-mote{ 0%{transform:translateY(0); opacity:0;} 12%{opacity:.9;} 80%{opacity:.7;} 100%{transform:translateY(-100vh) translateX(var(--drift,16px)); opacity:0;} }

.bmf-app .pad{ position:relative; z-index:2; flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none;
  width:100%; max-width:452px; margin:0 auto;
  padding: calc(env(safe-area-inset-top) + 14px) 16px calc(var(--rail-h) + env(safe-area-inset-bottom) + 14px); }
.bmf-app .pad::-webkit-scrollbar{ display:none; }

/* ===== HOME hub: single-viewport, NO PAGE SCROLL (CLAUDE.md hard rule). The pad is a fixed flex
   column that fits above the rail; the Continue art card is the flexible hero that absorbs all spare
   height — and shrinks its IMAGE, never the layout, on short phones — so the hub never scrolls. */
.bmf-app.home .pad{ display:flex; flex-direction:column; gap:11px; overflow:hidden;
  padding-top:calc(env(safe-area-inset-top) + 12px); padding-bottom:calc(var(--rail-h) + env(safe-area-inset-bottom) + 12px); }
.bmf-app.home .pad > header{ flex:0 0 auto; }
.bmf-app.home .zone{ display:flex; flex-direction:column; min-height:0; }
.bmf-app.home .z-daily{ flex:0 0 auto; }
.bmf-app.home .z-cont{ flex:1 1 auto; }
.bmf-app.home .sec{ margin:0 2px 8px; }
.bmf-app.home .z-cont .artcard{ flex:1 1 auto; min-height:200px; }
.bmf-app.home .z-cont .artcard .inner{ height:100%; min-height:0; }

.bmf-app .rise{ opacity:0; transform:translateY(14px); animation:bmf-rise .5s cubic-bezier(.16,.84,.3,1) forwards; }
.bmf-app .d1{animation-delay:.04s} .bmf-app .d2{animation-delay:.11s} .bmf-app .d3{animation-delay:.18s} .bmf-app .d4{animation-delay:.26s}
@keyframes bmf-rise{ to{ opacity:1; transform:none; } }

.bmf-app .row{ display:flex; align-items:center; } .bmf-app .between{ justify-content:space-between; }
.bmf-app .grow{ flex:1; min-width:0; } .bmf-app .wrap{ flex-wrap:wrap; }
.bmf-app .mono{ font-family:var(--mono); } .bmf-app .muted{ color:var(--dim); } .bmf-app .faint{ color:var(--faint); }

.bmf-app .eyebrow{ font-family:var(--mono); font-size:var(--fs-label); letter-spacing:.28em; text-transform:uppercase; color:var(--menu); font-weight:var(--fw-bold); }
.bmf-app .h-screen{ font-size:var(--fs-display); font-weight:var(--fw-black); letter-spacing:.01em; line-height:1.04; color:#fff; }
.bmf-app .h-big{ font-size:var(--fs-banner); font-weight:var(--fw-black); line-height:1.02; color:#fff; }
.bmf-app .clamp2{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

.bmf-app .sec{ display:flex; align-items:center; gap:10px; margin:16px 2px 9px; }
.bmf-app .sec .tag{ font-family:var(--mono); font-size:var(--fs-label); letter-spacing:.28em; text-transform:uppercase; color:var(--menu); font-weight:var(--fw-bold); }
.bmf-app .sec .line{ flex:1; height:1px; background:linear-gradient(90deg, var(--gold-32), transparent); }
.bmf-app .sec .stamp{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.16em; color:var(--faint); font-weight:var(--fw-bold); border:1px solid var(--hair); padding:2px 7px; border-radius:3px; white-space:nowrap; }
.bmf-app .sec .stamp.link{ cursor:pointer; color:var(--menu); border-color:var(--menu-soft); }

.bmf-app .appbar{ display:flex; align-items:center; gap:12px; min-height:44px; margin-bottom:6px; }
.bmf-app .iconbtn{ width:44px; height:44px; flex:0 0 auto; border-radius:var(--r-sm); border:1px solid var(--stroke); background:var(--card-soft); color:var(--dim); display:grid; place-items:center; cursor:pointer; transition:border-color .14s, color .14s, transform .14s; }
.bmf-app .iconbtn:hover{ color:var(--ember-hi); border-color:var(--warm-stroke); transform:translateY(-1px); }
.bmf-app .iconbtn svg{ width:17px; height:17px; }
.bmf-app .appbar .ttl{ font-size:var(--fs-title); font-weight:var(--fw-heavy); letter-spacing:.04em; text-transform:uppercase; }

.bmf-app .flame path,.bmf-app .flame polygon{ fill:url(#flameGrad); }
/* Brand mark badge — the SAME treatment as the daily glyph (sibling logos down the board), but
   calm (no flicker) + a soft outer ember halo that reads as the pilot's identity crest. */
.bmf-app .brand{ width:36px; height:36px; flex:0 0 auto; display:grid; place-items:center; border-radius:var(--r-sm);
  background:radial-gradient(circle at 40% 30%, var(--warm-38), rgba(10,12,14,0.9)); border:1px solid var(--warm-stroke);
  box-shadow:inset 0 0 10px var(--ember-35), 0 0 14px var(--ember-18); }
.bmf-app .brand svg{ width:17px; height:21px; filter:drop-shadow(0 0 4px var(--glow-80)); }
.bmf-app .brand.lg{ width:62px; height:62px; border-radius:var(--r-md); } .bmf-app .brand.lg svg{ width:31px; height:39px; }

.bmf-app .helmet{ position:relative; width:54px; height:54px; flex:0 0 auto; border-radius:var(--r-round);
  background:radial-gradient(circle at 38% 30%, #2b3034, #0c0f12 78%); border:2px solid #0a0c0e;
  box-shadow:0 0 0 1px rgba(255,255,255,0.06), inset 0 0 14px rgba(0,0,0,0.7), 0 5px 14px rgba(0,0,0,0.55); display:grid; place-items:center; }
.bmf-app .helmet::before{ content:""; position:absolute; inset:-3px; border-radius:50%; z-index:-1; opacity:.9;
  background:repeating-conic-gradient(#3a3f45 0deg 6deg, #181b1f 6deg 12deg);
  -webkit-mask:radial-gradient(circle, transparent 24px, #000 25px); mask:radial-gradient(circle, transparent 24px, #000 25px); }
.bmf-app .helmet .clip{ position:relative; width:36px; height:36px; overflow:hidden; border-radius:8px; }
.bmf-app .helmet .clip svg{ width:36px; height:36px; display:block; position:relative; z-index:1; }
.bmf-app .helmet .clip svg path{ fill:url(#helmGrad); filter:drop-shadow(0 1px 1px rgba(0,0,0,0.6)); }
.bmf-app .helmet .sheen{ position:absolute; inset:0; z-index:2; pointer-events:none; mix-blend-mode:screen; transform:translateX(-130%);
  background:linear-gradient(112deg, transparent 38%, rgba(255,255,255,0.78) 50%, transparent 62%); animation:bmf-sheen 5.4s ease-in-out 1.3s infinite; }
@keyframes bmf-sheen{ 0%{transform:translateX(-130%);} 18%{transform:translateX(130%);} 100%{transform:translateX(130%);} }

.bmf-app .card{ position:relative; background:var(--metal-hi); border:1px solid var(--stroke); border-top-color:var(--bevel-top);
  border-radius:var(--r-md); box-shadow:var(--shadow-card), inset 0 1px 0 rgba(255,255,255,0.05); padding:14px 15px; }
.bmf-app .card.metal{ background:var(--metal); }
.bmf-app .card.warm{ background:radial-gradient(120% 140% at 82% 0%, rgba(255,120,40,0.12), transparent 55%), var(--metal-hi); }
.bmf-app .card.cut{ clip-path:polygon(16px 0,100% 0,100% 100%,0 100%,0 16px); }
.bmf-app .card.click{ cursor:pointer; transition:transform .12s, border-color .12s; }
.bmf-app .card.click:hover{ transform:translateY(-2px); border-color:var(--warm-stroke); }
.bmf-app .card.crt{ overflow:hidden; }
.bmf-app .card.crt::after{ content:""; position:absolute; inset:0; pointer-events:none; mix-blend-mode:screen; opacity:.6;
  background:repeating-linear-gradient(0deg, rgba(255,170,60,0.035) 0 1px, transparent 1px 3px); }
.bmf-app .crt-streak{ position:absolute; top:0; left:0; right:0; height:2px; z-index:3; opacity:.85;
  background:linear-gradient(90deg,transparent,var(--ember) 30%,var(--ember-hi) 50%,var(--ember) 70%,transparent); animation:bmf-flick 3.4s ease-in-out infinite; }
@keyframes bmf-flick{ 0%,100%{opacity:.5} 30%{opacity:.95} 55%{opacity:.6} 80%{opacity:1} }

.bmf-app .artcard{ position:relative; border-radius:var(--r-xl); overflow:hidden; border:1px solid var(--stroke-strong); background:var(--card-bg);
  box-shadow:var(--shadow-card), 0 0 26px var(--ember-12); clip-path:polygon(0 0,100% 0,100% calc(100% - 22px),calc(100% - 22px) 100%,0 100%); }
/* The Continue hero is a single tap target — give it tactile lift on hover + a press response so it
   reads as the primary action (transform/shadow only; home-scoped so the menu carousels are untouched). */
.bmf-app.home .artcard[data-act]{ cursor:pointer; transition:transform .16s cubic-bezier(.16,.84,.3,1), box-shadow .25s ease, border-color .16s ease; }
.bmf-app.home .artcard[data-act]:hover{ transform:translateY(-3px); box-shadow:var(--shadow-card), 0 0 34px var(--ember-22); border-color:var(--warm-stroke); }
.bmf-app.home .artcard[data-act]:active{ transform:translateY(-1px) scale(.995); }
/* Hover deepens the moment: the poster pushes in slightly (cinematic, Forza/GTA energy) and the corner
   reticle snaps to full accent — "target locked". Both motivated feedback, transform/token only. */
.bmf-app.home .artcard[data-act] .img{ transition:transform .6s cubic-bezier(.16,.84,.3,1); }
.bmf-app.home .artcard[data-act] .brackets i{ transition:border-color .2s ease, opacity .2s ease; }
.bmf-app.home .artcard[data-act]:hover .img{ transform:scale(1.05); }
.bmf-app.home .artcard[data-act]:hover .brackets i{ border-color:var(--menu); opacity:1; }
.bmf-app .artcard .img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 34%; z-index:0; }
.bmf-app .artcard .fallback{ position:absolute; inset:0; z-index:0; background:radial-gradient(120% 90% at 50% 120%, var(--ember-50), transparent 60%), linear-gradient(160deg,#2a2030,#160d12 70%); display:grid; place-items:center; }
.bmf-app .artcard .fallback b{ font-family:var(--mono); font-weight:var(--fw-black); font-size:64px; color:rgba(255,255,255,0.07); }
.bmf-app .artcard .scrim{ position:absolute; inset:0; z-index:1; pointer-events:none;
  background:linear-gradient(180deg, rgba(8,6,4,0.05) 0%, rgba(8,6,4,0.1) 32%, rgba(6,4,3,0.8) 74%, rgba(4,3,2,0.95) 100%), linear-gradient(90deg, rgba(4,3,2,0.6) 0%, transparent 46%); }
.bmf-app .artcard .inner{ position:relative; z-index:3; padding:15px 16px 18px; display:flex; flex-direction:column; }
/* auto-layout: the title/body/footer stack sits at the BASE of the poster (margin-top:auto), one gap
   between its rows — no spacer div, no per-element margins. Shared by the Map + Hangar poster cards. */
.bmf-app .artcard .pc-stack{ margin-top:auto; display:flex; flex-direction:column; gap:11px; }
.bmf-app .artcard .pc-title{ font-size:var(--fs-display); }
.bmf-app .brackets{ position:absolute; inset:11px; z-index:2; pointer-events:none; }
.bmf-app .brackets i{ position:absolute; width:15px; height:15px; border-color:var(--menu-soft); opacity:.6; }
.bmf-app .brackets i:nth-child(1){ top:0; left:0; border-top:2px solid; border-left:2px solid; }
.bmf-app .brackets i:nth-child(2){ top:0; right:0; border-top:2px solid; border-right:2px solid; }
.bmf-app .brackets i:nth-child(3){ bottom:0; left:0; border-bottom:2px solid; border-left:2px solid; }

.bmf-app .chip{ display:inline-flex; align-items:center; gap:5px; font-family:var(--mono); font-size:var(--fs-tag); letter-spacing:.18em; text-transform:uppercase; color:var(--cta-ink); font-weight:var(--fw-heavy); background:var(--cta); padding:4px 9px; border-radius:4px; box-shadow:0 1px 0 rgba(255,255,255,0.4) inset, 0 2px 8px rgba(239,170,43,0.4); white-space:nowrap; }
.bmf-app .chip.ghost{ color:var(--ember-hi); background:rgba(8,6,4,0.55); border:1px solid var(--warm-stroke); box-shadow:none; font-weight:var(--fw-bold); }
.bmf-app .chip svg{ width:11px; height:11px; }
.bmf-app .chip.reg{ letter-spacing:.12em; } /* region pin pill — looser tracking so the place name stays readable */

.bmf-app .ctx-row{ display:flex; flex-wrap:wrap; gap:7px; }
.bmf-app .ctx{ display:inline-flex; align-items:center; gap:5px; font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.1em; text-transform:uppercase; font-weight:var(--fw-bold); color:var(--dim); padding:5px 9px; border-radius:var(--r-sm); background:var(--recess); border:1px solid var(--hair); }
.bmf-app .ctx.hot{ color:var(--ember-hi); border-color:var(--warm-stroke); background:var(--ember-10); }
.bmf-app .ctx svg{ width:12px; height:12px; }

/* the global-rank readout is a .badge variant — inherits the canonical radius/border/tone, but sits in
   the dossier header beside the 36px .iconbtns, so it matches THEIR height (not the 26px status-pill
   height) to keep that row flush. It just swaps the single uppercase label for a #number + tiny caption. */
.bmf-app .grank{ gap:7px; height:36px; padding:0 13px; }
.bmf-app .grank b{ font-size:var(--fs-lg); font-weight:var(--fw-bold); color:var(--menu); }
.bmf-app .grank span{ font-size:var(--fs-micro); letter-spacing:.22em; color:var(--faint); }

.bmf-app .rank{ display:inline-flex; align-items:center; gap:6px; font-family:var(--mono); font-size:var(--fs-tag); font-weight:var(--fw-bold); letter-spacing:.16em; text-transform:uppercase; color:var(--rk,var(--rank)); padding:3px 9px 3px 7px; white-space:nowrap;
  background:repeating-linear-gradient(45deg, rgba(255,160,51,0.12) 0 2px, transparent 2px 4px), rgba(255,160,51,0.10);
  border:1.5px solid color-mix(in srgb, var(--rk,var(--rank)) 70%, transparent);
  clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px);
  box-shadow:inset 0 0 8px color-mix(in srgb, var(--rk,var(--rank)) 18%, transparent), 0 0 12px color-mix(in srgb, var(--rk,var(--rank)) 20%, transparent); }
.bmf-app .rank i{ width:7px; height:7px; border-radius:1px; transform:rotate(45deg); background:var(--rk,var(--rank)); box-shadow:0 0 6px color-mix(in srgb, var(--rk,var(--rank)) 85%, transparent); }

.bmf-app .glyph{ width:36px; height:36px; flex:0 0 auto; display:grid; place-items:center; border-radius:var(--r-sm); border:1px solid var(--warm-stroke);
  background:radial-gradient(circle at 40% 30%, var(--warm-38), rgba(10,12,14,0.9)); box-shadow:inset 0 0 10px var(--ember-35); }
.bmf-app .glyph svg{ width:17px; height:21px; } .bmf-app .glyph svg path{ fill:url(#flameGrad); filter:drop-shadow(0 0 4px var(--glow-80)); }
.bmf-app .glyph.flicker svg path{ animation:bmf-glyph 2.8s ease-in-out infinite; }
@keyframes bmf-glyph{ 0%,100%{opacity:1;transform:scale(1)} 45%{opacity:.82;transform:scale(.97)} 70%{opacity:.95} }


/* Daily Burn card: a COMPACT dispatch slip — brand-mark glyph at left (same logo as the dossier),
   collapsible. The whole header row is the toggle; the body holds the brief + resets/Fly. Default
   collapsed on phone/tablet (single-viewport), expanded on the desktop dashboard (set in markup). */
.bmf-app .daily-head{ display:flex; align-items:center; gap:12px; width:100%; background:none; border:0; padding:0; margin:0; font:inherit; color:inherit; text-align:left; cursor:pointer; -webkit-tap-highlight-color:transparent; }
.bmf-app .daily-head .dhead-id{ display:flex; flex-direction:column; gap:3px; flex:1; min-width:0; }
.bmf-app .daily-head .glyph{ flex:0 0 auto; }
.bmf-app .chev{ display:inline-grid; place-items:center; width:24px; height:24px; flex:0 0 auto; color:var(--dim); transition:transform .22s ease, color .2s; }
.bmf-app .chev svg{ width:16px; height:16px; }
.bmf-app .daily-head:hover .chev{ color:var(--ember-hi); }
.bmf-app .daily.collapsed .chev{ transform:rotate(-90deg); }
.bmf-app .daily-body{ overflow:hidden; }
.bmf-app .daily.collapsed .daily-body{ display:none; }
.bmf-app .dbrief{ margin-top:13px; font-size:var(--fs-body); line-height:1.45; color:rgba(255,255,255,0.86);
  padding-left:11px; border-left:3px solid var(--fire);
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

.bmf-app .stars{ display:inline-flex; gap:3px; } .bmf-app .stars svg{ width:15px; height:15px; }
.bmf-app .stars .on{ fill:var(--menu); stroke:none; filter:drop-shadow(0 0 5px var(--gold-70)); }
.bmf-app .stars .off{ fill:rgba(255,255,255,0.2); stroke:none; }

.bmf-app .bar{ height:6px; border-radius:var(--r-pill); background:var(--recess); overflow:hidden; border:1px solid var(--hair); box-shadow:inset 0 1px 3px rgba(0,0,0,0.6); position:relative; }
.bmf-app .bar > i{ display:block; height:100%; border-radius:var(--r-pill); background:linear-gradient(90deg,var(--fire),var(--ember-hi)); box-shadow:0 0 8px var(--glow-50); }
.bmf-app .barrow{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px; }
.bmf-app .barrow .l{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.18em; text-transform:uppercase; color:var(--dim); }
.bmf-app .barrow .r{ font-family:var(--mono); font-size:var(--fs-tag); color:var(--ember-hi); font-weight:var(--fw-bold); }
/* Home bars sweep to their fill on load — premium entrance that complements the staggered .rise. */
.bmf-app.home .bar > i{ animation:bmf-bar-grow .9s .3s cubic-bezier(.2,.8,.2,1) backwards; }
@keyframes bmf-bar-grow{ from{ width:0; } }
.bmf-app .spec{ display:grid; grid-template-columns:64px 1fr; align-items:center; gap:10px; margin:7px 0; }
.bmf-app .spec .name{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.12em; text-transform:uppercase; color:var(--dim); }
.bmf-app .spec .track{ height:7px; border-radius:var(--r-pill); background:var(--recess); border:1px solid var(--hair); overflow:hidden; }
.bmf-app .spec .track > i{ display:block; height:100%; background:linear-gradient(90deg,var(--fire),var(--ember-hi)); border-radius:var(--r-pill); }

/* The canonical .btn now lives globally in components/base.ts (injectKitStyles) — ONE button of record,
   shared by makeButton() and this hub's class="btn …" markup (injectHomeStyles pulls the kit in).
   Removed from here: the duplicate that had drifted (8px vs the kit's rugged 10px radius, and a
   round-pill .ember). No round pills now. */

.bmf-app .listrow{ display:flex; align-items:center; gap:12px; padding:11px 12px; border-radius:var(--r-md); background:var(--card-soft); border:1px solid var(--hair); }
.bmf-app .listrow + .listrow{ margin-top:7px; }
.bmf-app .listrow.mine{ background:var(--rowmine); border-color:var(--menu-soft); }
.bmf-app .listrow .pos{ font-family:var(--mono); font-size:var(--fs-md); font-weight:var(--fw-bold); color:var(--dim); width:34px; text-align:center; flex:0 0 auto; }
.bmf-app .listrow .pos.m1{ color:var(--gold); } .bmf-app .listrow .pos.m2{ color:var(--silver); } .bmf-app .listrow .pos.m3{ color:var(--bronze); }
.bmf-app .listrow .n{ font-size:var(--fs-lg); font-weight:var(--fw-semibold); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bmf-app .listrow .val{ font-family:var(--mono); font-size:var(--fs-lg); font-weight:var(--fw-bold); color:var(--menu); }

.bmf-app .hscroll{ display:flex; gap:13px; overflow-x:auto; scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; scrollbar-width:none; margin:0 -16px; padding:2px 16px 4px; }
.bmf-app .hscroll::-webkit-scrollbar{ display:none; } .bmf-app .hscroll > *{ scroll-snap-align:center; flex:0 0 auto; }
.bmf-app .dots{ display:flex; justify-content:center; gap:6px; margin-top:12px; }
.bmf-app .dots i{ width:6px; height:6px; border-radius:50%; background:var(--track); transition:width .2s, background .2s; }
.bmf-app .dots i.on{ width:18px; border-radius:var(--r-pill); background:var(--menu); }

/* ===== hero carousel — Maps + Hangar share ONE shell (full-bleed, one card at a time) ===== */
.bmf-app .carousel{ position:relative; margin:8px -16px 0; }
.bmf-app .ctrack{ display:flex; gap:14px; overflow-x:auto; scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; scrollbar-width:none; padding:14px 16px 6px; }
.bmf-app .ctrack::-webkit-scrollbar{ display:none; }
.bmf-app .cslide{ scroll-snap-align:center; flex:0 0 min(82%,360px); cursor:pointer; opacity:.42; transform:scale(.91);
  transition:opacity .34s ease, transform .34s cubic-bezier(.16,.84,.3,1); }
.bmf-app .cslide.active{ opacity:1; transform:scale(1); }
.bmf-app .cslide .artcard{ height:100%; }
.bmf-app .cslide .artcard .inner{ min-height:330px; }
.bmf-app .cslide .artcard.heli .inner{ min-height:368px; }
.bmf-app .cslide.locked .artcard{ filter:grayscale(.5) brightness(.72); }
.bmf-app .cslide:not(.active):hover{ opacity:.66; }

.bmf-app .cnav{ position:absolute; top:46%; transform:translateY(-50%); z-index:6; width:44px; height:44px; border-radius:50%; display:grid; place-items:center; cursor:pointer; color:var(--ember-hi); padding:0;
  background:rgba(10,13,16,0.74); border:1px solid var(--warm-stroke); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  box-shadow:0 6px 18px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06); transition:transform .14s, background .14s, opacity .22s; }
.bmf-app .cnav svg{ width:20px; height:20px; }
.bmf-app .cnav.prev{ left:6px; } .bmf-app .cnav.next{ right:6px; }
.bmf-app .cnav:hover{ background:var(--ember-18); transform:translateY(-50%) scale(1.07); }
.bmf-app .cnav.hide{ opacity:0; pointer-events:none; }

/* Mobile (phone): the Campaign / Hangar hero carousel FILLS the space between the header and the
   rail, so the card always fits one viewport — it shrinks on short phones instead of overflowing or
   forcing a scroll. Tablet/desktop keep their taller fixed-height flanked hero (media blocks below). */
@media (max-width:739px){
  .bmf-app .pad:has(> .carousel){ display:flex; flex-direction:column; overflow:hidden; }
  .bmf-app .pad:has(> .carousel) > .carousel{ flex:1 1 auto; min-height:0; }
  .bmf-app .pad:has(> .carousel) .ctrack{ height:100%; }
  .bmf-app .pad:has(> .carousel) .cslide{ height:100%; }
  .bmf-app .pad:has(> .carousel) .cslide .artcard .inner{ min-height:0; height:100%; }
}

/* heli hero — procedural "hangar bay" art tinted by the airframe accent (--accent) */
.bmf-app .artcard.heli .heli-art{ position:absolute; inset:0; z-index:0; overflow:hidden;
  background:radial-gradient(95% 72% at 50% 30%, color-mix(in srgb, var(--accent,#c8362a) 50%, transparent), transparent 68%),
    radial-gradient(120% 90% at 50% 122%, var(--ember-32), transparent 58%),
    linear-gradient(160deg,#181c20 0%,#0b0e11 76%); }
.bmf-app .artcard.heli .heli-art .grid{ position:absolute; inset:0; opacity:.15;
  background-image:linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px); background-size:28px 28px;
  -webkit-mask:radial-gradient(circle at 50% 33%, #000 4%, transparent 68%); mask:radial-gradient(circle at 50% 33%, #000 4%, transparent 68%); }
.bmf-app .artcard.heli .heli-art .ring{ position:absolute; top:18px; left:50%; transform:translateX(-50%); width:150px; height:150px; border-radius:50%;
  border:1px dashed color-mix(in srgb, var(--accent,#c8362a) 62%, transparent); opacity:.45; animation:bmf-rotor 9s linear infinite; }
@keyframes bmf-rotor{ to{ transform:translateX(-50%) rotate(360deg); } }
.bmf-app .artcard.heli .heli-art .mark{ position:absolute; top:36px; left:0; right:0; display:grid; place-items:center; }
.bmf-app .artcard.heli .heli-art .mark svg{ width:112px; height:112px; color:#fff; opacity:.94; filter:drop-shadow(0 8px 26px rgba(0,0,0,0.6)); }
/* Brand flame livery mark — a small ember roundel on the airframe (fills via .flame → flameGrad). */
.bmf-app .artcard.heli .heli-art .livery{ position:absolute; right:18px; top:72px; width:23px; height:28px; z-index:2; opacity:.7; }
.bmf-app .artcard.heli .heli-art .livery svg{ width:100%; height:100%; }

.bmf-app .specgrid{ display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; margin:11px 0 2px; }
.bmf-app .specgrid .spec{ grid-template-columns:50px 1fr; gap:8px; margin:0; }
.bmf-app .specgrid .spec .name{ color:rgba(255,255,255,0.62); }

/* ===== mission card LIST (accordion) — copy on the left, art on the right, gradient fade left =====
   One vertical stack; the active mission expands (reveals its CTA), collapsed cards keep ALL their
   copy. The right-anchored poster reads through a left-to-right scrim so the left-hand text stays
   legible over any image. This is the one permitted bounded inner-scroll list (CLAUDE.md). */
.bmf-app .mlist{ display:flex; flex-direction:column; gap:11px; margin-top:12px; }
.bmf-app .mcard{ position:relative; display:block; width:100%; text-align:left; cursor:pointer; overflow:hidden;
  border-radius:var(--r-lg); border:1px solid var(--stroke-strong); background:var(--card-bg); color:inherit; font:inherit;
  box-shadow:var(--shadow-card); transition:border-color .18s, box-shadow .25s, transform .12s;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%); -webkit-tap-highlight-color:transparent; }
.bmf-app .mcard:hover{ border-color:var(--warm-stroke); transform:translateY(-1px); }
.bmf-app .mcard.active{ border-color:var(--menu-soft); box-shadow:var(--shadow-card), 0 0 26px var(--ember-14); transform:none; }
.bmf-app .mcard:focus-visible{ outline:none; border-color:var(--ember); box-shadow:0 0 0 3px var(--ember-22); }
/* right-anchored art + the left-fading scrim that buys the copy its contrast */
.bmf-app .mcard .mart{ position:absolute; inset:0; z-index:0; }
.bmf-app .mcard .mart .img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:80% 36%; }
.bmf-app .mcard .mart .fallback{ position:absolute; inset:0; background:radial-gradient(120% 96% at 82% 28%, var(--ember-42), transparent 62%), linear-gradient(160deg,#2a2030,#160d12 72%); }
.bmf-app .mcard .mart .fallback b{ position:absolute; right:20px; top:50%; transform:translateY(-50%); font-family:var(--mono); font-weight:var(--fw-black); font-size:56px; color:rgba(255,255,255,0.08); }
.bmf-app .mcard .mfade{ position:absolute; inset:0; z-index:1; pointer-events:none;
  background:linear-gradient(90deg, var(--card-bg) 0%, var(--card-bg) 34%, rgba(10,14,18,0.80) 55%, rgba(10,14,18,0.20) 80%, transparent 100%),
    linear-gradient(0deg, rgba(5,8,11,0.55) 0%, transparent 42%); }
.bmf-app .mcard.locked .mart{ filter:grayscale(.6) brightness(.6); }
.bmf-app .mcard .mbody{ position:relative; z-index:2; padding:13px 15px; max-width:74%; }
.bmf-app .mcard .mhead{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
.bmf-app .mcard .mname{ font-size:var(--fs-lg); font-weight:var(--fw-black); line-height:1.1; color:#fff; margin-top:10px; }
.bmf-app .mcard .mtag{ font-size:var(--fs-meta); line-height:1.42; color:rgba(255,255,255,0.82); margin-top:6px; max-width:32ch; }
.bmf-app .mcard .mmeta{ display:flex; align-items:center; gap:12px; margin-top:10px; }
/* expand region — grid-rows trick animates the reveal without measuring height */
.bmf-app .mcard .mexpand{ display:grid; grid-template-rows:0fr; transition:grid-template-rows .28s cubic-bezier(.16,.84,.3,1); }
.bmf-app .mcard .mexpand > div{ overflow:hidden; min-height:0; }
.bmf-app .mcard.active .mexpand{ grid-template-rows:1fr; }
.bmf-app .mcard .mbrief{ font-size:var(--fs-meta); line-height:1.5; color:rgba(255,255,255,0.7); margin-top:11px; max-width:34ch; }
.bmf-app .mcard .mexpand .btn{ margin-top:13px; max-width:300px; }

/* ===== bottom rail ===== */
.bmf-app .rail{ position:absolute; left:0; right:0; bottom:0; z-index:40; height:calc(var(--rail-h) + env(safe-area-inset-bottom)); padding-bottom:env(safe-area-inset-bottom);
  background:linear-gradient(180deg,#15191d 0%, #0c0f12 100%); border-top:1px solid var(--bevel-top); box-shadow:0 -8px 24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05); }
.bmf-app .rail .keys{ max-width:452px; margin:0 auto; height:var(--rail-h); display:flex; align-items:stretch; }
.bmf-app .key{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; cursor:pointer; position:relative; border:0; background:transparent; color:var(--dim); font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.02em; text-transform:uppercase; font-weight:var(--fw-bold); }
.bmf-app .key + .key::before{ content:""; position:absolute; left:0; top:20%; bottom:20%; width:1px; background:rgba(0,0,0,0.5); }
.bmf-app .key svg{ width:20px; height:20px; transition:transform .12s, filter .12s; }
.bmf-app .key:hover{ color:rgba(255,255,255,0.7); }
.bmf-app .key.active{ color:var(--ember-hi); }
.bmf-app .key.active svg{ filter:drop-shadow(0 0 9px var(--glow-50)) drop-shadow(0 0 3px var(--ember-hi)); transform:translateY(-1px); }
.bmf-app .key .tick{ position:absolute; top:3px; width:18px; height:2px; border-radius:2px; background:var(--ember-hi); box-shadow:0 0 8px var(--glow-90); }

/* ===== bottom sheet / rows / toggle ===== */
.bmf-app .srow{ display:flex; align-items:center; gap:12px; padding:13px 2px; border-bottom:1px solid var(--hair); }
.bmf-app .srow:last-child{ border-bottom:0; }
.bmf-app .srow .ic{ width:30px; height:30px; flex:0 0 auto; border-radius:var(--r-sm); display:grid; place-items:center; background:var(--recess); border:1px solid var(--hair); color:var(--menu-soft); }
.bmf-app .srow .ic svg{ width:15px; height:15px; }
.bmf-app .srow .t{ font-size:var(--fs-md); font-weight:var(--fw-semibold); color:var(--text); }
.bmf-app .srow .s{ font-size:var(--fs-meta); color:var(--dim); margin-top:2px; }
.bmf-app .srow .s.ok{ color:var(--ok); }
.bmf-app .srow.danger .ic{ color:var(--warn); } .bmf-app .srow.danger .t{ color:var(--warn); }
.bmf-app .toggle{ width:48px; height:27px; flex:0 0 auto; border-radius:var(--r-pill); position:relative; cursor:pointer; background:var(--recess); border:1px solid var(--hair); box-shadow:inset 0 2px 4px rgba(0,0,0,0.5); transition:background .18s, border-color .18s; }
.bmf-app .toggle .knob{ position:absolute; top:2px; left:2px; width:21px; height:21px; border-radius:50%; background:linear-gradient(180deg,#d8dde2,#9aa1a8); box-shadow:0 2px 4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.6); transition:transform .18s cubic-bezier(.3,1.3,.5,1), background .18s; }
.bmf-app .toggle.on{ background:linear-gradient(180deg, var(--fire-55), var(--ember-35)); border-color:var(--warm-stroke); box-shadow:inset 0 0 8px var(--ember-40); }
.bmf-app .toggle.on .knob{ transform:translateX(21px); background:linear-gradient(180deg,#fff,#ffd9a0); }

/* ===== themed modal (confirm / prompt) — replaces native window.prompt/confirm (menus.ts) ===== */
.bmf-app .modal{ position:absolute; inset:0; z-index:80; display:flex; align-items:center; justify-content:center; padding:22px;
  background:radial-gradient(120% 90% at 50% 38%, rgba(8,5,4,0.62), rgba(3,2,1,0.86)); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur);
  animation:bmf-rise .22s ease forwards; }
.bmf-app .modal-card{ width:100%; max-width:380px; background:var(--card-glass); border:1px solid var(--stroke); border-top-color:var(--bevel-top);
  border-radius:var(--r-xl); box-shadow:var(--shadow-card), inset 0 1px 0 rgba(255,255,255,0.05); padding:18px 18px 16px; }
.bmf-app .modal.danger .modal-card{ border-color:var(--warm-stroke); box-shadow:var(--shadow-card), 0 0 26px var(--warn-16); }
.bmf-app .modal-head{ display:flex; align-items:flex-start; gap:11px; margin-bottom:13px; }
.bmf-app .modal-head .mglyph{ width:34px; height:34px; flex:0 0 auto; display:grid; place-items:center; border-radius:var(--r-sm); border:1px solid var(--warm-stroke);
  background:radial-gradient(circle at 40% 30%, var(--warm-38), rgba(10,12,14,0.9)); color:var(--ember-hi); }
.bmf-app .modal.danger .modal-head .mglyph{ color:var(--warn); border-color:var(--warn-50); background:radial-gradient(circle at 40% 30%, var(--warn-22), rgba(10,12,14,0.9)); }
.bmf-app .modal-head .mglyph svg{ width:17px; height:17px; }
.bmf-app .modal-head .mtitle{ font-size:var(--fs-hero); font-weight:var(--fw-heavy); letter-spacing:.01em; color:#fff; }
.bmf-app .modal-head .msub{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.16em; text-transform:uppercase; color:var(--faint); margin-top:3px; }
.bmf-app .modal-head .mclose{ width:44px; height:44px; flex:0 0 auto; border-radius:var(--r-sm); border:1px solid var(--stroke); background:var(--card-soft); color:var(--dim); display:grid; place-items:center; cursor:pointer; transition:border-color .14s, color .14s; }
.bmf-app .modal-head .mclose:hover{ color:var(--text); border-color:var(--stroke-strong); } .bmf-app .modal-head .mclose svg{ width:16px; height:16px; }
.bmf-app .modal-body .mtext{ font-size:var(--fs-sm); line-height:1.55; color:var(--dim); margin:0; }
.bmf-app .modal-actions{ display:flex; gap:10px; margin-top:18px; } .bmf-app .modal-actions .btn{ flex:1; }

/* ===== text fields (new-pilot registration) — warm ember focus, the fight register ===== */
.bmf-app .field{ display:flex; align-items:center; gap:11px; background:var(--field); border:1px solid var(--stroke); border-radius:var(--r-lg);
  padding:0 15px; transition:border-color .18s ease, box-shadow .18s ease; }
.bmf-app .field:focus-within{ border-color:var(--ember); box-shadow:0 0 0 3px var(--ember-18), 0 2px 18px var(--ember-12); }
.bmf-app .field .pfx{ flex:0 0 auto; display:grid; place-items:center; color:var(--ember); }
.bmf-app .field .pfx svg{ width:18px; height:18px; }
/* brand pilot-helmet mark in the callsign field — fill via the shared helmet gradient (DEFS) */
.bmf-app .field .pfx.pilot svg{ width:21px; height:21px; }
.bmf-app .field .pfx.pilot svg path{ fill:url(#helmGrad); }
.bmf-app .field input{ flex:1; min-width:0; background:transparent; border:none; outline:none; color:#fff; font-family:var(--font);
  font-size:var(--fs-lg); font-weight:var(--fw-semibold); letter-spacing:.01em; padding:14px 0; }
.bmf-app .field input::placeholder{ color:var(--faint); font-weight:var(--fw-medium); letter-spacing:0; }
.bmf-app .field.sm input{ font-size:var(--fs-md); font-weight:var(--fw-medium); padding:12px 0; }
.bmf-app .field .max{ flex:0 0 auto; font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.1em; color:var(--faint); }
.bmf-app .fieldlabel{ font-family:var(--mono); font-size:var(--fs-label); letter-spacing:.22em; text-transform:uppercase; font-weight:var(--fw-bold); color:var(--ember); margin:0 0 8px; }
.bmf-app .fieldlabel .opt{ color:var(--faint); font-weight:var(--fw-medium); letter-spacing:.04em; text-transform:none; }
.bmf-app .fhint{ font-size:var(--fs-meta); color:var(--faint); line-height:1.5; margin-top:8px; }
.bmf-app .fmsg{ font-size:var(--fs-meta); font-weight:var(--fw-semibold); min-height:17px; margin-top:8px; color:var(--dim); }
.bmf-app .fmsg.bad{ color:var(--warn); } .bmf-app .fmsg.ok{ color:var(--ok); }
.bmf-app .legal{ text-align:center; font-size:var(--fs-meta); color:var(--faint); line-height:1.6; }
.bmf-app .legal a{ color:var(--dim); text-decoration:underline; cursor:pointer; } .bmf-app .legal a:hover{ color:var(--ember-hi); }

/* ===== new-pilot screen — single centred registration card (no rail; it's the gate) ===== */
.bmf-app.newpilot .pad{ display:flex; flex-direction:column;
  padding:calc(env(safe-area-inset-top) + 18px) 18px calc(env(safe-area-inset-bottom) + 18px); }
/* auto margins centre vertically when there's room but stay scroll-safe (no clipped top) on short phones */
.bmf-app.newpilot .reg{ width:100%; max-width:430px; margin:auto; }
.bmf-app.newpilot .crest{ display:flex; align-items:center; gap:11px; margin-bottom:18px; }
.bmf-app.newpilot .crest .wm{ font-family:var(--mono); font-size:var(--fs-tag); letter-spacing:.34em; text-transform:uppercase; color:var(--faint); font-weight:var(--fw-bold); }
.bmf-app.newpilot .crest .wm b{ color:var(--ember-hi); font-weight:var(--fw-heavy); }
.bmf-app.newpilot h1{ font-size:var(--fs-banner); font-weight:var(--fw-black); line-height:1.02; letter-spacing:-0.01em; color:#fff; margin:0; }
.bmf-app.newpilot .accent{ height:3px; width:46px; border-radius:var(--r-pill); margin:12px 0 12px;
  background:linear-gradient(90deg, var(--fire), var(--menu)); box-shadow:0 0 12px var(--ember-50); }
.bmf-app.newpilot .lede{ font-size:var(--fs-body); color:var(--dim); line-height:1.5; margin:0 0 24px; max-width:34ch; }
@media (min-width:740px){ .bmf-app.newpilot .reg{ max-width:460px; } }

/* ===== short viewports (iPhone SE 375×667, small Androids, landscape-ish) — keep the CTA above
   the fold WITHOUT page scroll: compress the vertical rhythm and shed non-essential prose so the
   warm "Enter the fight" CTA always fits. Single-viewport hard rule (CLAUDE.md). ===== */
@media (max-height:720px){
  .bmf-app.newpilot .pad{ padding-top:calc(env(safe-area-inset-top) + 12px); padding-bottom:calc(env(safe-area-inset-bottom) + 12px); }
  .bmf-app.newpilot .crest{ margin-bottom:12px; }
  .bmf-app.newpilot h1{ font-size:clamp(24px, 5.6vh, var(--fs-banner)); }
  .bmf-app.newpilot .accent{ margin:9px 0 9px; }
  .bmf-app.newpilot .lede{ margin-bottom:14px; }
  .bmf-app.newpilot .fieldlabel{ margin-bottom:6px; }
  .bmf-app.newpilot .field input{ padding:11px 0; }
  .bmf-app.newpilot .field.sm input{ padding:10px 0; }
  /* email block + CTA + load sit closer; the legal line tucks under the fold pressure */
  .bmf-app.newpilot [style*="margin-top:18px"]{ margin-top:12px !important; }
  .bmf-app.newpilot #np-cta{ margin-top:16px !important; }
  .bmf-app.newpilot #np-load{ margin-top:8px !important; }
  .bmf-app.newpilot .legal{ margin-top:14px !important; line-height:1.4; }
}
/* ===== very short (≤600px tall — small Androids, short landscape) — drop the optional prose so the
   form (callsign + email + CTA) is the whole card and the CTA is guaranteed in view. ===== */
@media (max-height:600px){
  .bmf-app.newpilot .lede{ display:none; }
  .bmf-app.newpilot .fhint{ display:none; }
  .bmf-app.newpilot .accent{ margin:7px 0 11px; }
  .bmf-app.newpilot h1{ font-size:clamp(22px, 6vh, 28px); }
  .bmf-app.newpilot #np-cta{ margin-top:14px !important; }
}

/* ===== HOME on most phones (≤820px tall — SE through the mid sizes, where a dynamic browser toolbar
   eats height) — compress the FIXED parts (dossier + daily slip) and shed the campaign progress bar so
   the Continue hero's copy + Fly button always fit, no scroll AND no clipped button. Tall phones
   (≥844, plus PWA/standalone) skip this and keep the fuller card. ===== */
@media (max-height:820px){
  .bmf-app.home .pad{ gap:8px; padding-top:calc(env(safe-area-inset-top) + 9px); padding-bottom:calc(var(--rail-h) + env(safe-area-inset-bottom) + 9px); }
  .bmf-app.home header.card{ padding-top:12px; padding-bottom:12px; }
  .bmf-app.home .helmet{ width:48px; height:48px; }
  .bmf-app.home .sec{ margin:0 2px 6px; }
  .bmf-app.home .dbrief{ -webkit-line-clamp:1; margin-top:8px; }
  .bmf-app.home .z-cont .artcard{ min-height:168px; }
  .bmf-app.home .z-cont .clamp2{ -webkit-line-clamp:1; }
  /* The campaign progress bar is the lowest-priority line — shed it so the Fly button never clips. */
  .bmf-app.home .contprog{ display:none; }
}
@media (max-height:600px){
  .bmf-app.home .dbrief{ display:none; }
  .bmf-app.home .helmet{ width:42px; height:42px; }
}

@media (prefers-reduced-motion: reduce){
  .bmf-app .rise{ opacity:1 !important; transform:none !important; animation:none !important; }
  .bmf-app .helmet .sheen,.bmf-app .mote,.bmf-app .glyph.flicker svg path,.bmf-app .crt-streak,.bmf-app .artcard.heli .heli-art .ring,.bmf-app.home .bar > i{ animation:none !important; }
  .bmf-app .cslide{ opacity:1 !important; transform:none !important; }
  .bmf-app.home .artcard[data-act]:hover .img{ transform:none !important; } /* no cinematic zoom under reduced-motion */
  .bmf-app .embers{ display:none; }
}

/* ===== tablet / wide: roomier single column ===== */
@media (min-width:740px){
  .bmf-app.home .pad{ max-width:620px; }
  .bmf-app.home .artcard .inner{ min-height:300px; }
  /* Menu overlays (Campaign · Hangar · Co-op · Settings) get the same roomier centred column. */
  .bmf-app:not(.home):not(.newpilot) .pad{ max-width:600px; }
  /* The hero carousel grows into a bigger card with more peek + larger chevrons. */
  .bmf-app .cslide{ flex:0 0 min(72%,440px); }
  .bmf-app .cslide .artcard .inner{ min-height:360px; }
  .bmf-app .cslide .artcard.heli .inner{ min-height:396px; }
  .bmf-app .cnav{ width:46px; height:46px; } .bmf-app .cnav svg{ width:22px; height:22px; }
}
/* ===== desktop: 2-column home dashboard · flanked-hero carousels · floating dock rail ===== */
@media (min-width:1040px){
  /* Single-viewport dashboard: profile spans the top (auto row), daily + continue fill the rest
     (1fr row). overflow:hidden + a padding-bottom that clears the floating dock rail = the Continue
     card's Fly button never sits under the rail. */
  .bmf-app.home .pad{ max-width:1000px; display:grid; grid-template-columns:380px 1fr; grid-template-rows:auto minmax(0,1fr);
    column-gap:24px; row-gap:8px; overflow:hidden; padding-top:calc(env(safe-area-inset-top) + 28px); padding-bottom:120px; }
  .bmf-app.home .pad > header{ grid-column:1 / -1; grid-row:1; }
  .bmf-app.home .z-daily{ grid-column:1; grid-row:2; align-self:start; }
  .bmf-app.home .z-cont{ grid-column:2; grid-row:2; min-height:0; }
  .bmf-app.home .sec{ margin-top:0; }
  /* Menu overlays: a wide centred column; the carousel becomes a chevron-flanked hero. */
  .bmf-app:not(.home):not(.newpilot) .pad{ max-width:760px;
    padding-top:calc(env(safe-area-inset-top) + 30px); padding-bottom:120px; }
  .bmf-app .carousel{ margin:8px -22px 0; } .bmf-app .ctrack{ padding-left:22px; padding-right:22px; }
  .bmf-app .cslide{ flex:0 0 min(58%,480px); }
  .bmf-app .cslide .artcard .inner{ min-height:418px; }
  .bmf-app .cslide .artcard.heli .inner{ min-height:452px; }
  .bmf-app .cnav{ width:52px; height:52px; } .bmf-app .cnav svg{ width:24px; height:24px; }
  .bmf-app .cnav.prev{ left:-8px; } .bmf-app .cnav.next{ right:-8px; }
  .bmf-app .artcard.heli .heli-art .mark svg{ width:140px; height:140px; }
  .bmf-app .artcard.heli .heli-art .ring{ width:188px; height:188px; top:24px; }
  /* Floating dock rail — shared by the hub AND every menu overlay so it reads the same everywhere. */
  .bmf-app .rail{ left:50%; right:auto; transform:translateX(-50%); bottom:18px; width:auto; min-width:540px; height:auto; padding-bottom:0;
    border:1px solid var(--bevel-top); border-radius:var(--r-xl); box-shadow:0 14px 44px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06); }
  .bmf-app .rail .keys{ max-width:none; height:66px; }
}
/* ===== large desktop: cap the column so the hero carousel never sprawls ===== */
@media (min-width:1320px){
  .bmf-app:not(.home):not(.newpilot) .pad{ max-width:820px; }
  .bmf-app .cslide{ flex:0 0 520px; }
}
`;

let injected = false;
/** Inject the Home/menus stylesheet once. */
export function injectHomeStyles(): void {
  injectKitStyles(); // the canonical .btn + global :root tokens live in the kit; pull them in for class="btn" markup
  if (injected || document.getElementById('bmf-home-css')) {
    injected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'bmf-home-css';
  style.textContent = VARS + CSS;
  document.head.appendChild(style);
  injected = true;
}

/** Spawn N drifting ember motes into a `.embers` host (skips under reduced-motion). */
export function spawnEmbers(host: HTMLElement, n = 12): void {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < n; i++) {
    const e = document.createElement('span');
    e.className = 'mote';
    e.style.left = ((i * 83) % 97) + '%';
    const dur = 6 + (i % 5);
    e.style.animationDuration = dur + 's';
    e.style.animationDelay = -(i * 0.7) + 's';
    e.style.transform = `scale(${(0.6 + (i % 4) * 0.3).toFixed(2)})`;
    e.style.setProperty('--drift', (i % 2 ? 1 : -1) * (8 + (i % 3) * 9) + 'px');
    host.appendChild(e);
  }
}
