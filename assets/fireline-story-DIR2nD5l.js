import{a as h,i as m,b as d,c as v,d as b,e as g,D as u,s as y,w as x,g as w,h as $,q as k,m as r,j as z,t as F}from"./frontShell-yt3q_Qq7.js";import{e as S,E as o}from"./events-DpJ2-MEK.js";const l=S(new URLSearchParams(location.search).get("ev"));l?(h(),m(),d(),v(),b(),g(),T(),C(l)):location.replace("/fireline/");function C(a){const t=document.getElementById("game");if(!t)return;document.title=`${a.year} — ${a.title} · The Fireline · Bucket My Fire`;const e=document.createElement("div");e.className="bmf-app front",e.innerHTML=u+j(a),t.innerHTML="",t.appendChild(e),document.getElementById("fd-boot")?.remove(),y(e,13),x(e)}function E(a){const t=o.findIndex(e=>e.id===a.id);return{prev:o[t-1],next:o[t+1]}}function c(a,t){const e=t==="prev"?"←":"→",s=t==="prev"?"Earlier":"Next";return`
    <a class="hst-nav ${t}" href="/fireline/story/?ev=${a.id}">
      <span class="hst-nav-k">${s} ${e}</span>
      <span class="hst-nav-y">${a.year}</span>
      <span class="hst-nav-t">${r(a.title)}</span>
    </a>`}function j(a){const t=a.tone?` ${a.tone}`:"",{prev:e,next:s}=E(a),i=Math.ceil(a.story.length/2),p=n=>n.map(f=>`<p class="hst-p">${r(f)}</p>`).join("");return`
${w()}
${$("halloffame")}
<div class="pad fhome">
  ${k([{label:"Home",href:"/"},{label:"Fireline",href:"/fireline/"},{label:a.year}])}

  <section class="card cut rise fd-glass hst-hero"><span class="fd-glasstex" aria-hidden="true"></span>
    <div class="fd-hero">
      <div class="fd-hero-main">
        <p class="fd-hero-eyebrow">The Fireline · The full story</p>
        <p class="hst-year">${a.year}</p>
        <h1 class="fd-hero-head hst-head">${r(a.title)}</h1>
        <p class="hst-dateline">${r(a.dateline)}</p>
        <p class="fd-hero-sub hst-lede">${r(a.lede)}</p>
        <div class="hst-badges"><span class="badge${t}">${a.stat}</span></div>
      </div>
    </div>
  </section>

  ${a.art?`<figure class="card cut hst-art"><img src="${a.art}" alt="${r(a.title)}" loading="lazy" /></figure>`:""}

  <section class="card cut hst-story">
    <div class="sec"><span class="tag">The story</span><span class="line"></span></div>
    ${p(a.story.slice(0,i))}
    <p class="hst-pull">${r(a.pull)}</p>
    ${p(a.story.slice(i))}
  </section>

  <section class="card warm cut hst-legacy">
    <div class="sec"><span class="tag">What it left behind</span><span class="line"></span></div>
    <p class="hst-legacy-p">${r(a.legacy)}</p>
    <div class="hst-facts">
      ${a.facts.map(n=>`<div class="hst-fact"><b>${r(n.value)}</b><span>${r(n.label)}</span></div>`).join("")}
    </div>
  </section>

  <nav class="hst-navrow" aria-label="More moments">
    ${e?c(e,"prev"):'<span class="hst-nav ghost" aria-hidden="true"></span>'}
    ${s?c(s,"next"):'<span class="hst-nav ghost" aria-hidden="true"></span>'}
  </nav>

  <p class="hof-sources">Drawn from the public record:
    <a href="https://natural-resources.canada.ca/" target="_blank" rel="noopener">Natural Resources Canada</a>,
    <a href="https://ciffc.ca/" target="_blank" rel="noopener">CIFFC</a>,
    <a href="https://parks.canada.ca/" target="_blank" rel="noopener">Parks Canada</a>,
    <a href="https://www2.gov.bc.ca/" target="_blank" rel="noopener">the Government of B.C.</a>,
    <a href="https://www.publicsafety.gc.ca/" target="_blank" rel="noopener">Public Safety Canada</a> and
    <a href="https://www.cbc.ca/" target="_blank" rel="noopener">CBC News</a> archives.
    Figures stay conservative where sources vary; nothing here is invented.</p>

  ${z()}
</div>
${F("halloffame")}`}function T(){if(document.getElementById("fd-hofstory-css"))return;const a=document.createElement("style");a.id="fd-hofstory-css",a.textContent=`
/* Hero — year as a big cockpit numeral over the title; dateline in instrument mono. */
.bmf-app.front .hst-hero { margin-top: 6px; }
.bmf-app.front .hst-year { margin: 6px 0 0; font-family: var(--mono); font-weight: var(--fw-black);
  font-size: var(--fs-hero); line-height: 1; color: var(--ember-hi); letter-spacing: .02em; }
.bmf-app.front .hst-head { margin-top: 6px; }
.bmf-app.front .hst-dateline { margin: 8px 0 0; font-family: var(--mono); font-size: var(--fs-micro);
  letter-spacing: .14em; text-transform: uppercase; color: var(--menu); }
.bmf-app.front .hst-lede { margin-top: 10px; }
.bmf-app.front .hst-badges { margin-top: 12px; }

/* Optional hero art — an ultrawide strip in its own card frame (kept short on every viewport). */
.bmf-app.front .hst-art { padding: 0; overflow: hidden; margin: 0; }
.bmf-app.front .hst-art img { display: block; width: 100%; aspect-ratio: 21 / 9; object-fit: cover; }

/* The story — a real reading column. The pull keyline sits on an ember spine mid-story. */
.bmf-app.front .hst-story .hst-p { margin: 12px 0 0; font-size: var(--fs-md); line-height: 1.72;
  color: var(--text-subtle); max-width: 66ch; }
.bmf-app.front .hst-story .hst-p:first-of-type { color: var(--text); }
.bmf-app.front .hst-pull { margin: 18px 0 6px; padding: 4px 0 4px 16px; border-left: 2px solid var(--ember-hi);
  font-size: var(--fs-lg); font-weight: var(--fw-bold); line-height: 1.4; color: #fff; max-width: 30ch;
  text-wrap: balance; }

/* Legacy — warm register close + three instrument chips. */
.bmf-app.front .hst-legacy-p { margin: 2px 0 0; font-size: var(--fs-md); line-height: 1.6; color: var(--text); max-width: 60ch; }
.bmf-app.front .hst-facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 14px; }
.bmf-app.front .hst-fact { background: var(--bezel); border: 1px solid var(--hair); border-radius: var(--r-sm);
  padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.bmf-app.front .hst-fact b { font-family: var(--mono); font-weight: var(--fw-black); font-size: var(--fs-title);
  color: var(--ember-hi); line-height: 1.05; }
.bmf-app.front .hst-fact span { font-size: var(--fs-micro); line-height: 1.35; color: var(--dim); }

/* Prev / next — two quiet instrument cards continuing the journey. */
.bmf-app.front .hst-navrow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.bmf-app.front .hst-nav { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; text-decoration: none;
  background: var(--bezel); border: 1px solid var(--hair); border-radius: var(--r-md); transition: border-color .2s ease; }
.bmf-app.front .hst-nav:hover { border-color: var(--warm-stroke); }
.bmf-app.front .hst-nav.next { text-align: right; align-items: flex-end; }
.bmf-app.front .hst-nav.ghost { visibility: hidden; }
.bmf-app.front .hst-nav-k { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .12em;
  text-transform: uppercase; color: var(--menu); }
.bmf-app.front .hst-nav-y { font-family: var(--mono); font-weight: var(--fw-black); font-size: var(--fs-lg); color: var(--ember-hi); }
.bmf-app.front .hst-nav-t { font-size: var(--fs-sm); color: var(--text-subtle); line-height: 1.3; }

/* Sources small print (same voice as the roll). */
.bmf-app.front .hof-sources { margin: 2px 0 0; font-family: var(--mono); font-size: var(--fs-micro);
  letter-spacing: .03em; line-height: 1.7; color: var(--faint); max-width: 72ch; }
.bmf-app.front .hof-sources a { color: var(--dim); text-decoration: none; }
.bmf-app.front .hof-sources a:hover { color: var(--ember-hi); }

/* Desktop — wider prose measure, roomier cards (END of sheet: media queries add no specificity). */
@media (min-width: 880px) {
  .bmf-app.front .hst-art img { aspect-ratio: 3.4 / 1; }
  .bmf-app.front .hst-story { padding: 26px 30px 28px; }
  .bmf-app.front .hst-story .hst-p { font-size: var(--fs-lg); }
  .bmf-app.front .hst-pull { font-size: var(--fs-xl); }
  .bmf-app.front .hst-legacy { padding: 24px 26px; }
}
@media (max-width: 560px) {
  .bmf-app.front .hst-facts { grid-template-columns: 1fr; }
}
`,document.head.appendChild(a)}
