const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./main-DSPL1Mwb.js","./frontShell-BMJ5seWN.js"])))=>i.map(i=>d[i]);
import{_ as x,i as T,b as L,c as A,d as C,e as I,D as z,s as F,w as O,m as B,r as P,n as R,p as l,q as M,u as N,g as H,h as _,j,t as $,v as D,x as W,y as G,z as q,A as Y,B as U,C as V,L as K,E as X,F as h,G as Z,I as J,J as u}from"./frontShell-BMJ5seWN.js";import{m as Q}from"./blogCarousel-BMN_1FGV.js";const ee=".artcard, .fhome-hero, .fhome-play, .shopbanner, .crt, .fhome-map";function te(e){const t=Array.from(e.querySelectorAll(".card")).filter(a=>!a.matches(ee));if(!t.length)return()=>{};for(const a of t)a.classList.add("cardfx");const o=a=>{if(a.pointerType==="touch")return;const i=a.target?.closest?.(".cardfx");if(!i)return;const r=i.getBoundingClientRect();if(!r.width||!r.height)return;const s=(a.clientX-r.left)/r.width*100,n=(a.clientY-r.top)/r.height*100;i.style.setProperty("--mx",s.toFixed(1)+"%"),i.style.setProperty("--my",n.toFixed(1)+"%");const p=Math.round(Math.atan2(n-50,s-50)*180/Math.PI+90);i.style.setProperty("--rim-ang",p+"deg")};return e.addEventListener("pointermove",o,{passive:!0}),()=>e.removeEventListener("pointermove",o)}const ae="radial-gradient(130% 100% at 50% 78%, #2a120b 0%, #150a07 46%, #090605 100%)",oe=["--dx:-4px;--by:-2px;left:38%;width:5px;height:5px;animation-delay:0s;animation-duration:1.9s","--dx:5px;--by:3px;left:44%;width:3px;height:3px;animation-delay:0.3s;animation-duration:2.3s","--dx:-7px;--by:5px;left:48%;width:6px;height:6px;animation-delay:0.6s;animation-duration:1.7s","--dx:4px;--by:1px;left:52%;width:4px;height:4px;animation-delay:0.9s;animation-duration:2.05s","--dx:-5px;--by:-3px;left:56%;width:5px;height:5px;animation-delay:1.15s;animation-duration:1.8s","--dx:8px;--by:4px;left:62%;width:3px;height:3px;animation-delay:0.45s;animation-duration:2.4s","--dx:-2px;--by:0px;left:41%;width:4px;height:4px;animation-delay:1.4s;animation-duration:2.15s","--dx:6px;--by:-4px;left:59%;width:6px;height:6px;animation-delay:0.75s;animation-duration:1.6s","--dx:1px;--by:2px;left:50%;width:7px;height:7px;animation-delay:1.55s;animation-duration:1.95s","--dx:-6px;--by:6px;left:46%;width:4px;height:4px;animation-delay:1.25s;animation-duration:2.1s"],ie=`<div class="bmf-spin" aria-hidden="true">
  ${oe.map(e=>`<span class="spark" style="${e}"></span>`).join(`
  `)}
  <svg class="mark" viewBox="0 0 149.7 184.72">
    <path class="f1" d="M73.06,58.25c-18.59,21.04-34.35,33.63-22.6,64.65-21.97-11.26-29.05-37.71-17.05-59.08C46.45,40.59,68.12,28.39,69.08,0c16.8,18.38,20.62,39.42,3.98,58.25Z"/>
    <path class="f2" d="M78.83,107.06c-5.97,5.58-8.3,13.06-8.78,21.51-10.73-8.26-13.63-23.66-5.17-35.08,13.99-18.88,30.5-27.51,32.95-51.73,22.16,26.58,26.3,62.23-2.1,82.13,1.38-11.22,2.02-20.02-3.9-28.97l-12.99,12.14Z"/>
    <polygon class="chev" points="149.7 134.09 74.92 184.72 0 134.31 .57 108.82 74.83 158.71 148.67 108.67 149.7 134.09"/>
  </svg>
</div>`,ne=`
.bmf-spin { position: relative; width: 96px; height: 122px; display: grid; place-items: center; }
.bmf-spin .mark { width: 58px; fill: #ff7a2f; z-index: 1; animation: bmf-spin-glow 0.5s ease-in-out infinite alternate, bmf-spin-flicker 0.13s steps(2, end) infinite; }
.bmf-spin .mark path, .bmf-spin .mark polygon { transform-box: fill-box; }
.bmf-spin .f1 { transform-origin: center bottom; animation: bmf-spin-flick1 0.52s ease-in-out infinite alternate; }
.bmf-spin .f2 { fill: #ffd27a; transform-origin: center bottom; animation: bmf-spin-flick2 0.71s ease-in-out infinite alternate; }
.bmf-spin .chev { transform-origin: center; animation: bmf-spin-bed 1.5s ease-in-out infinite; }
.bmf-spin .spark {
  position: absolute; bottom: calc(44px + var(--by, 0px)); left: 50%; z-index: 2;
  width: 5px; height: 5px; border-radius: 50%;
  /* A glowing cinder, not a dot — white-hot core fading to a soft transparent ember edge. */
  background: radial-gradient(circle, #fff4da 0%, #ffce6a 38%, rgba(255, 140, 55, 0.55) 68%, rgba(255, 110, 40, 0) 100%);
  box-shadow: 0 0 6px 1px rgba(255, 145, 55, 0.5);
  filter: blur(0.4px); opacity: 0; will-change: transform, opacity;
  animation: bmf-spin-rise 1.9s ease-out infinite;
}
@keyframes bmf-spin-flick1 { from { transform: scaleY(0.9) skewX(3deg); opacity: 0.75; } to { transform: scaleY(1.07) skewX(-4deg); opacity: 1; } }
@keyframes bmf-spin-flick2 { from { transform: scaleY(1.06) skewX(-3deg); opacity: 1; } to { transform: scaleY(0.9) skewX(4deg); opacity: 0.72; } }
@keyframes bmf-spin-bed { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
@keyframes bmf-spin-glow { from { filter: drop-shadow(0 0 10px rgba(255, 120, 40, 0.55)) brightness(0.98); } to { filter: drop-shadow(0 0 22px rgba(255, 170, 75, 0.82)) brightness(1.08); } }
@keyframes bmf-spin-flicker { 0% { opacity: 1; } 50% { opacity: 0.93; } 100% { opacity: 1; } }
/* Rising cinder: fades in, TWINKLES, SWAYS on the heat plume, and COOLS/shrinks to a mote. */
@keyframes bmf-spin-rise {
  0% { opacity: 0; transform: translate(0, 0) scale(0.5); }
  10% { opacity: 1; transform: translate(calc(var(--dx, 0px) * 0.15 - 1px), -8px) scale(1); }
  28% { opacity: 0.5; transform: translate(calc(var(--dx, 0px) * 0.4 + 3px), -24px) scale(0.92); }
  48% { opacity: 1; transform: translate(calc(var(--dx, 0px) * 0.6 - 3px), -42px) scale(0.78); }
  70% { opacity: 0.45; transform: translate(calc(var(--dx, 0px) * 0.85 + 2px), -60px) scale(0.55); }
  100% { opacity: 0; transform: translate(var(--dx, 0px), -82px) scale(0.18); }
}
@media (prefers-reduced-motion: reduce) {
  .bmf-spin .mark { animation: bmf-spin-glow 2.6s ease-in-out infinite alternate !important; }
  .bmf-spin .spark { display: block; animation-duration: 3.2s !important; animation-iteration-count: infinite !important; }
}`,re={id:"bmf-splash",role:"status","aria-label":"Loading Bucket My Fire"},se=`#bmf-splash {
  position: fixed; inset: 0; z-index: 9999; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 20px;
  background: ${ae};
  color: #f4ead9; transition: opacity 0.5s ease;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased;
}
#bmf-splash.bmf-hide { opacity: 0; pointer-events: none; }
${ne}`,f=new URLSearchParams(location.search),pe=["m","autostart","qa","ffa","province","daily","editor","dev","heliview","kit","tune"],le=pe.some(e=>f.has(e));le?queueMicrotask(fe):me();let g=!1;function fe(){if(g)return;g=!0,document.body.classList.add("bmf-playing");const e=document.getElementById("game");e&&(e.innerHTML=""),document.getElementById("fd-boot")?.remove(),!f.has("qa")&&!f.has("autostart")&&he(),x(()=>import("./main-DSPL1Mwb.js").then(t=>t.a7),__vite__mapDeps([0,1]),import.meta.url)}function he(){if(document.getElementById("bmf-splash"))return;if(!document.getElementById("bmf-splash-css")){const n=document.createElement("style");n.id="bmf-splash-css",n.textContent=se,document.head.appendChild(n)}const e=document.createElement("div");for(const[n,p]of Object.entries(re))e.setAttribute(n,p);e.innerHTML=ie,document.body.appendChild(e);const t=1100,o=performance.now();let a=!1,i=0;const r=()=>{a||(a=!0,i&&clearTimeout(i),e.classList.add("bmf-hide"),setTimeout(()=>e.remove(),550))},s=()=>{if(a||i)return;const n=t-(performance.now()-o);n<=0?r():i=window.setTimeout(r,n)};window.addEventListener("bmf:ready",s),setTimeout(r,12e3)}function me(){T(),L(),A(),C(),I(),Ee();const e=document.getElementById("game");if(!e)return;const t=document.createElement("div");t.className="bmf-app front",t.innerHTML=z+xe(),e.innerHTML="",e.appendChild(t),document.getElementById("fd-boot")?.remove(),F(t,13),O(t),ce(t),v(-1),ge(),ue(t),te(t),ye(),ve(t),f.has("map")&&y()}function ce(e){const t=e.querySelector("#fhome-pilot");if(!t)return;const o=B();if(!o?.name){t.classList.add("is-new"),t.innerHTML='<span class="fpb-cs">New pilot</span><span class="fpb-meta"><span class="fpb-hint">Fly to earn your rank</span></span>';return}const a=P(R());t.innerHTML=`<span class="fpb-cs"></span><span class="fpb-meta"><span class="rank" style="--rk:${a.color}"><i></i>${a.name}</span><span class="fpb-pts pts-ic mono">${l("spark")}<b>${M().toLocaleString("en-US")}</b> pts</span></span>`;const i=t.querySelector(".fpb-cs");i&&(i.textContent=o.name.toUpperCase())}function v(e){const t=document.getElementById("fhome-pilots-live");if(!t)return;const o=t.querySelector("b"),a=t.querySelector("span");e>=1?(o&&(o.textContent=e.toLocaleString("en-US")),a&&(a.textContent=e===1?"Pilot live":"Pilots live")):(o&&(o.textContent=""),a&&(a.textContent="Open Skies live"))}const de=6e3,be=4e3;async function ge(){let e;try{e=await x(()=>import("./openSkies-BkVayIv8.js"),[],import.meta.url)}catch{return}if(!e.openSkiesConfigured())return;const t=e.connectOpenSkies(N(new Date),{id:"fd-listener",name:"",heli:""},de);if(!t)return;const o=()=>v(t.remotes().length),a=window.setTimeout(o,1400),i=window.setInterval(o,be);window.addEventListener("pagehide",()=>{window.clearTimeout(a),window.clearInterval(i),t.close()},{once:!0})}function xe(){return`
${H()}
<div class="fhome-bg" aria-hidden="true"><img src="/images/missions/saskatchewan/ThreeTown.webp" alt="" /></div>
${_("home")}

<div class="pad fhome">
  <div class="fhome-grid">
    <!-- HERO — the live fire, right now. The data IS the hero (no CTA), written BARE (no card) directly over
         the full-page ThreeTown key-art. When both authoritative feeds are unreachable the live figure
         hides and an honest fallback takes its place (paintNational). Open Skies + the Map card carry nav. -->
    <section class="fhome-hero" aria-label="Wildfire across Canada, right now">
      <div class="fhome-tx">
        <div class="fhome-hero-top">
          <span class="badge ok" id="fd-live">Live</span>
          <span class="fhome-fresh" id="fd-fresh">CIFFC + CWFIS</span>
        </div>
        <h1 class="fhome-eyebrow fhome-hero-kick">Wildfires across Canada<br>Right now</h1>
        <!-- The live figure — hydrated by paintNational(). -->
        <div id="fhome-live">
          <div class="fhome-fig"><b id="ro-active">—</b><span>active fires</span></div>
          <div class="fhome-stats">
            <span class="fhome-stat hot"><b id="ro-oc">—</b><span>out of control</span></span>
            <span class="fhome-stat"><b id="ro-hot">—</b><span>satellite hotspots</span></span>
            <span class="fhome-stat"><b id="ro-area">—</b><span>burned this year</span></span>
            <span class="fhome-stat"><b id="ro-prep">—</b><span>prep level</span></span>
          </div>
        </div>
        <!-- Honest fallback when both feeds are down (not "no fires") — shown by paintNational. -->
        <p class="fhome-sub" id="fhome-fallback" hidden>Live totals are offline. Check official sources for the current picture.</p>
      </div>
    </section>

    <!-- Map — opens the full live wildfire tracker (layer toggles + smoke scrubber + detail sheet). The
         faint cyan cartographic grid (.fhome-map-grid) makes it read as a tactical map readout.
         DOM-ordered BEFORE the play tile so the MOBILE single-column stack reads hero → map → gameplay
         (the live data leads into the live map, then the game). Desktop is unaffected: every tile has an
         explicit grid-area, so the bento layout ignores source order. -->
    <button class="card fhome-map" data-act="fires" aria-label="Open the live wildfire map">
      <span class="fd-glasstex" aria-hidden="true"></span>
      <span class="fhome-map-grid" aria-hidden="true"></span>
      <span class="fhome-map-ic">${l("map")}</span>
      <span class="fhome-map-tx"><b>Live fire map</b><span>Reported fires, hotspots, fire weather &amp; smoke</span></span>
      <span class="fhome-map-go">${l("chevron-right")}</span>
    </button>

    <!-- OPEN SKIES — the play CTA over the live-fire key-art. A top OVERLAY banner carries the slimmed
         dossier (the pilot's identity: callsign + rank + points) on the left and the live presence
         ("N Pilots Live") on the right; the Open Skies copy + Fly CTA stay at the base. The banner's
         profile slot is populated by mountPilotBanner() (an invite line when first-run); the live count
         by hydratePilotsLive(). -->
    <button class="card warm cut fhome-play" data-act="coop" aria-label="Play Open Skies">
      <div class="fhome-art"><img src="/images/ui/homescreen-bg.webp" alt="A Bell helicopter with a slung Bambi bucket dropping water on a wildfire over boreal lake country" /></div>
      <div class="fhome-art-fade"></div>
      <div class="fhome-play-banner">
        <div class="fpb-id" id="fhome-pilot"></div>
        <span class="fpb-live" id="fhome-pilots-live" aria-live="polite"><i class="fpb-dot"></i><b>—</b><span>Pilots Live</span></span>
      </div>
      <div class="fhome-tx fhome-play-tx">
        <span class="h-big fhome-play-h">Open Skies</span>
        <span class="fhome-play-sub">Fly helicopters and fight the fire.</span>
        <span class="btn primary fhome-play-go">${l("play")}Fly now</span>
      </div>
    </button>

    <!-- Wear the fight — the BIG shop feature card. The real merch poster (Wearthefight.png) is the art,
         cropped to the heli + firefighter so the poster's own baked "WEAR THE FIGHT" type sits below the
         frame and never clashes with our overlaid copy + Shop CTA. -->
    <button class="card warm cut fhome-merch" data-act="shop" aria-label="Open the BMF Gear store">
      <div class="fhome-merch-art"><img src="/images/shop/helidesigns/Wearthefight.png" alt="Wear the fight — a wildland firefighter and a Bell helicopter slinging a Bambi bucket over a forest fire" /></div>
      <div class="fhome-merch-fade"></div>
      <div class="fhome-tx fhome-merch-tx">
        <span class="fhome-merch-ey">${l("shop")}BMF Gear</span>
        <span class="h-big fhome-merch-h">Wear the fight.</span>
        <span class="fhome-merch-sub">Tees &amp; hoodies, printed on demand.</span>
        <span class="btn primary fhome-merch-go">Shop the collection</span>
      </div>
    </button>

    <!-- Prepare — a compact secondary call-out, NOT the full checklist (that interactive card lives on
         /prepare/). A one-line promo + a ghost button hand off to it, so the home stays the marketing
         surface and the readiness tool has one home. -->
    <a class="card green cut fhome-prep" href="/prepare/#checklist">
      <div class="fhome-prep-tx">
        <span class="fhome-prep-h">Are you fire ready?</span>
        <span class="fhome-prep-sub">A quick wildfire-readiness checklist — six concrete actions.</span>
      </div>
      <span class="btn ghost fhome-prep-go">Open checklist →</span>
    </a>
    <section class="card fhome-notes">
      <div class="sec"><span class="tag">Field Notes</span><span class="line"></span></div>
      <div class="fd-rail" id="fd-notes-rail"></div>
    </section>
  </div>

  ${j()}
</div>
${$("home")}`}function ue(e){e.querySelectorAll("[data-act]").forEach(t=>{t.addEventListener("click",o=>{switch(o.preventDefault(),o.stopPropagation(),t.dataset.act){case"coop":location.assign("/open-skies/");return;case"fires":return y();case"shop":return D("shop")}})})}function y(){W(q("map"),G("map"))}async function ve(e){const t=e.querySelector("#fd-notes-rail");t&&await Q(t)}async function ye(){const[e,t,o]=await Promise.all([Y().catch(()=>null),U().catch(()=>null),V().catch(()=>null)]);Se(e,t,o)}function we(e,t){return t&&t.meta.status==="live"?{n:u(t.fires,"CA").length,pub:t.meta.publishedAt}:e&&e.meta.status==="live"?{n:e.activeFires,pub:e.meta.publishedAt}:{n:-1,pub:0}}function ke(e){return!e||e.meta.status!=="live"?-1:u(e.fires,"CA").filter(t=>t.stage==="OC").length}function Se(e,t,o){const a=(S,E)=>{const b=document.getElementById(S);b&&(b.textContent=E)},i=document.getElementById("fd-fresh"),r=document.getElementById("fhome-live"),s=document.getElementById("fhome-fallback"),n=document.getElementById("fd-live"),p=!!e&&e.meta.status==="live",w=!!t&&t.meta.status==="live";if(!p&&!w){r&&(r.hidden=!0),s&&(s.hidden=!1),n&&(n.hidden=!0),i&&(i.innerHTML=`Live data unavailable · <a href="${K.summary.url}" target="_blank" rel="noopener">official sources →</a>`);return}r&&(r.hidden=!1),s&&(s.hidden=!0),n&&(n.hidden=!1);const{n:m,pub:k}=we(e,t),c=ke(t),d=o&&o.meta.status==="live"?X(o.hotspots,"CA").length:-1;a("ro-active",m>=0?h(m):"—"),a("ro-oc",c>=0?h(c):"—"),a("ro-hot",d>=0?h(d):"—"),a("ro-area",p&&e.areaBurnedHa>0?Z(e.areaBurnedHa):"—"),a("ro-prep",p&&e.prepLevel>0?`L${e.prepLevel}`:"—"),i&&(i.textContent=`${J(k)} · CIFFC + CWFIS`)}function Ee(){if(document.getElementById("fd-bento-css"))return;const e=document.createElement("style");e.id="fd-bento-css",e.textContent=`
/* Bento grid. Grid items default to min-width:auto, so a nowrap child (the ticker line) or a
   horizontal scroller (the notes rail) would force the single 1fr column wider than the phone
   viewport and overflow the page. min-width:0 lets every card shrink to the column, and the
   inner overflow-x:auto scrollers keep their own scroll. (Inert on the desktop 2-col grid.) */
.bmf-app.front .fhome-grid { display: grid; gap: 12px; grid-template-columns: 1fr; }
.bmf-app.front .fhome-grid > * { min-width: 0; }
@media (min-width: 880px) {
  /* STRETCHED to a balanced two-column bento (was 2fr/1fr): the data hero keeps a hair more room than
     the play tile, the map/merch + prep/notes rows read as even halves. This is the whole "stretch the
     layout" pass — same cards, same tokens, just spread to fill the band like the reference. */
  /* Row 1 = hero | gameplay (kept ABOVE THE FOLD). Row 2 = map | checklist. Row 3 = the BIG shop
     feature card | Field Notes. (Checklist + shop SWAPPED: shop drops into the large bottom-left slot.) */
  .bmf-app.front .fhome-grid { grid-template-columns: 1.04fr 1fr; grid-template-areas: "hero play" "map prep" "merch notes"; align-items: stretch; }
  .bmf-app.front .fhome-hero { grid-area: hero; }
  .bmf-app.front .fhome-play { grid-area: play; }
  .bmf-app.front .fhome-map { grid-area: map; }
  .bmf-app.front .fhome-merch { grid-area: merch; }
  .bmf-app.front .fhome-prep { grid-area: prep; }
  .bmf-app.front .fhome-notes { grid-area: notes; }
  /* NOTE: the desktop VISUAL overrides (play aspect, hero height, headline size, one-row stats) live in a
     media block at the END of this stylesheet — they must come AFTER the base .fhome-play/.fhome-hero
     rules below or those (later, equal-specificity) would clobber them. */
}

/* The ThreeTown aerial key-art fills the WHOLE front door as a fixed cinematic background. Home ONLY — Campaign/Prepare
   don't emit .fhome-bg, so the shared frontShell .scene is untouched. It sits above .scene (z-0, painted
   later) and under .embers (z-1) + the content (z-2), so the embers drift over the photo and the bento
   floats above it. The scrim (::after) buys the BARE hero data its contrast now that it sits on the page
   instead of inside a card: it darkens the lower-left where the live figure + cards sit, leaving the
   fire plume + horizon lit. (Photographic scrims are art literals — same rgba(7,10,13) base as the fades.) */
.bmf-app.front .fhome-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
.bmf-app.front .fhome-bg img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 42%; display: block; }
.bmf-app.front .fhome-bg::after { content: ""; position: absolute; inset: 0;
  background:
    linear-gradient(180deg, rgba(7,10,13,0.34) 0%, rgba(7,10,13,0.55) 54%, rgba(7,10,13,0.86) 100%),
    linear-gradient(90deg, rgba(7,10,13,0.78) 0%, rgba(7,10,13,0.32) 52%, transparent 100%); }

/* Key-art backdrop for the Open Skies play tile (the hero now uses the page background instead): a
   RIGHT-TO-LEFT fade — dark down the full-height LEFT edge so BOTH the top banner info (New pilot) and the
   bottom copy (heading/sub/CTA) read — a bottom scrim for the base copy, and an extra bottom-LEFT radial
   pooling the darkest weight under the heading/CTA stack. */
.bmf-app.front .fhome-art { position: absolute; inset: 0; z-index: 0; }
.bmf-app.front .fhome-art img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 26%; display: block; }
.bmf-app.front .fhome-art-fade { position: absolute; inset: 0; z-index: 1; background:
  radial-gradient(125% 95% at 0% 100%, rgba(5,7,9,0.97) 0%, rgba(7,10,13,0.6) 26%, rgba(7,10,13,0.22) 52%, transparent 100%),
  linear-gradient(90deg, rgba(7,10,13,0.95) 0%, rgba(7,10,13,0.82) 26%, rgba(7,10,13,0.45) 62%, rgba(7,10,13,0.1) 100%),
  linear-gradient(0deg, rgba(7,10,13,0.68) 0%, rgba(7,10,13,0.32) 22%, transparent 50%); }
.bmf-app.front .fhome-tx { position: relative; z-index: 2; }

/* HERO — the live-data panel, BARE (no card) over the full-page ThreeTown key-art. The status row
   floats at the top; the live figure + supporting stats stack at the base over the page scrim. */
.bmf-app.front .fhome-hero { position: relative; min-height: 360px; display: flex; flex-direction: column; padding: 24px 18px; }
/* .fhome-tx fills the hero as a flex column so the status row (margin-bottom:auto) floats to the TOP and
   the live figure + stats sink to the BASE — mirroring the Open Skies card's top-banner / base-copy split,
   so the two row-1 tiles align: the Live badge sits level with the presence banner, the figure with the
   headline. (Was inert: .fhome-tx wasn't a flex column, so the whole block dropped to the bottom.) */
.bmf-app.front .fhome-hero .fhome-tx { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
.bmf-app.front .fhome-hero-top { display: flex; align-items: center; gap: 10px; }
.bmf-app.front .fhome-hero-top .badge { flex: 0 0 auto; }
.bmf-app.front .fhome-fresh { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .04em; color: var(--faint); }
.bmf-app.front .fhome-fresh a { color: var(--ember-hi); text-decoration: none; }
.bmf-app.front .fhome-hero-kick { margin: 18px 0 0; max-width: 22ch; }
/* The live figure — the hero number leads, its unit label sits beside it on the baseline. */
.bmf-app.front .fhome-fig { display: flex; align-items: flex-end; gap: 12px; margin-top: 10px; }
.bmf-app.front .fhome-fig b { font-family: var(--mono); font-weight: var(--fw-black); font-size: clamp(52px, 9vw, 104px); line-height: .88; color: #fff; letter-spacing: -0.02em; text-shadow: 0 2px 18px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-fig span { font-size: clamp(15px, 1.8vw, 19px); line-height: 1.1; color: var(--text-subtle); max-width: 7ch; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }
/* Supporting stats — out-of-control (warn), hotspots, area, prep. Equal-width flex cells so they
   distribute evenly and wrap into a tidy 2×2 on a phone — alignment from the layout, no chrome. */
.bmf-app.front .fhome-stats { display: flex; flex-wrap: wrap; gap: 16px 24px; margin-top: 18px; }
.bmf-app.front .fhome-stat { flex: 1 1 0; min-width: 120px; display: flex; flex-direction: column; gap: 4px; }
.bmf-app.front .fhome-stat b { font-family: var(--mono); font-size: var(--fs-xl); font-weight: var(--fw-bold); color: var(--text); line-height: 1; text-shadow: 0 1px 8px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-stat.hot b { color: var(--warn); }
.bmf-app.front .fhome-stat span { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }
.bmf-app.front .fhome-sub { margin-top: 13px; font-size: clamp(14px, 1.5vw, 17px); line-height: 1.5; color: var(--text-subtle); max-width: 40ch; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }

/* OPEN SKIES play tile — key-art backdrop + the same fade. The top overlay banner (profile + live
   presence) and the base copy split top/bottom via space-between, both above the art/fade. */
/* Mobile: a content-sized card with a min-height FLOOR (was a hard 16/10 aspect that capped the box below
   its own content height, so overflow:hidden clipped the banner/CTA and buried the art). The card now grows
   to fit the banner + copy + Fly CTA and the key-art reads. Desktop overrides aspect-ratio:auto in the 880px
   band above; grid align-items:stretch sizes it there. */
.bmf-app.front .fhome-play { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; gap: 18px; cursor: pointer; min-height: 420px; padding: 20px 17px; text-align: left; }
.bmf-app.front .fhome-play:hover { transform: translateY(-2px); }
/* Top overlay banner: profile cluster (left) + live presence chip (right). */
.bmf-app.front .fhome-play-banner { position: relative; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.bmf-app.front .fpb-id { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.bmf-app.front .fpb-cs { font-family: var(--mono); font-weight: var(--fw-black); font-size: var(--fs-lg); letter-spacing: .04em; color: #fff; line-height: 1;
  text-shadow: 0 1px 8px rgba(0,0,0,0.75); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14ch; }
.bmf-app.front .fpb-meta { display: inline-flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.bmf-app.front .fpb-pts { font-size: var(--fs-meta); color: var(--text-subtle); text-shadow: 0 1px 6px rgba(0,0,0,0.8); }
.bmf-app.front .fpb-hint { font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-subtle); text-shadow: 0 1px 6px rgba(0,0,0,0.8); }
/* Live presence chip — frosted pill so it reads over the bright part of the art; a pulsing "live" dot. */
.bmf-app.front .fpb-live { flex: 0 0 auto; display: inline-flex; align-items: baseline; gap: 7px; padding: 6px 10px; border-radius: var(--r-pill);
  background: rgba(7,10,13,0.62); border: 1px solid var(--hair); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .08em; text-transform: uppercase; color: var(--text-subtle); white-space: nowrap; }
.bmf-app.front .fpb-live b { color: #fff; font-weight: var(--fw-bold); font-size: var(--fs-sm); }
.bmf-app.front .fpb-live b:empty { display: none; }
.bmf-app.front .fpb-dot { align-self: center; width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--ok); box-shadow: 0 0 7px var(--ok); animation: fpb-pulse 1.8s ease-in-out infinite; }
@keyframes fpb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .bmf-app.front .fpb-dot { animation: none; } }
.bmf-app.front .fhome-play-tx { display: flex; flex-direction: column; align-items: flex-start; }
.bmf-app.front .fhome-play-ey { font-family: var(--mono); font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-Regular); }
.bmf-app.front .fhome-play-h { margin-top: 10px; font-size: clamp(24px, 3.2vw, 36px); text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-play-sub { margin-top: 11px; font-size: 14px; line-height: 1.45; color: var(--text-subtle); max-width: 60ch; text-align: left; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }
.bmf-app.front .fhome-play-go { margin-top: 18px; pointer-events: none; }

/* Map entry — a tactical "map readout" tile (cool / instrument register, so it opts OUT of the warm
   cardGlow glaze in cardGlow.ts). A FAINT cyan cartographic grid blooms from behind the map icon and
   fades across the card; the grid + icon brighten on hover to make it pop. Every .card carries the
   corner-cut clip-path, which also clips the grid child to the notch (no overflow needed) — and clips
   any OUTER box-shadow, so the "pop" glow lives on the interior icon, not the card. */
.bmf-app.front .fhome-map { position: relative; isolation: isolate; display: flex; align-items: center; gap: 13px; cursor: pointer; text-align: left; width: 100%; padding: 16px 17px; }
.bmf-app.front .fhome-map > :not(.fhome-map-grid):not(.fd-glasstex) { position: relative; z-index: 1; }
.bmf-app.front .fhome-map-grid { position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background:
    repeating-linear-gradient(90deg, var(--accent-fill) 0 1px, transparent 1px 19px),
    repeating-linear-gradient(0deg, var(--accent-fill) 0 1px, transparent 1px 19px);
  -webkit-mask: radial-gradient(150% 150% at 9% 50%, #000 0%, rgba(0,0,0,0.42) 38%, transparent 78%);
  mask: radial-gradient(150% 150% at 9% 50%, #000 0%, rgba(0,0,0,0.42) 38%, transparent 78%);
  opacity: .8; transition: opacity .26s ease; }
.bmf-app.front .fhome-map:hover { transform: translateY(-2px); border-color: var(--accent); }
.bmf-app.front .fhome-map:hover .fhome-map-grid { opacity: 1; }
.bmf-app.front .fhome-map-ic { width: 38px; height: 38px; flex: 0 0 auto; display: grid; place-items: center; border-radius: var(--r-sm); border: 1px solid var(--hair); background: var(--accent-fill); color: var(--accent); transition: box-shadow .26s ease, border-color .26s ease, color .26s ease; }
.bmf-app.front .fhome-map:hover .fhome-map-ic { border-color: var(--accent-soft); color: var(--accent-hi); box-shadow: var(--glow); }
.bmf-app.front .fhome-map-ic svg { width: 20px; height: 20px; }
.bmf-app.front .fhome-map-tx { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.bmf-app.front .fhome-map-tx b { font-size: 14px; font-weight: var(--fw-heavy); color: #fff; }
.bmf-app.front .fhome-map-tx span { font-size: 12.5px; color: var(--dim); }
.bmf-app.front .fhome-map-go { margin-left: auto; color: var(--accent); }
.bmf-app.front .fhome-map-go svg { width: 18px; height: 18px; }

/* BIG shop feature card — the merch poster as the art, our copy + Shop CTA bottom-left over a fade
   (modelled on the play tile, warm register). A floor min-height on mobile; on desktop it stretches to
   the bottom row beside the Field Notes. The fades are art literals (same rgba(7,10,13) base as the
   other key-art fades in this file). */
.bmf-app.front .fhome-merch { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end;
  cursor: pointer; min-height: 280px; padding: 24px 22px; text-align: left; margin-top: 0; }
.bmf-app.front .fhome-merch:hover { transform: translateY(-2px); }
.bmf-app.front .fhome-merch-art { position: absolute; inset: 0; z-index: 0; }
.bmf-app.front .fhome-merch-art img { width: 100%; height: 100%; object-fit: cover; object-position: 64% 16%; display: block; }
.bmf-app.front .fhome-merch-fade { position: absolute; inset: 0; z-index: 1; background:
  linear-gradient(90deg, rgba(7,10,13,0.94) 0%, rgba(7,10,13,0.74) 32%, rgba(7,10,13,0.18) 66%, transparent 100%),
  linear-gradient(0deg, rgba(7,10,13,0.9) 0%, rgba(7,10,13,0.34) 38%, transparent 68%); }
.bmf-app.front .fhome-merch-tx { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: flex-start; }
.bmf-app.front .fhome-merch-ey { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 10.5px;
  letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.bmf-app.front .fhome-merch-ey svg { width: 14px; height: 14px; }
.bmf-app.front .fhome-merch-h { margin-top: 9px; font-size: clamp(26px, 3vw, 40px); text-shadow: 0 2px 14px rgba(0,0,0,0.6); }
.bmf-app.front .fhome-merch-sub { margin-top: 9px; font-size: 14px; line-height: 1.45; color: var(--text-subtle); max-width: 34ch; text-shadow: 0 1px 8px rgba(0,0,0,0.7); }
.bmf-app.front .fhome-merch-go { margin-top: 16px; pointer-events: none; }
/* Prep tile — a compact secondary call-out (one-line promo + ghost button) that links to the full
   readiness checklist on /prepare/. The interactive card is NOT duplicated here; this is just the
   sharp hand-off, so the home stays marketing and Prepare owns the tool. */
.bmf-app.front .fhome-prep { display: flex; flex-direction: column; justify-content: center; gap: 13px; text-decoration: none; color: var(--text); padding: 18px 17px; }
.bmf-app.front .fhome-prep:hover { transform: translateY(-2px); border-color: var(--warm-stroke); }
.bmf-app.front .fhome-prep-tx { display: flex; flex-direction: column; gap: 5px; }
.bmf-app.front .fhome-prep-h { font-size: var(--fs-lg); font-weight: var(--fw-bold); color: #fff; line-height: 1.12; }
.bmf-app.front .fhome-prep-sub { font-size: 13px; line-height: 1.45; color: var(--text-subtle); max-width: 40ch; }
.bmf-app.front .fhome-prep-go { align-self: flex-start; pointer-events: none; }
.bmf-app.front .fhome-notes { display: flex; flex-direction: column; padding: 14px 17px; }
.bmf-app.front .fhome-notes .fd-rail { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; padding-bottom: 4px; scrollbar-width: none; }
.bmf-app.front .fhome-notes .fd-rail::-webkit-scrollbar { display: none; }
.bmf-app.front .fhome-notes .fd-mcard { scroll-snap-align: start; flex: 0 0 78%; max-width: 320px; }
/* Three across the (now half-width) notes column — matching the reference's 3-up Field Notes row.
   Beyond three, the rail still scroll-snaps (harmless). */
@media (min-width: 760px) { .bmf-app.front .fhome-notes .fd-mcard { flex: 0 0 31%; max-width: none; } }

/* Home hero (mobile + desktop): more breathing room above it, and the live data pulled DOWN so it sits close to the
   next card (the play tile) instead of floating high over the art with empty space below. */
.bmf-app.front .fhome-grid { padding-top: 22px; }
.bmf-app.front .fhome-hero .fhome-tx { justify-content: flex-end; }
.bmf-app.front .fhome-hero { padding-bottom: 12px; }

/* ── Desktop VISUAL overrides — placed AFTER the base .fhome-play / .fhome-hero rules above so they win
   on source order (media queries add no specificity). Row 1 (hero + gameplay) is one trim band that
   clears the fold: the play tile drops its portrait 4/5 aspect to a LANDSCAPE card sized to the hero. ── */
@media (min-width: 880px) {
  .bmf-app.front .fhome-play { aspect-ratio: auto; padding: 28px 30px; }
  .bmf-app.front .fhome-play-h { font-size: clamp(38px, 4.2vw, 56px); max-width: 9ch; line-height: .96; }
  .bmf-app.front .fhome-play-sub { max-width: 36ch; }
  .bmf-app.front .fhome-hero { min-height: 360px; padding: 24px 26px 14px; }
  /* The 4 supporting stats spread into ONE row across the wider hero (they still wrap 2×2 on a phone). */
  .bmf-app.front .fhome-hero .fhome-stat { min-width: 0; }
}
`,document.head.appendChild(e)}export{ae as L,ie as S,te as a,ne as b};
