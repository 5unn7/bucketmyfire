import{a,i as s,b as n,c as i,d as r,e as p,D as f,s as h,w as l,O as d,g as c,h as m,n as g,j as b,t as u}from"./frontShell-yt3q_Qq7.js";a();s();n();i();r();p();v();const t=document.getElementById("game");if(t){const e=document.createElement("div");e.className="bmf-app front",e.innerHTML=f+y(),t.innerHTML="",t.appendChild(e),document.getElementById("fd-boot")?.remove(),h(e,13),l(e),e.querySelectorAll("[data-notify-shop]").forEach(o=>o.addEventListener("click",()=>d()))}function y(){return`
${c()}
${m("shop")}
<div class="pad fhome">
  <header class="fshop-hero fd-hero rise">
    <div class="fd-hero-main">
      <p class="fd-hero-eyebrow">BMF Gear · Coming soon</p>
      <h1 class="fd-hero-head">Wear the fight.</h1>
      <p class="fd-hero-sub">Gear built around the fight — for the pilots, the crews, and everyone
        watching the line hold. The first collection is in final prep.</p>
    </div>
  </header>

  <section class="card warm cut fshop-poster rise" aria-label="Wear the fight — the first BMF gear collection, coming soon">
    <div class="fshop-art"><img src="/images/cardsbg/wearthefightbg.webp" alt="Wear the fight — the black BMF hoodie, its back print a helicopter bucket-drop over a burning ridge, floating in a misty boreal forest" /></div>
    <div class="fshop-scrim"></div>
    <div class="fshop-body">
      <span class="fshop-ey">${g("shop")}First collection</span>
      <h2 class="fshop-h">The doors open soon.</h2>
      <p class="fshop-sub">Leave your email and you'll be the first one through — one message when the
        gear drops, nothing else.</p>
      <button class="btn primary fshop-go" type="button" data-notify-shop>Notify me</button>
    </div>
  </section>

  ${b()}
</div>
${u("shop")}`}function v(){if(document.getElementById("fd-shop-css"))return;const e=document.createElement("style");e.id="fd-shop-css",e.textContent=`
.bmf-app.front .fshop-hero { padding: 2px 2px 0; }
/* The key-art poster: a tall landscape stage on desktop, portrait-leaning on phones, copy + CTA
   bottom-left over a directional fade (mirrors the home's merch feature card treatment). */
.bmf-app.front .fshop-poster { position: relative; overflow: hidden; display: flex; flex-direction: column;
  justify-content: flex-end; min-height: min(62dvh, 560px); padding: 0; }
.bmf-app.front .fshop-art { position: absolute; inset: 0; z-index: 0; }
.bmf-app.front .fshop-art img { width: 100%; height: 100%; object-fit: cover; object-position: 64% 38%; display: block; }
.bmf-app.front .fshop-scrim { position: absolute; inset: 0; z-index: 1; background:
  linear-gradient(180deg, rgba(6,9,11,0.04) 0%, rgba(6,9,11,0.35) 48%, rgba(6,9,11,0.9) 100%),
  linear-gradient(100deg, rgba(6,9,11,0.72) 0%, transparent 58%); }
.bmf-app.front .fshop-body { position: relative; z-index: 2; padding: 18px 18px 20px; max-width: 460px; }
.bmf-app.front .fshop-ey { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono);
  font-size: var(--fs-label); letter-spacing: .26em; text-transform: uppercase; color: var(--menu); font-weight: var(--fw-bold); }
.bmf-app.front .fshop-ey svg { width: 15px; height: 15px; }
.bmf-app.front .fshop-h { margin: 9px 0 0; font-size: clamp(26px, 4vw, 38px); font-weight: var(--fw-black);
  line-height: 1.06; letter-spacing: .01em; color: #fff; text-wrap: balance; }
.bmf-app.front .fshop-sub { margin: 9px 0 0; font-size: var(--fs-md); line-height: 1.5; color: var(--text-subtle); text-wrap: pretty; }
.bmf-app.front .fshop-go { margin-top: 15px; min-width: 180px; justify-content: center; }
`,document.head.appendChild(e)}
