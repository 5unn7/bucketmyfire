import{a as p,i as d,b as l,c as f,d as m,e as k,D as h,s as u,w as v,g as b,h as y,j as g,z as S,H as j,k as E}from"./frontShell-DTpLDy58.js";import{i as H,p as o,w}from"./flyPicker-DaC7NldZ.js";p();d();l();f();m();k();H();L();const a=document.getElementById("game");if(a){const e=document.createElement("div");e.className="bmf-app front",e.innerHTML=h+x(),a.innerHTML="",a.appendChild(e),document.getElementById("fd-boot")?.remove(),u(e,13),v(e),F(e)}function x(){return`
${b()}
${y("open-skies")}
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

  ${g()}
</div>
${S("open-skies")}`}function F(e){const n=e.querySelector("#fd-picker");if(!n)return;const t=0,i=j.map(s=>{const r=E(s,t),c=`/?province=1&heli=${encodeURIComponent(s.id)}`;return r?o(s,'<span class="badge ok">Ready</span>',{href:c}):o(s,'<span class="badge locked">Locked</span>',{locked:!0})}).join("");n.innerHTML=`<div class="sec"><span class="tag">Your aircraft</span><span class="line"></span></div><div class="fly-strip">${i}</div><div class="fly-dots" aria-hidden="true"></div><p class="osk-note">Locked aircraft unlock with career points earned in Open Skies and solo flights.</p>`,w(n)}function L(){if(document.getElementById("fd-osk-css"))return;const e=document.createElement("style");e.id="fd-osk-css",e.textContent=`
.bmf-app.front .osk-hero { padding: 2px 2px 0; }
.bmf-app.front .osk-hero .fd-hero-trail { align-self: flex-start; }
.bmf-app.front .osk-pick { display: flex; flex-direction: column; gap: 14px; }
.bmf-app.front .osk-pick .sec { margin: 0; }
.bmf-app.front .osk-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }
`,document.head.appendChild(e)}
