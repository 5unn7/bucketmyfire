import{a as y,i as g,b,c as v,d as k,e as w,f as S,D as x,s as E,w as L,g as M,h as j,j as z,t as C,M as l,o as H,k as $,H as f,l as F,m as A,n as I,p as P}from"./frontShell-yt3q_Qq7.js";import{i as T,p as s,w as m}from"./flyPicker-MRA6tNga.js";y();g();b();v();k();w();T();B();let i=S(l).id;const p=document.getElementById("game");if(p){const e=document.createElement("div");e.className="bmf-app front",e.innerHTML=x+q(),p.innerHTML="",p.appendChild(e),document.getElementById("fd-boot")?.remove(),E(e,13),L(e),h(e)}function q(){return`
${M()}
${j("campaign")}
<div class="pad fhome">
  <header class="fcamp-hero fd-hero rise">
    <div class="fd-hero-main">
      <p class="fd-hero-eyebrow">Campaign · Solo</p>
      <h1 class="fd-hero-head">Fly solo.</h1>
      <p class="fd-hero-sub">Pick your ground and your aircraft, then fly a private round — just you, the fire, and the towns to hold.</p>
    </div>
  </header>

  <section class="fcamp-wizard" id="fd-wizard"></section>

  ${z()}
</div>
${C("campaign")}`}function h(e){const t=e.querySelector("#fd-wizard");if(!t)return;const o=l.map(a=>a.available?s(a,'<span class="badge fire">Fly here</span>',{pick:a.id}):s(a,'<span class="badge locked">Soon</span>',{locked:!0})).join("");t.innerHTML=`<div class="fcamp-whead"><h2>Choose your ground</h2></div><div class="fly-strip">${o}</div><div class="fly-dots" aria-hidden="true"></div>`,t.querySelectorAll("[data-pick]").forEach(a=>a.addEventListener("click",()=>{i=a.dataset.pick||i,u(e),window.scrollTo({top:0,behavior:"smooth"})})),t.querySelectorAll("[data-notify-map]").forEach(a=>a.addEventListener("click",c=>{c.stopPropagation(),H(a.dataset.notifyMap)})),m(t)}function u(e){const t=e.querySelector("#fd-wizard");if(!t)return;const o=$(),a=f.map(n=>{const r=F(n),d=`/?province=1&region=${encodeURIComponent(i)}&solo=1&heli=${encodeURIComponent(n.id)}`;return r?s(n,'<span class="badge ok">Ready</span>',{href:d}):s(n,'<span class="badge locked">Locked</span>',{locked:!0,wallet:o})}).join(""),c=l.find(n=>n.id===i)?.name??"";t.innerHTML=`<div class="fcamp-whead"><button class="fcamp-back" id="fd-back">← Maps</button><h2>Choose your aircraft</h2><span class="fcamp-step">${A(c)}</span><span class="pts-bal">${I("spark")}<b>${o.toLocaleString()}</b><span>pts</span></span></div><div class="fly-strip">${a}</div><div class="fly-dots" aria-hidden="true"></div><p class="fcamp-note">Locked aircraft unlock with career points earned in Open Skies and solo flights — earn enough and unlock them right here.</p>`,t.querySelector("#fd-back")?.addEventListener("click",()=>{h(e),window.scrollTo({top:0,behavior:"smooth"})}),t.querySelectorAll("[data-buy-heli]").forEach(n=>n.addEventListener("click",()=>{const r=f.find(d=>d.id===n.dataset.buyHeli);r&&P(r).ok&&u(e)})),m(t)}function B(){if(document.getElementById("fd-camp-css"))return;const e=document.createElement("style");e.id="fd-camp-css",e.textContent=`
.bmf-app.front .fcamp-hero { padding: 2px 2px 0; }
.bmf-app.front .fcamp-wizard { display: flex; flex-direction: column; gap: 16px; }
.bmf-app.front .fcamp-whead { display: flex; align-items: center; gap: 10px 12px; flex-wrap: wrap; }
/* Caption-style step header (mirrors .fd-sec-tag): a compact mono kicker, not a display heading — so
   the pick cards ride higher up the screen and their full detail clears the fold without scrolling. */
.bmf-app.front .fcamp-whead h2 { font-family: var(--mono); font-size: var(--fs-sm); font-weight: var(--fw-bold);
  letter-spacing: .2em; text-transform: uppercase; color: var(--menu); }
/* The step name rides inline after the heading; the .pts-bal balance chip (margin-left:auto from the
   home styles) anchors the row's right edge — don't double up the auto margin or the space splits. */
.bmf-app.front .fcamp-step { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
.bmf-app.front .fcamp-back { appearance: none; background: none; border: 0; padding: 0 4px 0 0; cursor: pointer; font: inherit;
  font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .06em; text-transform: uppercase; color: var(--ember-hi); min-height: 36px; display: inline-flex; align-items: center; }
.bmf-app.front .fcamp-back:hover { color: var(--menu); }
.bmf-app.front .fcamp-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }
`,document.head.appendChild(e)}
