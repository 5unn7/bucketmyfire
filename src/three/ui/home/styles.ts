/**
 * One injected stylesheet for the Home hub + its rail menus (HomeScreen, menus.ts). Everything is
 * scoped under `.bmf-app`, and the CSS custom properties are generated FROM `theme.ts` (the single
 * token source — DESIGN.md) so the menu uses the same palette/scale as the rest of the UI. The
 * instrument "metal" gradients are local extras (derived, not brand tokens).
 *
 * LAYOUT: `.bmf-app` is a fixed full-viewport flex column anchored above the fixed rail. The HOME hub
 * pad scrolls vertically (its sections take their natural height); the other rail overlays stay
 * single-viewport. (Phone/tablet only — the ≥1040px desktop dashboard is still a fixed 2-col grid.)
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
  /* Brand corner-cut geometry — ONE source for the chamfered "panel notch" so every card cuts the same.
     --cut-tl = the top-left panel notch (.card); --cut-br = the bottom-right card notch (list + grid cards).
     The hero poster (.artcard) keeps a deeper notch of its own. This is screen geometry, not a brand token,
     so it lives here with the other --metal/--bevel cosmetics rather than in theme.ts. */
  --cut-tl:polygon(16px 0, 100% 0, 100% 100%, 0 100%, 0 16px);
  --cut-br:polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%);
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

/* ===== HOME hub: SCROLLABLE column. Each section (dossier · daily · continue) takes its natural
   height and the pad scrolls vertically when the stack overflows the viewport, above the fixed rail.
   (Was a locked single-viewport flex column whose Continue card absorbed all spare height.) */
.bmf-app.home .pad{ display:flex; flex-direction:column; gap:11px; overflow-y:auto;
  padding-top:calc(env(safe-area-inset-top) + 12px); padding-bottom:calc(var(--rail-h) + env(safe-area-inset-bottom) + 12px); }
.bmf-app.home .pad > header{ flex:0 0 auto; }
.bmf-app.home .zone{ display:flex; flex-direction:column; }
.bmf-app.home .z-shop{ flex:0 0 auto; }
.bmf-app.home .z-cont{ flex:0 0 auto; }
.bmf-app.home .z-fires{ flex:0 0 auto; }
/* The live-fire tracker rides high (under the dossier) and must stay visible even on cramped windows:
   it reuses the shop banner's GLASS styling but NOT its short-window hide. The .z-fires .firebanner
   selector is 4 classes vs the @media hide's 3, so it always wins; keep the count line too. */
.bmf-app.home .z-fires .firebanner{ display:flex; }
.bmf-app.home .z-fires .firebanner .sb-sub{ display:block; }

/* ===== LIVE FIRE MAP overlay — a full-bleed Leaflet map + slide-up CWFIS detail sheet. Colours via
   tokens only (FireMap dots are themed from theme.ts). The map owns pan/zoom; the page never scrolls. */
.bmf-app .pad:has(> .firewrap){ padding:0 0 calc(var(--rail-h) + env(safe-area-inset-bottom)) 0; margin:0; max-width:none; display:flex; flex-direction:column; overflow:hidden; }
.bmf-app .pad:has(> .firewrap) .appbar{ display:none; }
.bmf-app .firewrap{ position:relative; flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
.bmf-app .firebar{ flex:0 0 auto; z-index:2; display:flex; align-items:center; gap:10px; padding:calc(env(safe-area-inset-top) + 10px) 14px 10px; background:var(--card-bg); border-bottom:1px solid var(--stroke); }
.bmf-app .firebar .t{ font-size:var(--fs-md); font-weight:var(--fw-bold); color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bmf-app .firebar .s{ font-size:var(--fs-tag); color:var(--dim); }
.bmf-app .firesel{ flex:0 0 auto; max-width:42%; min-height:38px; background:var(--field); color:var(--text); border:1px solid var(--stroke); border-radius:var(--r-md); padding:7px 9px; font-family:var(--font); font-size:var(--fs-meta); cursor:pointer; }
.bmf-app .firesel:focus{ outline:none; border-color:var(--ember); }
.bmf-app .firemap{ flex:1 1 auto; min-height:0; width:100%; }

/* National summary stat strip (CIFFC) — THREE headline numbers ("how bad, right now") + a demoted season
   subline. Stable height across states: US/MX & a down feed render a same-height note, never a silent
   collapse that jumps the header. */
.bmf-app .firestats{ flex:0 0 auto; z-index:2; display:flex; flex-direction:column; gap:2px; padding:8px 10px; background:var(--card-bg); border-bottom:1px solid var(--stroke); }
.bmf-app .firestats[hidden]{ display:none; }
.bmf-app .fstat-row{ display:flex; align-items:stretch; }
.bmf-app .fstat-row[hidden]{ display:none; }
.bmf-app .fstat{ flex:1 1 0; min-width:0; display:flex; flex-direction:column; align-items:center; gap:1px; padding:0 8px; border-right:1px solid var(--hair); text-align:center; }
.bmf-app .fstat:last-child{ border-right:0; }
.bmf-app .fstat b{ font-family:var(--mono); font-size:var(--fs-lg); font-weight:var(--fw-bold); color:var(--text); line-height:1.05; white-space:nowrap; }
.bmf-app .fstat span{ font-size:var(--fs-micro); letter-spacing:.02em; color:var(--dim); line-height:1.15; }
.bmf-app .fstat-season{ font-family:var(--mono); font-size:var(--fs-micro); color:var(--text-subtle); text-align:center; letter-spacing:.02em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bmf-app .fstat-season[hidden]{ display:none; }
.bmf-app .fstat-note{ font-size:var(--fs-meta); color:var(--dim); text-align:center; padding:5px 0 4px; }
.bmf-app .fstat-note[hidden]{ display:none; }

/* Map controls — a short row: the summoned Layers + Sources sheets only. The eight layer toggles and the
   full per-mark legend live INSIDE the Layers sheet, so this row stays short and the map keeps its height
   (no more eight-chip horizontal scroller). Buttons are rounded-rect on the field register — never pills. */
.bmf-app .firetools{ flex:0 0 auto; z-index:2; display:flex; align-items:center; gap:8px; padding:7px 12px; background:var(--card-bg); border-bottom:1px solid var(--stroke); }
.bmf-app .ftbtn{ flex:0 0 auto; display:inline-flex; align-items:center; gap:7px; min-height:38px; padding:7px 13px; border-radius:var(--r-md); border:1px solid var(--stroke); background:var(--field); color:var(--text); font-family:var(--font); font-size:var(--fs-meta); cursor:pointer; white-space:nowrap; transition:background .15s ease, border-color .15s ease; }
.bmf-app .ftbtn:hover{ border-color:var(--ember); }
.bmf-app .ftbtn svg{ width:16px; height:16px; flex:0 0 auto; }
.bmf-app .ftbtn .ftn{ font-family:var(--mono); font-size:var(--fs-micro); font-weight:var(--fw-bold); color:var(--ember-hi); }

/* Layers sheet — tiered toggles (reuse .srow/.toggle) + the full legend. A layer row's icon slot carries a
   legend swatch; a country-gated tier shows a reason badge instead of a toggle. */
.bmf-app .lgcap{ display:flex; align-items:baseline; gap:8px; }
.bmf-app .lgcap .sc{ font-size:var(--fs-micro); color:var(--dim); letter-spacing:.04em; text-transform:none; }
.bmf-app .firesheet .srow.off{ opacity:.5; }
.bmf-app .lgsw{ width:13px; height:13px; flex:0 0 auto; border-radius:var(--r-round); background:var(--faint); }
.bmf-app .lgsw.oc{ background:var(--warn); } .bmf-app .lgsw.bh{ background:var(--caution); } .bmf-app .lgsw.uc{ background:var(--ok); }
.bmf-app .lgsw.neutral{ background:var(--faint); }
.bmf-app .lgsw.alert{ background:var(--warn); border:2px solid var(--text); width:15px; height:15px; }
.bmf-app .lgsw.ramp{ width:32px; border-radius:var(--r-sm); background:linear-gradient(90deg, var(--ember-hi), var(--ember), var(--warn)); }
.bmf-app .lgsw.fwiramp{ width:32px; border-radius:var(--r-sm); background:linear-gradient(90deg, var(--ok), var(--caution), var(--warn)); }
.bmf-app .lgsw.scar{ border-radius:var(--r-sm); background:var(--ember-12); border:1px solid var(--ember-50); }
.bmf-app .lgsw.ban{ border-radius:var(--r-sm); background:transparent; border:1.5px dashed var(--warn); }
.bmf-app .lgsw.smoke{ width:32px; border-radius:var(--r-sm); background:linear-gradient(90deg, var(--ember-10), var(--ember-40)); }
.bmf-app .lgrow{ display:flex; align-items:center; gap:11px; padding:6px 2px; border-bottom:1px solid var(--hair); }
.bmf-app .lgrow:last-child{ border-bottom:0; }
.bmf-app .lgrow .lgtx{ display:flex; flex-direction:column; gap:1px; min-width:0; }
.bmf-app .lgrow .lgname{ font-size:var(--fs-meta); color:var(--text); }
.bmf-app .lgrow .lgdef{ font-size:var(--fs-micro); color:var(--dim); }

/* Leaflet, themed dark to match the cockpit (tokens only). */
.bmf-app .leaflet-container{ background:var(--card-bg); font-family:var(--font); }
.bmf-app .leaflet-bar{ border:1px solid var(--stroke); box-shadow:var(--shadow-card); }
.bmf-app .leaflet-bar a, .bmf-app .leaflet-bar a:hover{ background:var(--field); color:var(--text); border-bottom-color:var(--hair); }
.bmf-app .leaflet-bar a:hover{ background:var(--recess); }
.bmf-app .leaflet-control-attribution{ background:var(--card-soft); color:var(--dim); }
.bmf-app .leaflet-control-attribution a{ color:var(--menu); }

/* Slide-up detail sheet — the full CWFIS record (bounded inner scroll is allowed for a long field list). */
.bmf-app .firesheet{ position:absolute; left:0; right:0; bottom:0; z-index:402; max-height:64%; overflow-y:auto; -webkit-overflow-scrolling:touch;
  background:var(--card-bg); border-top:1px solid var(--warm-stroke); border-radius:var(--r-xl) var(--r-xl) 0 0; box-shadow:var(--shadow-card); padding:10px 16px 16px; }
.bmf-app .firesheet[hidden]{ display:none; }
/* Branded scrollbar — warm ember thumb (the "fight" register), floating on a clear track, pill-capped. */
.bmf-app .firesheet{ scrollbar-width:thin; scrollbar-color:var(--ember-50) transparent; }
.bmf-app .firesheet::-webkit-scrollbar{ width:8px; }
.bmf-app .firesheet::-webkit-scrollbar-track{ background:transparent; }
.bmf-app .firesheet::-webkit-scrollbar-thumb{ background:var(--ember-50); border-radius:var(--r-pill); border:2px solid transparent; background-clip:padding-box; }
.bmf-app .firesheet::-webkit-scrollbar-thumb:hover{ background:var(--ember); background-clip:padding-box; }
.bmf-app .fsheet-head{ position:sticky; top:0; display:flex; align-items:flex-start; gap:10px; padding:4px 0 9px; background:var(--card-bg); }
.bmf-app .fsheet-ttl{ font-family:var(--mono); font-size:var(--fs-md); font-weight:var(--fw-bold); color:var(--text); }
.bmf-app .fgroup{ margin-top:12px; }
.bmf-app .fgh{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.12em; text-transform:uppercase; color:var(--ember-hi); margin-bottom:4px; }
.bmf-app .frow{ display:flex; justify-content:space-between; gap:14px; padding:5px 0; border-bottom:1px solid var(--hair); }
.bmf-app .frow .fk{ font-size:var(--fs-meta); color:var(--text-subtle); }
.bmf-app .frow .fv{ font-family:var(--mono); font-size:var(--fs-meta); color:var(--text); text-align:right; white-space:nowrap; }
/* Layer-chip status dot — live / cached / down / off / none-in-view. "empty ≠ down ≠ off": a doused-quiet
   layer reads 'none' (calm grey), a broken feed reads 'down' (red), an off toggle is already de-emphasised. */
.bmf-app .ldotc{ display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:7px; flex:0 0 auto; background:var(--dim); vertical-align:middle; }
.bmf-app .ldotc.live{ background:var(--ok); } .bmf-app .ldotc.cache{ background:var(--caution); }
.bmf-app .ldotc.down{ background:var(--warn); } .bmf-app .ldotc.none{ background:var(--dim); } .bmf-app .ldotc.off{ background:var(--faint); }
/* Source ledger — the trust hero: every source, its status dot, its SOURCE publish time, link to origin. */
.bmf-app .ledger{ display:flex; flex-direction:column; gap:0; padding-top:2px; }
.bmf-app .lrow{ display:flex; align-items:center; gap:11px; padding:10px 2px; border-bottom:1px solid var(--hair); text-decoration:none; color:inherit; }
.bmf-app .lrow:last-child{ border-bottom:0; }
.bmf-app .lrow .sdot{ width:9px; height:9px; border-radius:50%; flex:0 0 auto; background:var(--dim); }
.bmf-app .lrow .sdot.live{ background:var(--ok); } .bmf-app .lrow .sdot.cache{ background:var(--caution); }
.bmf-app .lrow .sdot.down{ background:var(--warn); } .bmf-app .lrow .sdot.none{ background:var(--dim); }
.bmf-app .lrow .sdot.off{ background:var(--faint); } .bmf-app .lrow .sdot.link{ background:var(--ember); }
.bmf-app .lrow .lname{ display:block; font-size:var(--fs-sm); font-weight:var(--fw-bold); color:var(--text); }
.bmf-app .lrow .lwhat{ display:block; font-size:var(--fs-micro); color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bmf-app .lrow .lfresh{ font-family:var(--mono); font-size:var(--fs-micro); color:var(--text-subtle); white-space:nowrap; flex:0 0 auto; text-align:right; }
.bmf-app .lrow.link .lfresh{ color:var(--ember-hi); }
.bmf-app .ledger .lnote{ font-size:var(--fs-micro); color:var(--faint); margin-top:11px; line-height:1.45; }
/* Smoke FORECAST scrubber — a slim timeline pinned over the map's bottom edge (shown only when Smoke is on).
   The range sits over a "Now … +48 h" rail; the label pairs the absolute frame time with an ember lead chip. */
.bmf-app .firescrub{ position:absolute; left:0; right:0; bottom:0; z-index:401; display:flex; align-items:center; gap:11px; padding:6px 12px calc(7px + env(safe-area-inset-bottom)); background:var(--card-bg); border-top:1px solid var(--stroke); }
.bmf-app .firescrub[hidden]{ display:none; }
.bmf-app .firescrub .iconbtn{ width:38px; height:38px; flex:0 0 auto; }
.bmf-app .scrubtrack{ flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:1px; }
.bmf-app .scrubrange{ width:100%; height:22px; margin:0; accent-color:var(--ember); cursor:pointer; }
.bmf-app .scrubrail{ display:flex; justify-content:space-between; font-size:var(--fs-micro); color:var(--faint); letter-spacing:.04em; padding:0 1px; }
/* Buffering pulse while the next frame's tiles load (no spinner — just a soft breath on the track). */
.bmf-app .scrubtrack.buffering .scrubrange{ animation:bmf-scrubpulse 1s ease-in-out infinite; }
@keyframes bmf-scrubpulse{ 0%,100%{ opacity:1; } 50%{ opacity:.5; } }
.bmf-app .scrublabel{ flex:0 0 auto; display:flex; flex-direction:column; align-items:flex-end; line-height:1.12; }
.bmf-app .scrubwhen{ display:flex; align-items:baseline; gap:6px; }
.bmf-app .scrubwhen b{ font-family:var(--mono); font-size:var(--fs-meta); font-weight:600; color:var(--text); white-space:nowrap; }
.bmf-app .scrubwhen i{ font-family:var(--mono); font-style:normal; font-size:var(--fs-micro); color:var(--ember-hi); white-space:nowrap; }
.bmf-app .scrubtag{ font-size:var(--fs-micro); letter-spacing:.1em; text-transform:uppercase; color:var(--faint); }
/* Alert / fire-ban detail-sheet body (the issuer's words + the official-source button + the standing caveat). */
.bmf-app .alertsum{ font-size:var(--fs-meta); color:var(--text-subtle); line-height:1.5; margin:12px 0; }
.bmf-app .firesheet .btn.block{ margin-top:6px; }
.bmf-app .alertnote{ font-size:var(--fs-micro); color:var(--faint); line-height:1.4; margin-top:12px; }
.bmf-app .credits a{ color:var(--menu); }
.bmf-app.home .sec{ margin:0 2px 8px; }
.bmf-app.home .z-cont .artcard{ min-height:200px; }

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
  border-radius:var(--r-md); box-shadow:var(--shadow-card), inset 0 1px 0 rgba(255,255,255,0.05); padding:14px 15px;
  clip-path:var(--cut-tl); }
.bmf-app .card.metal{ background:var(--metal); }
.bmf-app .card.warm{ background:radial-gradient(120% 140% at 82% 0%, rgba(255,120,40,0.12), transparent 55%), var(--metal-hi); }
/* The notch is the DEFAULT on every .card (above) — so a bare class="card" (e.g. the Settings panels)
   cuts the same as the hub's warm "card cut". .cut stays as an explicit alias so existing markup still
   reads intentionally; it's a no-op now but harmless. (Brand law: every card carries the corner-cut.) */
.bmf-app .card.cut{ clip-path:var(--cut-tl); }
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
/* Region cards: the map art is a 3D terrain SLAB rendered on transparency — built to FLOAT, not to
   fill. So show the WHOLE slab (contain), parked in the upper card over a faint spotlight, casting a
   true silhouette shadow, with a slow idle bob on the focused slide — and let it sink into the scrim
   under the title/stats/CTA. (cover-cropping it threw the floating-object read away entirely.) */
.bmf-app .artcard.map{ background:radial-gradient(116% 76% at 50% 30%, #251b27, var(--card-bg) 70%); }
.bmf-app .artcard.map .img{ inset:0 0 auto 0; height:72%; padding:18px 16px 0; box-sizing:border-box;
  object-fit:contain; object-position:50% 44%; filter:drop-shadow(0 18px 20px rgba(0,0,0,0.5)); }
.bmf-app .artcard.map .scrim{ background:linear-gradient(180deg, transparent 0%, transparent 50%, rgba(6,4,3,0.72) 80%, rgba(4,3,2,0.95) 100%); }
/* Header pills are a real auto-layout row: the tagline chip flexes + ellipsizes, the status badge
   holds its width, and a gap keeps them apart — was a nowrap chip butting into a clipped badge. */
.bmf-app .artcard.map .inner > .row.between{ gap:10px; }
.bmf-app .artcard.map .chip.ghost{ flex:0 1 auto; min-width:0; display:block; overflow:hidden; text-overflow:ellipsis; }
.bmf-app .artcard.map .inner > .row.between > .badge{ flex:0 0 auto; }
.bmf-app .cslide.active .artcard.map .img{ animation:bmf-map-float 7s ease-in-out infinite; }
@keyframes bmf-map-float{ 0%,100%{ transform:translateY(0); } 50%{ transform:translateY(-7px); } }
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
/* Loading skeleton: a neutral shimmer chip while the global standing fetches; settles to "#N Global" or is
   removed (loadGlobalRank), so the dossier never paints a "#–" stub. */
.bmf-app .grank.loading{ background:var(--recess); border-color:var(--hair); }
.bmf-app .grank.loading .sk{ display:block; width:42px; height:10px; border-radius:var(--r-pill);
  background:linear-gradient(90deg, var(--recess), var(--hair) 50%, var(--recess)); background-size:200% 100%;
  animation:bmf-shimmer 1.25s ease-in-out infinite; }
@keyframes bmf-shimmer{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }

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
/* Daily slip layout: brand-mark glyph at LEFT, the dispatch content (date · brief · resets/Fly) at right —
   mirrors the dossier's helmet-left row so the two warm cards read as a family, with the daily clearly the
   lighter secondary beneath the Continue poster hero. */
.bmf-app .daily .drow{ display:flex; align-items:flex-start; gap:12px; }
.bmf-app .dbrief{ margin-top:13px; font-size:var(--fs-body); line-height:1.45; color:rgba(255,255,255,0.86);
  padding-left:11px; border-left:3px solid var(--fire);
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

/* ===== BMF Gear banner — a promo card in the home's left column, sitting UNDER Today's Burn and
   opening the standalone merch store (shop.bucketmyfire.com, same tab). On the desktop dashboard it's pinned to the BOTTOM of the Today's
   Burn cell so its base lines up with the Continue mission card (the "aligned" goal — see the desktop
   grid block below). On phone/tablet it flows directly under the daily slip; it's gated OUT only on the
   shortest viewports so the single-viewport no-scroll law still holds (CLAUDE.md). The whole card is ONE
   tap target. GRADIENT GLASS: an almost-transparent red-tinted pane (faint fire/ember diagonal wash over
   a backdrop blur) with a specular highlight that SWIPES across on a loop — built from tokens only. ===== */
.bmf-app.home .shop-sec{ display:none; } /* section label only rides the desktop dashboard; phone/tablet show the banner alone */
.bmf-app .shopbanner{ position:relative; overflow:hidden; display:flex; width:100%; margin-top:11px; align-items:center; gap:13px; text-align:left; font:inherit; color:var(--text);
  cursor:pointer; -webkit-tap-highlight-color:transparent; transition:transform .14s ease, border-color .14s ease, box-shadow .22s ease; }
/* Almost-transparent gradient glass — a low-alpha fire/ember tint is the ONLY fill (no metal base), so
   the blurred hub shows through. Overrides the .card metal fill (3-class specificity, sourced after
   .card.warm so it wins). */
.bmf-app .shopbanner.card{ border-color:var(--stroke); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur);
  background:linear-gradient(135deg, var(--fire-16) 0%, var(--ember-10) 50%, transparent 92%);
  box-shadow:var(--shadow-card), inset 0 1px 0 var(--bevel-top); }
/* Swipe reflection — a thin specular streak that sweeps left→right and rests off-frame; mix-blend screen
   so it only LIGHTENS the glass. Clipped by the .card.cut polygon + overflow:hidden, so it never spills. */
.bmf-app .shopbanner::after{ content:""; position:absolute; inset:0; z-index:2; pointer-events:none; mix-blend-mode:screen;
  background:linear-gradient(112deg, transparent 42%, var(--text-subtle) 50%, transparent 58%);
  transform:translateX(-130%); animation:bmf-swipe 5.5s ease-in-out 1.2s infinite; }
@keyframes bmf-swipe{ 0%{transform:translateX(-130%);} 22%{transform:translateX(130%);} 100%{transform:translateX(130%);} }
.bmf-app .shopbanner:hover{ transform:translateY(-2px); border-color:var(--warm-stroke); box-shadow:var(--shadow-card), inset 0 1px 0 var(--bevel-top), 0 0 30px var(--ember-30); }
.bmf-app .shopbanner:active{ transform:translateY(-1px); }
.bmf-app .sb-ic{ width:40px; height:40px; flex:0 0 auto; display:grid; place-items:center; border-radius:var(--r-sm);
  border:1px solid var(--warm-stroke); background:radial-gradient(circle at 40% 30%, var(--warm-38), var(--card-bg));
  box-shadow:inset 0 0 10px var(--ember-35); color:var(--ember-hi); }
.bmf-app .sb-ic svg{ width:19px; height:19px; }
.bmf-app .sb-copy{ flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.bmf-app .sb-title{ font-size:var(--fs-md); font-weight:var(--fw-black); line-height:1.08; color:var(--text); }
.bmf-app .sb-sub{ font-size:var(--fs-meta); line-height:1.36; color:var(--text-subtle); }
.bmf-app .sb-go{ flex:0 0 auto; display:grid; place-items:center; width:26px; height:26px; color:var(--ember-hi); transition:color .14s ease, transform .14s ease; }
.bmf-app .sb-go svg{ width:18px; height:18px; }
.bmf-app .shopbanner:hover .sb-go{ color:var(--text); transform:translateX(2px); }
/* Shortest viewports — drop the banner (and on short phones its sub line) so the single-column stack
   never scrolls. Scoped to the PHONE/TABLET layout (max-width:1039px) only: the desktop 2-column
   dashboard (≥1040px) has a dedicated left-column slot for the banner, so it must stay visible there
   even on short laptop windows (1366×768 etc.) — never hidden by a height gate. */
@media (max-width:1039px) and (max-height:760px){ .bmf-app.home .sb-sub{ display:none; } }
@media (max-width:1039px) and (max-height:670px){ .bmf-app.home .shopbanner{ display:none; } }

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
/* When a heli has key-art (profile.imageUrl), frame the AIRFRAME — sits upper-mid, so pull focus
   above the map default (50% 34%) so the fuselage reads under the badge row and the title scrim. */
.bmf-app .artcard.heli .img{ object-position:50% 42%; }

.bmf-app .specgrid{ display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; margin:11px 0 2px; }
.bmf-app .specgrid .spec{ grid-template-columns:50px 1fr; gap:8px; margin:0; }
.bmf-app .specgrid .spec .name{ color:rgba(255,255,255,0.62); }

/* Hangar points economy: the spendable-balance chip (right of the appbar title) + a foot that stacks
   the "Clear N missions" gate over the "Unlock · N pts" buy button. All colour from tokens. */
.bmf-app .pts-bal{ margin-left:auto; display:inline-flex; align-items:center; gap:6px; flex:0 0 auto;
  padding:5px 11px; border-radius:var(--r-sm); background:var(--card-glass); border:1px solid var(--hair);
  font-size:var(--fs-meta); font-weight:var(--fw-semibold); letter-spacing:.04em; color:var(--dim); white-space:nowrap; }
.bmf-app .pts-bal svg{ width:14px; height:14px; color:var(--ember-hi); flex:none; }
.bmf-app .pts-bal b{ color:var(--menu); font-weight:var(--fw-bold); }
.bmf-app .heli-foot{ display:flex; flex-direction:column; gap:8px; }

/* ===== Open Skies — aircraft picker as a 3-up grid of selectable card-buttons (warm "fight" register).
   Each card is a real <button>: a tinted procedural hangar tile + name + tagline, with a selected
   (ember) and a locked (dimmed + lock corner) state. All colour comes from the accent var + tokens. */
.bmf-app .heligrid{ display:grid; grid-template-columns:repeat(3,1fr); gap:9px; margin-top:11px; }
.bmf-app .helicard{ position:relative; display:flex; flex-direction:column; align-items:stretch; gap:8px; min-height:0;
  padding:9px 9px 11px; border-radius:var(--r-lg); clip-path:var(--cut-br); border:1px solid var(--stroke); background:var(--card-bg); color:var(--text);
  font:inherit; cursor:pointer; text-align:center; overflow:hidden; -webkit-tap-highlight-color:transparent;
  transition:border-color .16s ease, box-shadow .22s ease, transform .12s ease; }
.bmf-app .helicard:hover{ border-color:var(--warm-stroke); transform:translateY(-2px); }
.bmf-app .helicard.sel{ border-color:var(--menu-soft);
  background:radial-gradient(120% 92% at 50% 0%, var(--ember-12), transparent 62%), var(--card-bg);
  box-shadow:inset 0 0 0 1px var(--menu-soft), 0 0 22px var(--ember-22); }
.bmf-app .helicard.locked{ cursor:default; filter:grayscale(.55) brightness(.66); }
.bmf-app .helicard.locked:hover{ border-color:var(--stroke); transform:none; }
/* The art tile is the hero: it FILLS the card's available height (the grid flexes to the viewport, below),
   so the portrait key-art render reads at full size instead of a thin letterbox crop. */
.bmf-app .helicard .hc-art{ position:relative; width:100%; flex:1 1 auto; min-height:72px; border-radius:var(--r-md); overflow:hidden; display:grid; place-items:center;
  background:radial-gradient(92% 84% at 50% 28%, color-mix(in srgb, var(--accent) 50%, transparent), transparent 70%), var(--metal); }
/* Key-art render fills the tile; the subject (heli + slung bucket) sits mid-frame, so centre the crop
   slightly above middle to keep the airframe prominent when the tile shrinks to a band. */
.bmf-app .helicard .hc-art .img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 44%; }
.bmf-app .helicard .hc-ring{ position:absolute; top:50%; left:50%; width:50%; aspect-ratio:1; max-width:120px; transform:translate(-50%,-50%); border-radius:50%;
  border:1px dashed color-mix(in srgb, var(--accent) 60%, transparent); opacity:.5; animation:bmf-rotor 9s linear infinite; }
.bmf-app .helicard .hc-mark{ position:relative; display:grid; place-items:center; color:var(--text); }
.bmf-app .helicard .hc-mark svg{ width:36%; height:auto; max-width:84px; aspect-ratio:1; }
.bmf-app .helicard .hc-name{ font-size:var(--fs-meta); font-weight:var(--fw-bold); line-height:1.16; color:var(--text);
  min-height:calc(1.16em * 2); display:flex; align-items:center; justify-content:center; }
.bmf-app .helicard .hc-sub{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.08em; text-transform:uppercase; color:var(--dim); }
.bmf-app .helicard.locked .hc-sub{ color:var(--faint); }
.bmf-app .helicard .hc-flag{ position:absolute; top:7px; right:7px; width:19px; height:19px; border-radius:50%; display:grid; place-items:center; color:var(--faint); }
.bmf-app .helicard .hc-flag svg{ width:12px; height:12px; }
.bmf-app .helicard.sel .hc-flag{ background:var(--menu); color:var(--cta-ink); box-shadow:0 0 10px var(--ember-35); }

/* Open Skies — single-viewport, NO PAGE SCROLL (CLAUDE.md hard rule). The body owns the title +
   subtitle hero, so the overlay appbar is hidden for this screen. The pad is a flex column locked to
   the viewport; the PITCH sits at top, the PICK fills the rest with the aircraft grid as its flexible
   hero, so the Join button always stays in view. On desktop (below) the two become a 2-column lobby. */
.bmf-app .pad:has(> .osky) .appbar{ display:none; }
.bmf-app .pad:has(> .osky){ display:flex; flex-direction:column; overflow:hidden; }
.bmf-app .osky{ flex:1 1 auto; min-height:0; display:flex; flex-direction:column; padding-top:8px; }
.bmf-app .osky-pitch{ flex:0 0 auto; }
.bmf-app .osky-pick{ flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
.bmf-app .osky-title{ margin-top:11px; }
.bmf-app .osky-sub{ margin-top:6px; font-size:var(--fs-title); font-weight:var(--fw-bold); color:var(--ember-hi); letter-spacing:.01em; }
.bmf-app .osky-desc{ margin-top:8px; font-size:var(--fs-body); line-height:1.5; color:var(--dim); max-width:42ch;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.bmf-app .osky-feats{ margin-top:11px; display:flex; flex-direction:column; gap:9px; }
.bmf-app .osky-feat{ display:flex; align-items:center; gap:10px; font-size:var(--fs-sm); font-weight:var(--fw-semibold); color:var(--text); }
.bmf-app .osky-feat svg{ width:17px; height:17px; flex:0 0 auto; color:var(--ember-hi); }
.bmf-app .osky-live-chip{ gap:6px; }
.bmf-app .osky-live-dot{ width:6px; height:6px; border-radius:50%; background:var(--ember); box-shadow:0 0 8px var(--ember), var(--ember-glow); flex:0 0 auto; animation:bmf-osky-pulse 1.8s ease-in-out infinite; }
@keyframes bmf-osky-pulse{ 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.65)} }
@media(prefers-reduced-motion:reduce){ .bmf-app .osky-live-dot{animation:none!important} }
.bmf-app .osky-pick .sec{ margin:14px 2px 0; }
/* The aircraft grid is the HERO on phone: it flexes to fill all height between the "Your aircraft"
   header and the Join button, so the cards (and their portrait key-art) grow as large as the viewport
   allows. No-scroll is then guaranteed by construction — short phones shrink the cards, never overflow. */
.bmf-app .osky-pick .heligrid{ margin-top:11px; flex:1 1 auto; min-height:0; grid-template-rows:1fr; }
.bmf-app .osky-cta{ padding-top:14px; }
/* Short phones: shed the supporting copy so the cards + Join keep their room (no scroll). */
@media (max-height:760px){
  .bmf-app .osky-desc{ -webkit-line-clamp:1; }
  .bmf-app .osky-feats{ display:none; }
}
@media (max-height:650px){
  .bmf-app .osky-title{ font-size:var(--fs-display); margin-top:6px; }
  .bmf-app .osky-desc{ display:none; }
  .bmf-app .osky-pick .sec{ margin-top:10px; }
}
@media (max-height:520px){
  .bmf-app .osky-sub{ display:none; }
}

/* ===== mission card LIST (accordion) — copy on the left, art on the right, gradient fade left =====
   One vertical stack; the active mission expands (reveals its CTA), collapsed cards keep ALL their
   copy. The right-anchored poster reads through a left-to-right scrim so the left-hand text stays
   legible over any image. This is the one permitted bounded inner-scroll list (CLAUDE.md). */
.bmf-app .mlist{ display:flex; flex-direction:column; gap:11px; margin-top:12px; }
.bmf-app .mcard{ position:relative; display:block; width:100%; text-align:left; cursor:pointer; overflow:hidden;
  border-radius:var(--r-lg); border:1px solid var(--stroke-strong); background:var(--card-bg); color:inherit; font:inherit;
  box-shadow:var(--shadow-card); transition:border-color .18s, box-shadow .25s, transform .12s;
  clip-path:var(--cut-br); -webkit-tap-highlight-color:transparent; }
.bmf-app .mcard:hover{ border-color:var(--warm-stroke); transform:translateY(-2px); }
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
/* header spans the FULL card (above the 74% body) so the badge auto-layouts flush to the top-right
   corner — the chip flows left, the badge right via space-between, both over the art's top edge. */
.bmf-app .mcard .mhead{ position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:13px 15px 0; }
.bmf-app .mcard .mbody{ position:relative; z-index:2; padding:10px 15px 13px; max-width:74%; }
.bmf-app .mcard .mname{ font-size:var(--fs-lg); font-weight:var(--fw-black); line-height:1.1; color:#fff; }
.bmf-app .mcard .mtag{ font-size:var(--fs-meta); line-height:1.42; color:var(--text-subtle); margin-top:6px; max-width:32ch; }
.bmf-app .mcard .mmeta{ display:flex; align-items:center; gap:12px; margin-top:10px; }
/* run readout — token-only (was inline-styled in menus.ts): subtle body white + the gold best score */
.bmf-app .mcard .mscore{ font-size:var(--fs-meta); color:var(--text-subtle); }
.bmf-app .mcard .mscore b{ color:var(--menu); font-weight:var(--fw-bold); }
.bmf-app .mcard .mscore.tbd{ color:var(--faint); }
/* expand region — grid-rows trick animates the reveal without measuring height */
.bmf-app .mcard .mexpand{ display:grid; grid-template-rows:0fr; transition:grid-template-rows .28s cubic-bezier(.16,.84,.3,1); }
.bmf-app .mcard .mexpand > div{ overflow:hidden; min-height:0; }
.bmf-app .mcard.active .mexpand{ grid-template-rows:1fr; }
.bmf-app .mcard .mbrief{ font-size:var(--fs-meta); line-height:1.5; color:var(--text-subtle); margin-top:11px; max-width:34ch; }
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

/* ===== HOME on shorter phones (≤820px tall, where a dynamic browser toolbar eats height) — gently
   compress the chrome (gaps, dossier padding, helmet) to shorten the scroll. Content is no longer
   shed: the hub scrolls now, so the daily brief + campaign progress stay reachable. ===== */
@media (max-height:820px){
  .bmf-app.home .pad{ gap:8px; padding-top:calc(env(safe-area-inset-top) + 9px); padding-bottom:calc(var(--rail-h) + env(safe-area-inset-bottom) + 9px); }
  .bmf-app.home header.card{ padding-top:12px; padding-bottom:12px; }
  .bmf-app.home .helmet{ width:48px; height:48px; }
  .bmf-app.home .sec{ margin:0 2px 6px; }
}
@media (max-height:600px){
  .bmf-app.home .helmet{ width:42px; height:42px; }
}

@media (prefers-reduced-motion: reduce){
  .bmf-app .rise{ opacity:1 !important; transform:none !important; animation:none !important; }
  .bmf-app .helmet .sheen,.bmf-app .mote,.bmf-app .glyph.flicker svg path,.bmf-app .crt-streak,.bmf-app .artcard.heli .heli-art .ring,.bmf-app .cslide.active .artcard.map .img,.bmf-app.home .bar > i,.bmf-app .shopbanner::after,.bmf-app .grank.loading .sk{ animation:none !important; }
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

/* ===== desktop: centred single-column home · flanked-hero carousels · floating dock rail ===== */
@media (min-width:1040px){
  /* Single centred column — the Profile dossier + the PROVINCE Mission card + the gear promo. (Was a
     2-column dashboard whose left column held the retired Daily Burn; with that gone the home is a
     clean Profile + Mission-card stack.) overflow-y:auto + padding clear the floating dock rail. */
  .bmf-app.home .pad{ max-width:680px; display:flex; flex-direction:column; gap:13px; overflow-y:auto;
    padding-top:calc(env(safe-area-inset-top) + 30px); padding-bottom:120px; }
  .bmf-app.home .artcard .inner{ min-height:320px; }
  .bmf-app.home .shop-sec{ display:flex; }
  /* Menu overlays (Settings · Open Skies): a wide centred column. */
  .bmf-app:not(.home):not(.newpilot) .pad{ max-width:760px;
    padding-top:calc(env(safe-area-inset-top) + 30px); padding-bottom:120px; }
  /* Carousels (Campaign region picker · Hangar) become a GRID on desktop — every card visible at
     once, no chevrons, no per-view paging. Maps (4) and aircraft (3) each fit one balanced row that
     fills the wider column, so a desktop stops reading like a stretched phone. The carousel JS still
     runs (it just centres/marks-active a non-scrolling track) — the grid overrides all cards to full
     opacity/scale, so .active is a no-op here. */
  .bmf-app:not(.home):not(.newpilot) .pad:has(> .carousel){ max-width:1180px; display:flex; flex-direction:column; }
  /* Centre the single row of cards in the space below the title (margin:auto, not justify-content,
     so a short window can still scroll to reach the top card instead of clipping it). */
  .bmf-app .pad:has(> .carousel) > .carousel{ margin:auto 0; width:100%; }
  .bmf-app .ctrack{ display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));
    gap:22px; overflow:visible; scroll-snap-type:none; padding:4px 2px 2px; }
  .bmf-app .cslide{ flex:initial; width:auto; opacity:1; transform:none; cursor:default; }
  .bmf-app .cslide.active{ transform:none; }
  .bmf-app .cslide .artcard{ height:100%; }
  .bmf-app .cslide .artcard .inner{ min-height:400px; }
  .bmf-app .cslide .artcard.heli .inner{ min-height:420px; }
  .bmf-app .cnav, .bmf-app .dots{ display:none; }
  .bmf-app .artcard.heli .heli-art .mark svg{ width:118px; height:118px; }
  .bmf-app .artcard.heli .heli-art .ring{ width:150px; height:150px; top:18px; }
  /* Mission drill-down: a 2-up grid with every CTA revealed inline (the phone accordion's
     one-open-at-a-time focus isn't needed when there's room to show them all at once). */
  .bmf-app:not(.home):not(.newpilot) .pad:has(> .mlist){ max-width:1080px; }
  .bmf-app .mlist{ display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:16px; align-content:start; margin-top:16px; }
  .bmf-app .mcard .mexpand{ grid-template-rows:1fr; }
  .bmf-app .mcard .mbody{ max-width:80%; }
  /* Open Skies — a 2-column desktop LOBBY: the pitch (title · subtitle · what-it-is · teaser) on the
     left, the aircraft picker + Join on the right. Two wrapper columns (not a flat grid) so neither
     side's row heights couple to the other; centred + filling the width instead of a phone column. */
  .bmf-app:not(.home):not(.newpilot) .pad:has(> .osky){ max-width:1000px; overflow-y:auto; }
  .bmf-app .osky{ flex:initial; margin:auto 0; display:grid; grid-template-columns:1fr 1.04fr; column-gap:48px; align-items:center; }
  .bmf-app .osky-pitch{ align-self:center; }
  .bmf-app .osky-title{ font-size:var(--fs-mega); }
  .bmf-app .osky-sub{ margin-top:9px; font-size:var(--fs-hero); -webkit-line-clamp:unset; }
  .bmf-app .osky-desc{ margin-top:13px; max-width:40ch; -webkit-line-clamp:unset; }
  .bmf-app .osky-feats{ margin-top:20px; gap:12px; }
  .bmf-app .osky-feat{ font-size:var(--fs-md); }
  .bmf-app .osky-pick{ flex:initial; display:block; min-height:0; }
  .bmf-app .osky-pick .sec{ margin-top:0; }
  .bmf-app .osky-pick .heligrid{ flex:initial; margin-top:14px; gap:14px; grid-template-rows:auto; }
  .bmf-app .osky .hc-art{ flex:0 0 auto; aspect-ratio:3/4; min-height:0; }
  .bmf-app .osky-cta{ padding-top:18px; }
  .bmf-app .osky-cta .btn{ margin-top:0; max-width:340px; }
  /* Floating dock rail — shared by the hub AND every menu overlay so it reads the same everywhere. */
  .bmf-app .rail{ left:50%; right:auto; transform:translateX(-50%); bottom:18px; width:auto; min-width:540px; height:auto; padding-bottom:0;
    border:1px solid var(--bevel-top); border-radius:var(--r-xl); box-shadow:0 14px 44px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06); }
  .bmf-app .rail .keys{ max-width:none; height:66px; }
}
/* ===== large desktop: cap the centred grids so the cards never sprawl on huge monitors ===== */
@media (min-width:1320px){
  .bmf-app:not(.home):not(.newpilot) .pad:has(> .carousel){ max-width:1220px; }
  .bmf-app:not(.home):not(.newpilot) .pad:has(> .mlist){ max-width:1120px; }
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
