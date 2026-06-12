import{a as s,i,b as f,c as p,d as h,e as l,D as d,s as c,w as m,g as b,h as u,j as g,t as v}from"./frontShell-yt3q_Qq7.js";import{E as x}from"./events-DpJ2-MEK.js";s();i();f();p();h();l();T();function w(){const e=document.getElementById("game");if(!e)return;const t=document.createElement("div");t.className="bmf-app front",t.innerHTML=d+E(),e.innerHTML="",e.appendChild(t),document.getElementById("fd-boot")?.remove(),c(t,13),m(t),S(t)}const y='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>';function k(e){const t=e.tone?` ${e.tone}`:"",r=e.art?`<span class="hof-art" aria-hidden="true"><img src="${e.art}" alt="" loading="lazy" decoding="async" /></span>`:"";return`
    <li class="hof-ev">
      <span class="hof-dot" aria-hidden="true"></span>
      <a class="hof-card${e.art?" has-art":""}" href="/fireline/story/?ev=${e.id}">${r}
        <div class="hof-head"><span class="hof-year">${e.year}</span><span class="badge${t}">${e.stat}</span></div>
        <h3 class="hof-title">${e.title}</h3>
        <p class="hof-body">${e.body}</p>
        <span class="hof-more">Read the full story <span aria-hidden="true">→</span></span>
      </a>
    </li>`}function E(){return`
${b()}
${u("halloffame")}
<div class="pad fhome">
  <section class="card cut rise fd-glass hof-hero"><span class="fd-glasstex" aria-hidden="true"></span>
    <div class="fd-hero">
      <div class="fd-hero-lead hof-mark" aria-hidden="true">${y}</div>
      <div class="fd-hero-main">
        <p class="fd-hero-eyebrow">The Fireline</p>
        <h1 class="fd-hero-head">The unsung warriors.</h1>
        <p class="fd-hero-sub">Canada's wildfire story, told through the people who answered it — the crews on the
          ground, the pilots overhead, the lookouts and dispatchers behind every save.</p>
      </div>
    </div>
  </section>

  <section class="card warm cut hof-trib">
    <div class="sec"><span class="tag">To the crews</span><span class="line"></span></div>
    <p class="hof-trib-h">Thank you to every wildland firefighter, pilot, lookout and dispatcher — past and present.</p>
    <p class="hof-trib-sub">The fires keep coming. The line holds because people hold it.</p>
  </section>

  <section class="card cut hof-tl">
    <div class="sec"><span class="tag">The moments</span><span class="line"></span></div>
    <ol class="hof-list">${x.map(k).join("")}</ol>
  </section>

  <p class="hof-sources">Drawn from the public record:
    <a href="https://natural-resources.canada.ca/" target="_blank" rel="noopener">Natural Resources Canada</a>,
    <a href="https://ciffc.ca/" target="_blank" rel="noopener">CIFFC</a>,
    <a href="https://www2.gov.bc.ca/" target="_blank" rel="noopener">the Government of B.C.</a>,
    <a href="https://www.publicsafety.gc.ca/" target="_blank" rel="noopener">Public Safety Canada</a> and
    <a href="https://www.cbc.ca/" target="_blank" rel="noopener">CBC News</a> archives.</p>

  ${g()}
</div>
${v("halloffame")}`}function S(e){const t=e.querySelector(".hof-list");if(!t||matchMedia("(prefers-reduced-motion: reduce)").matches||document.documentElement.classList.contains("fd-reduce-motion")||typeof IntersectionObserver>"u")return;t.classList.add("hof-anim");const n=new IntersectionObserver(a=>{for(const o of a)o.isIntersecting&&(o.target.classList.add("hof-in"),n.unobserve(o.target))},{rootMargin:"0px 0px -8% 0px",threshold:.12});t.querySelectorAll(".hof-ev").forEach(a=>n.observe(a))}function T(){if(document.getElementById("fd-hof-css"))return;const e=document.createElement("style");e.id="fd-hof-css",e.textContent=`
/* Hero — the fd-hero anatomy inside a brand card; the lead mark is the same Lucide award the nav tab
   wears, boxed like the home map tile's icon (warm register: this page honours the fight). */
.bmf-app.front .hof-hero { margin-top: 18px; }
.bmf-app.front .hof-mark { width: 46px; height: 46px; border-radius: var(--r-sm); border: 1px solid var(--warm-stroke);
  background: var(--ember-12); color: var(--ember-hi); align-self: flex-start; }
.bmf-app.front .hof-mark svg { width: 24px; height: 24px; }

/* The timeline — an ember SPINE down the left with diamond markers (the brand's rank-diamond motif),
   each moment a recessed instrument panel beside it. The spine fades out past the last entry. */
.bmf-app.front .hof-list { list-style: none; margin: 0; padding: 0; position: relative;
  display: flex; flex-direction: column; gap: 16px; }
.bmf-app.front .hof-list::before { content: ""; position: absolute; left: 7px; top: 8px; bottom: 0; width: 2px;
  background: linear-gradient(180deg, var(--ember-50) 0%, var(--ember-30) 64%, transparent 100%); }
.bmf-app.front .hof-ev { position: relative; padding-left: 30px; }
.bmf-app.front .hof-dot { position: absolute; left: 4px; top: 22px; width: 9px; height: 9px;
  transform: rotate(45deg); background: var(--ember-hi); box-shadow: 0 0 9px var(--ember-50); }
.bmf-app.front .hof-card { display: block; text-decoration: none; color: inherit;
  background: var(--bezel); border: 1px solid var(--hair); border-radius: var(--r-md);
  padding: 14px 15px 15px; transition: border-color .2s ease; }
.bmf-app.front .hof-ev:hover .hof-card { border-color: var(--warm-stroke); }

/* Event art — a clean ULTRAWIDE strip leading the card, full-bleed to the card frame (negative
   margins match the card padding), hairline-separated from the text below. Never under the text. */
.bmf-app.front .hof-card.has-art { overflow: hidden; }
.bmf-app.front .hof-art { display: block; margin: -14px -15px 13px; border-bottom: 1px solid var(--hair); }
.bmf-app.front .hof-art img { display: block; width: 100%; aspect-ratio: 21 / 9; object-fit: cover; }
.bmf-app.front .hof-ev:hover .hof-art img { filter: saturate(1.1); }
.bmf-app.front .hof-more { display: inline-block; margin-top: 10px; font-family: var(--mono);
  font-size: var(--fs-micro); font-weight: var(--fw-bold); letter-spacing: .1em; text-transform: uppercase;
  color: var(--menu); transition: color .2s ease; }
.bmf-app.front .hof-ev:hover .hof-more { color: var(--ember-hi); }
.bmf-app.front .hof-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.bmf-app.front .hof-year { font-family: var(--mono); font-weight: var(--fw-black); font-size: var(--fs-title);
  color: var(--ember-hi); letter-spacing: .02em; line-height: 1; }
.bmf-app.front .hof-head .badge { flex: 0 0 auto; }
.bmf-app.front .hof-title { margin: 8px 0 0; font-size: var(--fs-lg); font-weight: var(--fw-bold); color: #fff; line-height: 1.18; }
.bmf-app.front .hof-body { margin: 7px 0 0; font-size: var(--fs-sm); line-height: 1.55; color: var(--text-subtle); max-width: 62ch; }

/* Scroll reveal — the hidden state exists ONLY once JS arms .hof-anim, so no-JS and reduced-motion
   readers get the full roll immediately. Transform+opacity only (no layout). */
.bmf-app.front .hof-anim .hof-ev { opacity: 0; transform: translateY(14px);
  transition: opacity .5s ease, transform .5s ease; }
.bmf-app.front .hof-anim .hof-ev.hof-in { opacity: 1; transform: none; }

/* Closing tribute — warm register, the salute then the hand-off into the fight. */
.bmf-app.front .hof-trib-h { margin: 2px 0 0; font-size: var(--fs-xl); font-weight: var(--fw-bold); color: #fff;
  line-height: 1.25; max-width: 30ch; text-wrap: balance; }
.bmf-app.front .hof-trib-sub { margin: 9px 0 0; font-size: var(--fs-md); line-height: 1.5; color: var(--text-subtle); max-width: 44ch; }

/* Sources — small print, dim; the honesty line under the whole roll. */
.bmf-app.front .hof-sources { margin: 2px 0 0; font-family: var(--mono); font-size: var(--fs-micro);
  letter-spacing: .03em; line-height: 1.7; color: var(--faint); max-width: 72ch; }
.bmf-app.front .hof-sources a { color: var(--dim); text-decoration: none; }
.bmf-app.front .hof-sources a:hover { color: var(--ember-hi); }

/* ── Desktop refinements — placed at the END so they win on source order (media queries add no
   specificity; the known front-door cascade gotcha). The spine moves to the CENTRE and the moments
   alternate left/right of it, reading as a true journey down the page. ── */
@media (min-width: 880px) {
  .bmf-app.front .hof-list { gap: 20px; }
  .bmf-app.front .hof-list::before { left: 50%; margin-left: -1px; }
  .bmf-app.front .hof-ev { width: calc(50% - 30px); padding-left: 0; }
  .bmf-app.front .hof-ev:nth-child(even) { margin-left: auto; }
  .bmf-app.front .hof-dot { top: 24px; }
  .bmf-app.front .hof-ev:nth-child(odd) .hof-dot { left: auto; right: -34px; }
  .bmf-app.front .hof-ev:nth-child(even) .hof-dot { left: -34px; }
  .bmf-app.front .hof-card { padding: 16px 18px 17px; }
  .bmf-app.front .hof-art { margin: -16px -18px 14px; }
  .bmf-app.front .hof-art img { aspect-ratio: 3.4 / 1; }
  .bmf-app.front .hof-trib { padding: 24px 26px; }
}
`,document.head.appendChild(e)}w();
