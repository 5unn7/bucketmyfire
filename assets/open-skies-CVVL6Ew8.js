import{a as p,i as d,b as l,c as f,d as m,e as k,D as h,s as u,w as v,g as b,h as y,j as g,x as S,H as x,k as j}from"./frontShell-Sy5hzW8x.js";import{i as w,p as o,w as E}from"./flyPicker-CdJt1YqK.js";p();d();l();f();m();k();w();L();const a=document.getElementById("game");if(a){const e=document.createElement("div");e.className="bmf-app front",e.innerHTML=h+H(),a.innerHTML="",a.appendChild(e),document.getElementById("fd-boot")?.remove(),u(e,13),v(e),F(e)}function H(){return`
${b()}
${y("open-skies")}
<div class="pad fhome">
  <section class="card warm cut osk-hero rise">
    <div class="fd-hero">
      <div class="fd-hero-main">
        <p class="fd-hero-eyebrow">Open Skies · Live</p>
        <h1 class="fd-hero-head">Everyone flies the same fire.</h1>
        <p class="fd-hero-sub">One live province, every pilot in it. Dispatch calls as fires break out. Get to each one before it reaches the towns.</p>
      </div>
      <div class="fd-hero-trail"><span class="badge ok">Live</span></div>
    </div>
  </section>

  <section class="osk-pick" id="fd-picker"></section>

  ${g()}
</div>
${S("open-skies")}`}function F(e){const n=e.querySelector("#fd-picker");if(!n)return;const t=0,i=x.map(s=>{const r=j(s,t),c=`/?province=1&heli=${encodeURIComponent(s.id)}`;return r?o(s,'<span class="badge ok">Ready</span>',{href:c}):o(s,'<span class="badge locked">Locked</span>',{locked:!0})}).join("");n.innerHTML=`<div class="sec"><span class="tag">Your aircraft</span><span class="line"></span></div><div class="fly-strip">${i}</div><div class="fly-dots" aria-hidden="true"></div><p class="osk-note">Locked aircraft unlock with career points earned in Open Skies and solo flights.</p>`,E(n)}function L(){if(document.getElementById("fd-osk-css"))return;const e=document.createElement("style");e.id="fd-osk-css",e.textContent=`
.bmf-app.front .osk-hero { padding: 22px 22px 24px; }
.bmf-app.front .osk-hero .fd-hero-trail { align-self: flex-start; }
.bmf-app.front .osk-pick { display: flex; flex-direction: column; gap: 14px; }
.bmf-app.front .osk-pick .sec { margin: 0; }
.bmf-app.front .osk-note { margin-top: 4px; font-size: var(--fs-sm); line-height: 1.5; color: var(--faint); }
`,document.head.appendChild(e)}
