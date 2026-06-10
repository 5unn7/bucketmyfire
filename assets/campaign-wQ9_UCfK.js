import{a as u,i as h,b as v,c as b,d as y,e as g,f as k,D as w,s as S,w as x,g as j,h as z,j as E,t as M,M as c,H as C,k as F}from"./frontShell-Sy5hzW8x.js";import{i as H,p as t,w as p}from"./flyPicker-CdJt1YqK.js";u();h();v();b();y();g();H();T();function L(e){return e.replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]??a)}let r=k(c).id;const i=document.getElementById("game");if(i){const e=document.createElement("div");e.className="bmf-app front",e.innerHTML=w+$(),i.innerHTML="",i.appendChild(e),document.getElementById("fd-boot")?.remove(),S(e,13),x(e),d(e)}function $(){return`
${j()}
${z("campaign")}
<div class="pad fhome">
  <section class="card warm cut fcamp-hero rise">
    <div class="fd-hero">
      <div class="fd-hero-main">
        <p class="fd-hero-eyebrow">Campaign · Solo</p>
        <h1 class="fd-hero-head">Fly solo.</h1>
        <p class="fd-hero-sub">Pick your ground and your aircraft, then fly a private round — just you, the fire, and the towns to hold.</p>
      </div>
    </div>
  </section>

  <section class="fcamp-wizard" id="fd-wizard"></section>

  ${E()}
</div>
${M("campaign")}`}function d(e){const a=e.querySelector("#fd-wizard");if(!a)return;const s=c.map(n=>n.available?t(n,'<span class="badge fire">Fly here</span>',{pick:n.id}):t(n,'<span class="badge locked">Soon</span>',{locked:!0})).join("");a.innerHTML=`<div class="fcamp-whead"><h2>Choose your ground</h2><span class="fcamp-step">Step 1 of 2</span></div><div class="fly-strip">${s}</div><div class="fly-dots" aria-hidden="true"></div>`,a.querySelectorAll("[data-pick]").forEach(n=>n.addEventListener("click",()=>{r=n.dataset.pick||r,I(e),window.scrollTo({top:0,behavior:"smooth"})})),p(a)}function I(e){const a=e.querySelector("#fd-wizard");if(!a)return;const s=0,n=C.map(o=>{const f=F(o,s),m=`/?province=1&region=${encodeURIComponent(r)}&solo=1&heli=${encodeURIComponent(o.id)}`;return f?t(o,'<span class="badge ok">Ready</span>',{href:m}):t(o,'<span class="badge locked">Locked</span>',{locked:!0})}).join(""),l=c.find(o=>o.id===r)?.name??"";a.innerHTML=`<div class="fcamp-whead"><button class="fcamp-back" id="fd-back">← Maps</button><h2>Choose your aircraft</h2><span class="fcamp-step">${L(l)} · Step 2 of 2</span></div><div class="fly-strip">${n}</div><div class="fly-dots" aria-hidden="true"></div><p class="fcamp-note">Locked aircraft unlock with career points earned in Open Skies and solo flights.</p>`,a.querySelector("#fd-back")?.addEventListener("click",()=>{d(e),window.scrollTo({top:0,behavior:"smooth"})}),p(a)}function T(){if(document.getElementById("fd-camp-css"))return;const e=document.createElement("style");e.id="fd-camp-css",e.textContent=`
.bmf-app.front .fcamp-hero { padding: 22px 22px 24px; }
.bmf-app.front .fcamp-wizard { display: flex; flex-direction: column; gap: 16px; }
.bmf-app.front .fcamp-whead { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.bmf-app.front .fcamp-whead h2 { font-size: clamp(20px, 2.4vw, 25px); color: #fff; }
.bmf-app.front .fcamp-step { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin-left: auto; }
.bmf-app.front .fcamp-back { appearance: none; background: none; border: 0; padding: 0 4px 0 0; cursor: pointer; font: inherit;
  font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .06em; text-transform: uppercase; color: var(--ember-hi); min-height: 36px; display: inline-flex; align-items: center; }
.bmf-app.front .fcamp-back:hover { color: var(--menu); }
.bmf-app.front .fcamp-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }
`,document.head.appendChild(e)}
