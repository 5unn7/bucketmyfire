import{a as h,i as u,b as y,c as v,d as g,e as b,f as k,D as w,s as S,w as x,g as E,h as M,j,t as z,M as d,o as C,H as F,k as L,l as H}from"./frontShell-98g2TKKh.js";import{i as $,p as n,w as p}from"./flyPicker-oZv8ZpAG.js";h();u();y();v();g();b();$();P();let r=k(d).id;const c=document.getElementById("game");if(c){const e=document.createElement("div");e.className="bmf-app front",e.innerHTML=w+I(),c.innerHTML="",c.appendChild(e),document.getElementById("fd-boot")?.remove(),S(e,13),x(e),l(e)}function I(){return`
${E()}
${M("campaign")}
<div class="pad fhome">
  <header class="fcamp-hero fd-hero rise">
    <div class="fd-hero-main">
      <p class="fd-hero-eyebrow">Campaign · Solo</p>
      <h1 class="fd-hero-head">Fly solo.</h1>
      <p class="fd-hero-sub">Pick your ground and your aircraft, then fly a private round — just you, the fire, and the towns to hold.</p>
    </div>
  </header>

  <section class="fcamp-wizard" id="fd-wizard"></section>

  ${j()}
</div>
${z("campaign")}`}function l(e){const o=e.querySelector("#fd-wizard");if(!o)return;const s=d.map(a=>a.available?n(a,'<span class="badge fire">Fly here</span>',{pick:a.id}):n(a,'<span class="badge locked">Soon</span>',{locked:!0})).join("");o.innerHTML=`<div class="fcamp-whead"><h2>Choose your ground</h2></div><div class="fly-strip">${s}</div><div class="fly-dots" aria-hidden="true"></div>`,o.querySelectorAll("[data-pick]").forEach(a=>a.addEventListener("click",()=>{r=a.dataset.pick||r,A(e),window.scrollTo({top:0,behavior:"smooth"})})),o.querySelectorAll("[data-notify-map]").forEach(a=>a.addEventListener("click",i=>{i.stopPropagation(),C(a.dataset.notifyMap)})),p(o)}function A(e){const o=e.querySelector("#fd-wizard");if(!o)return;const s=0,a=F.map(t=>{const f=L(t,s),m=`/?province=1&region=${encodeURIComponent(r)}&solo=1&heli=${encodeURIComponent(t.id)}`;return f?n(t,'<span class="badge ok">Ready</span>',{href:m}):n(t,'<span class="badge locked">Locked</span>',{locked:!0})}).join(""),i=d.find(t=>t.id===r)?.name??"";o.innerHTML=`<div class="fcamp-whead"><button class="fcamp-back" id="fd-back">← Maps</button><h2>Choose your aircraft</h2><span class="fcamp-step">${H(i)}</span></div><div class="fly-strip">${a}</div><div class="fly-dots" aria-hidden="true"></div><p class="fcamp-note">Locked aircraft unlock with career points earned in Open Skies and solo flights.</p>`,o.querySelector("#fd-back")?.addEventListener("click",()=>{l(e),window.scrollTo({top:0,behavior:"smooth"})}),p(o)}function P(){if(document.getElementById("fd-camp-css"))return;const e=document.createElement("style");e.id="fd-camp-css",e.textContent=`
.bmf-app.front .fcamp-hero { padding: 2px 2px 0; }
.bmf-app.front .fcamp-wizard { display: flex; flex-direction: column; gap: 16px; }
.bmf-app.front .fcamp-whead { display: flex; align-items: center; gap: 10px 12px; flex-wrap: wrap; }
/* Caption-style step header (mirrors .fd-sec-tag): a compact mono kicker, not a display heading — so
   the pick cards ride higher up the screen and their full detail clears the fold without scrolling. */
.bmf-app.front .fcamp-whead h2 { font-family: var(--mono); font-size: var(--fs-sm); font-weight: var(--fw-bold);
  letter-spacing: .2em; text-transform: uppercase; color: var(--menu); }
.bmf-app.front .fcamp-step { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); margin-left: auto; }
.bmf-app.front .fcamp-back { appearance: none; background: none; border: 0; padding: 0 4px 0 0; cursor: pointer; font: inherit;
  font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .06em; text-transform: uppercase; color: var(--ember-hi); min-height: 36px; display: inline-flex; align-items: center; }
.bmf-app.front .fcamp-back:hover { color: var(--menu); }
.bmf-app.front .fcamp-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }
`,document.head.appendChild(e)}
