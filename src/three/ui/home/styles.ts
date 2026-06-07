/**
 * One injected stylesheet for the Home hub + its rail menus (HomeScreen, menus.ts). Everything is
 * scoped under `.bmf-app`, and the CSS custom properties are generated FROM `theme.ts` (the single
 * token source — DESIGN.md) so the menu uses the same palette/scale as the rest of the UI. The
 * instrument "metal" gradients are local extras (derived, not brand tokens).
 *
 * SINGLE-VIEWPORT, NO-SCROLL (CLAUDE.md hard rule): `.bmf-app` is a fixed full-viewport flex column;
 * its content area fits above the fixed rail and only scrolls internally as a safety net.
 */
import { UI, FS, FW, R } from '../theme';

const VARS = `.bmf-app{
  --ember:${UI.ember};--ember-hi:${UI.emberHi};--fire:${UI.fire};
  --menu:${UI.menu};--menu-soft:${UI.menuSoft};--menu-fill:${UI.menuFill};
  --cta:${UI.cta};--cta-hi:${UI.ctaHi};--cta-ink:${UI.ctaInk};--cta-glow:${UI.ctaGlow};
  --warn:${UI.warn};--ok:${UI.ok};--gold:${UI.gold};--silver:${UI.silver};--bronze:${UI.bronze};
  --text:${UI.text};--ink:${UI.ink};--dim:${UI.dim};--faint:${UI.faint};
  --card-glass:${UI.cardGlass};--card-soft:${UI.cardSoft};--warm-glass:${UI.warmGlass};
  --track:${UI.track};--recess:${UI.recess};--field:${UI.field};--rowmine:${UI.rowMine};
  --stroke:${UI.stroke};--stroke-strong:${UI.strokeStrong};--warm-stroke:${UI.warmStroke};--hair:${UI.hair};
  --shadow-card:${UI.shadowCard};--blur:${UI.blur};
  --font:${UI.font};--mono:ui-monospace,"SF Mono","SFMono-Regular",Menlo,Consolas,monospace;
  --fs-micro:${FS.micro};--fs-tag:${FS.tag};--fs-label:${FS.label};--fs-meta:${FS.meta};--fs-sm:${FS.sm};--fs-body:${FS.body};--fs-md:${FS.md};--fs-lg:${FS.lg};--fs-title:${FS.title};--fs-hero:${FS.hero};--fs-display:${FS.display};--fs-banner:${FS.banner};
  --fw-medium:${FW.medium};--fw-semibold:${FW.semibold};--fw-bold:${FW.bold};--fw-heavy:${FW.heavy};--fw-black:${FW.black};
  --r-sm:${R.sm};--r-md:${R.md};--r-lg:${R.lg};--r-xl:${R.xl};--r-pill:${R.pill};--r-round:${R.round};
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
  background:radial-gradient(130% 60% at 50% -8%, rgba(255,106,44,0.20) 0%, rgba(255,106,44,0.05) 30%, transparent 56%),
    radial-gradient(150% 90% at 50% 118%, rgba(255,120,40,0.12) 0%, transparent 52%),
    linear-gradient(180deg,#0a0d10 0%, #0b0e10 42%, #07090b 100%); }
.bmf-app .scene::after{ content:""; position:absolute; inset:0; pointer-events:none; box-shadow:inset 0 0 160px 50px rgba(0,0,0,0.7); }
.bmf-app .embers{ position:absolute; inset:0; z-index:1; pointer-events:none; overflow:hidden; }
.bmf-app .mote{ position:absolute; bottom:-12px; width:3px; height:3px; border-radius:50%;
  background:radial-gradient(circle, #ffd27a 0%, #ff7a2c 55%, transparent 75%); box-shadow:0 0 6px rgba(255,140,50,0.8); animation:bmf-rise-mote linear infinite; opacity:0; }
@keyframes bmf-rise-mote{ 0%{transform:translateY(0); opacity:0;} 12%{opacity:.9;} 80%{opacity:.7;} 100%{transform:translateY(-100vh) translateX(var(--drift,16px)); opacity:0;} }

.bmf-app .pad{ position:relative; z-index:2; flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; scrollbar-width:none;
  width:100%; max-width:452px; margin:0 auto;
  padding: calc(env(safe-area-inset-top) + 14px) 16px calc(var(--rail-h) + env(safe-area-inset-bottom) + 14px); }
.bmf-app .pad::-webkit-scrollbar{ display:none; }

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
.bmf-app .sec .line{ flex:1; height:1px; background:linear-gradient(90deg, rgba(255,194,74,0.32), transparent); }
.bmf-app .sec .stamp{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.16em; color:var(--faint); font-weight:var(--fw-bold); border:1px solid var(--hair); padding:2px 7px; border-radius:3px; white-space:nowrap; }
.bmf-app .sec .stamp.link{ cursor:pointer; color:var(--menu); border-color:var(--menu-soft); }

.bmf-app .appbar{ display:flex; align-items:center; gap:12px; min-height:44px; margin-bottom:6px; }
.bmf-app .back{ width:38px; height:38px; flex:0 0 auto; border-radius:var(--r-sm); border:1px solid var(--stroke); background:var(--card-soft); color:var(--text); display:grid; place-items:center; cursor:pointer; transition:border-color .14s, transform .14s; }
.bmf-app .back:hover{ border-color:var(--menu-soft); transform:translateY(-1px); }
.bmf-app .back svg{ width:18px; height:18px; }
.bmf-app .iconbtn{ width:36px; height:36px; flex:0 0 auto; border-radius:var(--r-sm); border:1px solid var(--stroke); background:var(--card-soft); color:var(--dim); display:grid; place-items:center; cursor:pointer; transition:border-color .14s, color .14s, transform .14s; }
.bmf-app .iconbtn:hover{ color:var(--ember-hi); border-color:var(--warm-stroke); transform:translateY(-1px); }
.bmf-app .iconbtn svg{ width:17px; height:17px; }
.bmf-app .appbar .ttl{ font-size:var(--fs-title); font-weight:var(--fw-heavy); letter-spacing:.04em; text-transform:uppercase; }
.bmf-app .appbar .sub{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.18em; text-transform:uppercase; color:var(--faint); margin-top:2px; }

.bmf-app .flame path,.bmf-app .flame polygon{ fill:url(#flameGrad); }
.bmf-app .brand{ width:34px; height:34px; flex:0 0 auto; display:grid; place-items:center; border-radius:var(--r-sm);
  background:radial-gradient(circle at 40% 30%, rgba(255,140,60,0.26), rgba(10,12,14,0.6)); border:1px solid var(--warm-stroke);
  box-shadow:inset 0 0 12px rgba(255,106,44,0.30), 0 0 14px rgba(255,106,44,0.18); }
.bmf-app .brand svg{ width:17px; height:21px; filter:drop-shadow(0 0 4px rgba(255,140,50,0.6)); }
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
  background:linear-gradient(90deg,transparent,#ff6a2c 30%,#ffc24a 50%,#ff6a2c 70%,transparent); animation:bmf-flick 3.4s ease-in-out infinite; }
@keyframes bmf-flick{ 0%,100%{opacity:.5} 30%{opacity:.95} 55%{opacity:.6} 80%{opacity:1} }

.bmf-app .artcard{ position:relative; border-radius:var(--r-xl); overflow:hidden; border:1px solid var(--stroke-strong); background:#0a0e12;
  box-shadow:var(--shadow-card), 0 0 26px rgba(255,106,44,0.12); clip-path:polygon(0 0,100% 0,100% calc(100% - 22px),calc(100% - 22px) 100%,0 100%); }
.bmf-app .artcard .img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:50% 34%; z-index:0; }
.bmf-app .artcard .fallback{ position:absolute; inset:0; z-index:0; background:radial-gradient(120% 90% at 50% 120%, rgba(255,106,44,0.5), transparent 60%), linear-gradient(160deg,#2a2030,#160d12 70%); display:grid; place-items:center; }
.bmf-app .artcard .fallback b{ font-family:var(--mono); font-weight:var(--fw-black); font-size:64px; color:rgba(255,255,255,0.07); }
.bmf-app .artcard .scrim{ position:absolute; inset:0; z-index:1; pointer-events:none;
  background:linear-gradient(180deg, rgba(8,6,4,0.05) 0%, rgba(8,6,4,0.1) 32%, rgba(6,4,3,0.8) 74%, rgba(4,3,2,0.95) 100%), linear-gradient(90deg, rgba(4,3,2,0.6) 0%, transparent 46%); }
.bmf-app .artcard .inner{ position:relative; z-index:3; padding:15px 16px 18px; display:flex; flex-direction:column; }
.bmf-app .brackets{ position:absolute; inset:11px; z-index:2; pointer-events:none; }
.bmf-app .brackets i{ position:absolute; width:15px; height:15px; border-color:var(--menu-soft); opacity:.6; }
.bmf-app .brackets i:nth-child(1){ top:0; left:0; border-top:2px solid; border-left:2px solid; }
.bmf-app .brackets i:nth-child(2){ top:0; right:0; border-top:2px solid; border-right:2px solid; }
.bmf-app .brackets i:nth-child(3){ bottom:0; left:0; border-bottom:2px solid; border-left:2px solid; }

.bmf-app .chip{ display:inline-flex; align-items:center; gap:5px; font-family:var(--mono); font-size:var(--fs-tag); letter-spacing:.18em; text-transform:uppercase; color:var(--cta-ink); font-weight:var(--fw-heavy); background:var(--cta); padding:4px 9px; border-radius:4px; box-shadow:0 1px 0 rgba(255,255,255,0.4) inset, 0 2px 8px rgba(239,170,43,0.4); white-space:nowrap; }
.bmf-app .chip.ghost{ color:var(--ember-hi); background:rgba(8,6,4,0.55); border:1px solid var(--warm-stroke); box-shadow:none; font-weight:var(--fw-bold); }
.bmf-app .pill{ font-family:var(--mono); font-size:var(--fs-tag); letter-spacing:.1em; text-transform:uppercase; padding:5px 11px; border-radius:var(--r-pill); background:var(--menu-fill); border:1px solid var(--menu-soft); color:var(--menu); font-weight:var(--fw-bold); white-space:nowrap; }
.bmf-app .pill.ok{ color:var(--ok); border-color:rgba(99,214,138,0.5); background:rgba(99,214,138,0.12); }
.bmf-app .pill.locked{ color:var(--dim); border-color:var(--hair); background:var(--recess); }
.bmf-app .pill.soon{ color:var(--menu); border-color:var(--menu-soft); background:var(--menu-fill); }

.bmf-app .ctx-row{ display:flex; flex-wrap:wrap; gap:7px; }
.bmf-app .ctx{ display:inline-flex; align-items:center; gap:5px; font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.1em; text-transform:uppercase; font-weight:var(--fw-bold); color:var(--dim); padding:5px 9px; border-radius:var(--r-pill); background:var(--recess); border:1px solid var(--hair); }
.bmf-app .ctx.hot{ color:var(--ember-hi); border-color:var(--warm-stroke); background:rgba(255,106,44,0.10); }
.bmf-app .ctx svg{ width:12px; height:12px; }

.bmf-app .grank{ display:flex; align-items:baseline; gap:7px; padding:5px 11px; border-radius:var(--r-pill); background:var(--menu-fill); border:1px solid var(--menu-soft); }
.bmf-app .grank b{ font-family:var(--mono); font-size:var(--fs-lg); font-weight:var(--fw-bold); color:var(--menu); }
.bmf-app .grank span{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.22em; text-transform:uppercase; color:var(--faint); font-weight:var(--fw-bold); }

.bmf-app .rank{ display:inline-flex; align-items:center; gap:6px; font-family:var(--mono); font-size:var(--fs-tag); font-weight:var(--fw-bold); letter-spacing:.16em; text-transform:uppercase; color:var(--rk,#ffa033); padding:3px 9px 3px 7px; white-space:nowrap;
  background:repeating-linear-gradient(45deg, rgba(255,160,51,0.12) 0 2px, transparent 2px 4px), rgba(255,160,51,0.10);
  border:1.5px solid color-mix(in srgb, var(--rk,#ffa033) 70%, transparent);
  clip-path:polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px);
  box-shadow:inset 0 0 8px color-mix(in srgb, var(--rk,#ffa033) 18%, transparent), 0 0 12px color-mix(in srgb, var(--rk,#ffa033) 20%, transparent); }
.bmf-app .rank i{ width:7px; height:7px; border-radius:1px; transform:rotate(45deg); background:var(--rk,#ffa033); box-shadow:0 0 6px color-mix(in srgb, var(--rk,#ffa033) 85%, transparent); }

.bmf-app .glyph{ width:36px; height:36px; flex:0 0 auto; display:grid; place-items:center; border-radius:var(--r-sm); border:1px solid var(--warm-stroke);
  background:radial-gradient(circle at 40% 30%, rgba(255,140,60,0.38), rgba(10,12,14,0.9)); box-shadow:inset 0 0 10px rgba(255,106,44,0.35); }
.bmf-app .glyph svg{ width:17px; height:21px; } .bmf-app .glyph svg path{ fill:url(#flameGrad); filter:drop-shadow(0 0 4px rgba(255,140,50,0.8)); }
.bmf-app .glyph.flicker svg path{ animation:bmf-glyph 2.8s ease-in-out infinite; }
@keyframes bmf-glyph{ 0%,100%{opacity:1;transform:scale(1)} 45%{opacity:.82;transform:scale(.97)} 70%{opacity:.95} }

.bmf-app .streak{ display:inline-flex; align-items:center; gap:6px; font-family:var(--mono); font-size:var(--fs-tag); font-weight:var(--fw-bold); letter-spacing:.1em; text-transform:uppercase; color:var(--ember-hi); padding:6px 10px; border-radius:var(--r-pill); background:var(--warm-glass); border:1px solid var(--warm-stroke); white-space:nowrap; }
.bmf-app .streak svg{ width:11px; height:13px; } .bmf-app .streak svg path{ fill:var(--fire); }

.bmf-app .stars{ display:inline-flex; gap:3px; } .bmf-app .stars svg{ width:15px; height:15px; }
.bmf-app .stars .on{ fill:var(--menu); stroke:none; filter:drop-shadow(0 0 5px rgba(255,194,74,0.7)); }
.bmf-app .stars .off{ fill:rgba(255,255,255,0.2); stroke:none; }

.bmf-app .bar{ height:6px; border-radius:var(--r-pill); background:var(--recess); overflow:hidden; border:1px solid var(--hair); box-shadow:inset 0 1px 3px rgba(0,0,0,0.6); position:relative; }
.bmf-app .bar > i{ display:block; height:100%; border-radius:var(--r-pill); background:linear-gradient(90deg,#ff7a45,#ffc24a); box-shadow:0 0 8px rgba(255,140,50,0.5); }
.bmf-app .barrow{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px; }
.bmf-app .barrow .l{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.18em; text-transform:uppercase; color:var(--dim); }
.bmf-app .barrow .r{ font-family:var(--mono); font-size:var(--fs-tag); color:var(--ember-hi); font-weight:var(--fw-bold); }
.bmf-app .spec{ display:grid; grid-template-columns:64px 1fr; align-items:center; gap:10px; margin:7px 0; }
.bmf-app .spec .name{ font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.12em; text-transform:uppercase; color:var(--dim); }
.bmf-app .spec .track{ height:7px; border-radius:var(--r-pill); background:var(--recess); border:1px solid var(--hair); overflow:hidden; }
.bmf-app .spec .track > i{ display:block; height:100%; background:linear-gradient(90deg,#ff7a45,#ffc24a); border-radius:var(--r-pill); }

.bmf-app .btn{ display:inline-flex; align-items:center; justify-content:center; gap:9px; cursor:pointer; font-family:var(--font); font-size:var(--fs-md); font-weight:var(--fw-heavy); letter-spacing:.06em; text-transform:uppercase; border:none; border-radius:var(--r-sm); padding:13px 22px; min-height:48px; transition:transform .12s, background .12s, box-shadow .12s; }
.bmf-app .btn svg{ width:16px; height:16px; }
.bmf-app .btn.block{ width:100%; } .bmf-app .btn.sm{ padding:9px 15px; min-height:38px; font-size:var(--fs-sm); } .bmf-app .btn.lg{ padding:16px 26px; min-height:54px; font-size:var(--fs-lg); }
.bmf-app .btn.primary{ background:var(--cta); color:var(--cta-ink); box-shadow:0 1px 0 rgba(255,255,255,0.5) inset, 0 -2px 0 rgba(0,0,0,0.18) inset, 0 8px 20px var(--cta-glow); }
.bmf-app .btn.primary svg{ fill:var(--cta-ink); } .bmf-app .btn.primary:hover{ background:var(--cta-hi); transform:translateY(-2px); }
.bmf-app .btn.ember{ color:var(--ember-hi); background:linear-gradient(180deg, rgba(255,122,69,0.16), rgba(255,122,69,0.06)); border:1.5px solid var(--warm-stroke); border-radius:var(--r-pill); box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 14px rgba(255,106,44,0.14); }
.bmf-app .btn.ember svg{ fill:var(--ember-hi); } .bmf-app .btn.ember:hover{ background:linear-gradient(180deg, rgba(255,122,69,0.28), rgba(255,122,69,0.12)); transform:translateY(-1px); }
.bmf-app .btn.secondary{ background:var(--warm-glass); color:var(--text); border:1.5px solid var(--warm-stroke); box-shadow:inset 0 1px 0 rgba(255,255,255,0.06); }
.bmf-app .btn.secondary svg{ fill:var(--ember-hi); } .bmf-app .btn.secondary:hover{ background:rgba(60,24,18,0.6); transform:translateY(-2px); }
.bmf-app .btn.ghost{ background:transparent; color:var(--dim); border:1px solid var(--stroke); } .bmf-app .btn.ghost:hover{ color:var(--text); border-color:var(--stroke-strong); }
.bmf-app .btn.danger{ color:var(--warn); background:rgba(255,93,77,0.1); border:1px solid rgba(255,93,77,0.5); font-family:var(--mono); letter-spacing:.1em; } .bmf-app .btn.danger:hover{ background:rgba(255,93,77,0.18); }
.bmf-app .btn[disabled],.bmf-app .btn.is-disabled{ opacity:.45; filter:grayscale(.4); cursor:not-allowed; }

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

.bmf-app .cnav{ position:absolute; top:46%; transform:translateY(-50%); z-index:6; width:42px; height:42px; border-radius:50%; display:grid; place-items:center; cursor:pointer; color:var(--ember-hi); padding:0;
  background:rgba(10,13,16,0.74); border:1px solid var(--warm-stroke); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  box-shadow:0 6px 18px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06); transition:transform .14s, background .14s, opacity .22s; }
.bmf-app .cnav svg{ width:20px; height:20px; }
.bmf-app .cnav.prev{ left:6px; } .bmf-app .cnav.next{ right:6px; }
.bmf-app .cnav:hover{ background:rgba(255,106,44,0.18); transform:translateY(-50%) scale(1.07); }
.bmf-app .cnav.hide{ opacity:0; pointer-events:none; }

.bmf-app .cmeta{ display:flex; align-items:center; justify-content:center; gap:8px; margin-top:11px;
  font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.18em; text-transform:uppercase; color:var(--faint); font-weight:var(--fw-bold); }
.bmf-app .cmeta b{ color:var(--ember-hi); }

/* heli hero — procedural "hangar bay" art tinted by the airframe accent (--accent) */
.bmf-app .artcard.heli .heli-art{ position:absolute; inset:0; z-index:0; overflow:hidden;
  background:radial-gradient(95% 72% at 50% 30%, color-mix(in srgb, var(--accent,#c8362a) 50%, transparent), transparent 68%),
    radial-gradient(120% 90% at 50% 122%, rgba(255,106,44,0.32), transparent 58%),
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

/* ===== bottom rail ===== */
.bmf-app .rail{ position:absolute; left:0; right:0; bottom:0; z-index:40; height:calc(var(--rail-h) + env(safe-area-inset-bottom)); padding-bottom:env(safe-area-inset-bottom);
  background:linear-gradient(180deg,#15191d 0%, #0c0f12 100%); border-top:1px solid var(--bevel-top); box-shadow:0 -8px 24px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05); }
.bmf-app .rail .keys{ max-width:452px; margin:0 auto; height:var(--rail-h); display:flex; align-items:stretch; }
.bmf-app .key{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; cursor:pointer; position:relative; border:0; background:transparent; color:var(--dim); font-family:var(--mono); font-size:var(--fs-micro); letter-spacing:.02em; text-transform:uppercase; font-weight:var(--fw-bold); }
.bmf-app .key + .key::before{ content:""; position:absolute; left:0; top:20%; bottom:20%; width:1px; background:rgba(0,0,0,0.5); }
.bmf-app .key svg{ width:20px; height:20px; transition:transform .12s, filter .12s; }
.bmf-app .key:hover{ color:rgba(255,255,255,0.7); }
.bmf-app .key.active{ color:var(--ember-hi); }
.bmf-app .key.active svg{ filter:drop-shadow(0 0 7px rgba(255,140,50,0.8)); transform:translateY(-1px); }
.bmf-app .key.active::after{ content:""; position:absolute; top:7px; left:50%; transform:translateX(-50%); width:42px; height:42px; border-radius:12px; z-index:-1; background:radial-gradient(circle at 50% 30%, rgba(255,122,69,0.28), rgba(255,106,44,0.05) 70%, transparent); border:1px solid var(--warm-stroke); box-shadow:inset 0 1px 0 rgba(255,255,255,0.08), 0 0 16px rgba(255,106,44,0.3); }
.bmf-app .key .tick{ position:absolute; top:3px; width:18px; height:2px; border-radius:2px; background:var(--ember-hi); box-shadow:0 0 8px rgba(255,140,50,0.9); }

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
.bmf-app .toggle.on{ background:linear-gradient(180deg, rgba(255,122,69,0.55), rgba(255,106,44,0.35)); border-color:var(--warm-stroke); box-shadow:inset 0 0 8px rgba(255,106,44,0.4); }
.bmf-app .toggle.on .knob{ transform:translateX(21px); background:linear-gradient(180deg,#fff,#ffd9a0); }

/* ===== text fields (new-pilot registration) — warm ember focus, the fight register ===== */
.bmf-app .field{ display:flex; align-items:center; gap:11px; background:var(--field); border:1px solid var(--stroke); border-radius:var(--r-lg);
  padding:0 15px; transition:border-color .18s ease, box-shadow .18s ease; }
.bmf-app .field:focus-within{ border-color:var(--ember); box-shadow:0 0 0 3px rgba(255,106,44,0.18), 0 2px 18px rgba(255,106,44,0.12); }
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
  background:linear-gradient(90deg, var(--fire), var(--menu)); box-shadow:0 0 12px rgba(255,106,44,0.5); }
.bmf-app.newpilot .lede{ font-size:var(--fs-body); color:var(--dim); line-height:1.5; margin:0 0 24px; max-width:34ch; }
@media (min-width:740px){ .bmf-app.newpilot .reg{ max-width:460px; } }

@media (prefers-reduced-motion: reduce){
  .bmf-app .rise{ opacity:1 !important; transform:none !important; animation:none !important; }
  .bmf-app .helmet .sheen,.bmf-app .mote,.bmf-app .glyph.flicker svg path,.bmf-app .crt-streak,.bmf-app .artcard.heli .heli-art .ring{ animation:none !important; }
  .bmf-app .cslide{ opacity:1 !important; transform:none !important; }
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
  .bmf-app.home .pad{ max-width:1000px; display:grid; grid-template-columns:380px 1fr; column-gap:24px; align-items:start; align-content:start;
    padding-top:calc(env(safe-area-inset-top) + 32px); padding-bottom:116px; }
  .bmf-app.home .pad > header{ grid-column:1 / -1; margin-bottom:4px; }
  .bmf-app.home .z-daily{ grid-column:1; }
  .bmf-app.home .z-cont{ grid-column:2; }
  .bmf-app.home .z-cont .artcard .inner{ min-height:460px; }
  .bmf-app.home .sec{ margin-top:6px; }
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
