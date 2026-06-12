import{a as d,i as f,b as h,c as k,d as m,e as u,D as b,s as v,w as y,g,h as S,j as E,B as H,k as L,H as r,l as j,n as w,p as x}from"./frontShell-yt3q_Qq7.js";import{i as F,p as c,w as $}from"./flyPicker-MRA6tNga.js";d();f();h();k();m();u();F();I();const i=document.getElementById("game");if(i){const e=document.createElement("div");e.className="bmf-app front",e.innerHTML=b+C(),i.innerHTML="",i.appendChild(e),document.getElementById("fd-boot")?.remove(),v(e,13),y(e),l(e)}function C(){return`
${g()}
${S("open-skies")}
<div class="pad fhome">
  <header class="osk-hero fd-hero rise">
    <div class="fd-hero-main">
      <p class="fd-hero-eyebrow">Open Skies · Live</p>
      <h1 class="fd-hero-head">Everyone flies the same fire.</h1>
      <p class="fd-hero-sub">One live province, every pilot in it. Dispatch calls as fires break out. Get to each one before it reaches the towns.</p>
    </div>
    <div class="fd-hero-trail"><span class="badge ok">Live</span></div>
  </header>

  <section class="osk-pick" id="fd-picker"></section>

  ${E()}
</div>
${H("open-skies")}`}function l(e){const a=e.querySelector("#fd-picker");if(!a)return;const o=L(),p=r.map(s=>{const n=j(s),t=`/?province=1&heli=${encodeURIComponent(s.id)}`;return n?c(s,'<span class="badge ok">Ready</span>',{href:t}):c(s,'<span class="badge locked">Locked</span>',{locked:!0,wallet:o})}).join("");a.innerHTML=`<div class="sec"><span class="tag">Your aircraft</span><span class="line"></span><span class="pts-bal">${w("spark")}<b>${o.toLocaleString()}</b><span>pts</span></span></div><div class="fly-strip">${p}</div><div class="fly-dots" aria-hidden="true"></div><p class="osk-note">Locked aircraft unlock with career points earned in Open Skies and solo flights — earn enough and unlock them right here.</p>`,a.querySelectorAll("[data-buy-heli]").forEach(s=>s.addEventListener("click",()=>{const n=r.find(t=>t.id===s.dataset.buyHeli);n&&x(n).ok&&l(e)})),$(a)}function I(){if(document.getElementById("fd-osk-css"))return;const e=document.createElement("style");e.id="fd-osk-css",e.textContent=`
.bmf-app.front .osk-hero { padding: 2px 2px 0; }
.bmf-app.front .osk-hero .fd-hero-trail { align-self: flex-start; }
.bmf-app.front .osk-pick { display: flex; flex-direction: column; gap: 14px; }
.bmf-app.front .osk-pick .sec { margin: 0; }
.bmf-app.front .osk-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }
`,document.head.appendChild(e)}
