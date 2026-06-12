import{a as n,i as s,b as i,c as h,d as l,e as f,D as d,s as p,w as c,g as m,h as b,j as u,t as g}from"./frontShell-98g2TKKh.js";n();s();i();h();l();f();T();function w(){const e=document.getElementById("game");if(!e)return;const t=document.createElement("div");t.className="bmf-app front",t.innerHTML=d+k(),e.innerHTML="",e.appendChild(t),document.getElementById("fd-boot")?.remove(),p(t,13),c(t),C(t)}const v=[{year:"1825",title:"The Great Miramichi Fire · New Brunswick",body:"One of the largest fires ever recorded in North America tore through northern New Brunswick, levelling timber towns along the river. Canada's wildfire story starts here — before there was anyone organized to fight it.",stat:"Among NA’s largest ever",tone:"fire"},{year:"1916",title:"The Great Matheson Fire · Ontario",body:"Settler land-clearing fires merged into one firestorm that consumed Matheson, Iroquois Falls and the towns between. It remains Canada's deadliest fire — and it forced the first modern forest-fire protection laws into being.",stat:"224 lives",tone:"warn"},{year:"1949",title:"The Saskatchewan Smokejumpers",body:"Canada's first smokejumpers stood up out of La Ronge — crews parachuting into the boreal to catch fires while they were still small. The same lake country this site flies.",stat:"Canada’s first"},{year:"1950",title:"The Chinchaga firestorm · BC & Alberta",body:'The largest single fire ever recorded in North America ran roughly 1.7 million hectares through the northern forest. Its "Great Smoke Pall" turned afternoon to dusk over Ontario and was traced as far as Europe.',stat:"~1.7M hectares",tone:"fire"},{year:"1960",title:"The Martin Mars water bombers · British Columbia",body:"Surplus wartime flying boats — the largest water bombers in the world — went to work over BC’s lakes. The last of them, Hawaii Mars, dropped some 190 million litres across five decades before its final flight in 2024, escorted by the Snowbirds.",stat:"190M litres dropped"},{year:"1967",title:"Canada builds the water bomber · Canadair CL-215",body:"The first aircraft in the world designed from a clean sheet to fight fire flew out of Quebec. 125 were built for 11 countries, and its scooper descendants still skim lakes from Canada to southern Europe.",stat:"125 built · 11 nations"},{year:"1982",title:"Canada learns to fight as one · CIFFC",body:"After three brutal seasons, the agencies founded the Canadian Interagency Forest Fire Centre — the desk that moves crews, pumps and airtankers to whichever province is burning worst. The same agency whose live data feeds this site's map.",stat:"One national effort"},{year:"2003",title:"The Okanagan Mountain Park firestorm · Kelowna, BC",body:"A lightning strike became a firestorm on Kelowna’s doorstep: 27,000 people evacuated and 239 homes lost. More than a thousand wildland firefighters and 1,400 Canadian Forces troops stood the line in the streets.",stat:"27,000 evacuated",tone:"warn"},{year:"2016",title:'Fort McMurray — "The Beast" · Alberta',body:"A fire so fierce it made its own weather sent 88,000 people down one highway through the flames. Firefighters held the hospital, the downtown and most of the city while the costliest disaster in Canadian history burned around them.",stat:"88,000 evacuated",tone:"warn"},{year:"2023",title:"The year the world came to help",body:"The worst season ever recorded: more than 17 million hectares burned, Yellowknife emptied, and BC’s largest-ever fire at Donnie Creek. Over 5,500 firefighters from a dozen countries flew in to stand beside Canada’s own.",stat:"12 nations answered"}],y='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>';function x(e){const t=e.tone?` ${e.tone}`:"";return`
    <li class="hof-ev">
      <span class="hof-dot" aria-hidden="true"></span>
      <article class="hof-card">
        <div class="hof-head"><span class="hof-year">${e.year}</span><span class="badge${t}">${e.stat}</span></div>
        <h3 class="hof-title">${e.title}</h3>
        <p class="hof-body">${e.body}</p>
      </article>
    </li>`}function k(){return`
${m()}
${b("halloffame")}
<div class="pad fhome">
  <section class="card cut rise fd-glass hof-hero"><span class="fd-glasstex" aria-hidden="true"></span>
    <div class="fd-hero">
      <div class="fd-hero-lead hof-mark" aria-hidden="true">${y}</div>
      <div class="fd-hero-main">
        <p class="fd-hero-eyebrow">Hall of Fame</p>
        <h1 class="fd-hero-head">The unsung warriors.</h1>
        <p class="fd-hero-sub">Canada's wildfire story, told through the people who answered it — the crews on the
          ground, the pilots overhead, the lookouts and dispatchers behind every save. Ten moments worth remembering.</p>
      </div>
    </div>
  </section>

  <section class="card cut hof-tl">
    <div class="sec"><span class="tag">Ten moments</span><span class="line"></span></div>
    <ol class="hof-list">${v.map(x).join("")}</ol>
  </section>

  <section class="card warm cut hof-trib">
    <div class="sec"><span class="tag">To the crews</span><span class="line"></span></div>
    <p class="hof-trib-h">Thank you to every wildland firefighter, pilot, lookout and dispatcher — past and present.</p>
    <p class="hof-trib-sub">The fires keep coming. The line holds because people hold it.</p>
    <a class="btn primary hof-trib-go" href="/open-skies/">Fly with them</a>
  </section>

  <p class="hof-sources">Drawn from the public record:
    <a href="https://natural-resources.canada.ca/" target="_blank" rel="noopener">Natural Resources Canada</a>,
    <a href="https://ciffc.ca/" target="_blank" rel="noopener">CIFFC</a>,
    <a href="https://www2.gov.bc.ca/" target="_blank" rel="noopener">the Government of B.C.</a>,
    <a href="https://www.publicsafety.gc.ca/" target="_blank" rel="noopener">Public Safety Canada</a> and
    <a href="https://www.cbc.ca/" target="_blank" rel="noopener">CBC News</a> archives.</p>

  ${u()}
</div>
${g("halloffame")}`}function C(e){const t=e.querySelector(".hof-list");if(!t||matchMedia("(prefers-reduced-motion: reduce)").matches||document.documentElement.classList.contains("fd-reduce-motion")||typeof IntersectionObserver>"u")return;t.classList.add("hof-anim");const r=new IntersectionObserver(a=>{for(const o of a)o.isIntersecting&&(o.target.classList.add("hof-in"),r.unobserve(o.target))},{rootMargin:"0px 0px -8% 0px",threshold:.12});t.querySelectorAll(".hof-ev").forEach(a=>r.observe(a))}function T(){if(document.getElementById("fd-hof-css"))return;const e=document.createElement("style");e.id="fd-hof-css",e.textContent=`
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
.bmf-app.front .hof-card { background: var(--bezel); border: 1px solid var(--hair); border-radius: var(--r-md);
  padding: 14px 15px 15px; transition: border-color .2s ease; }
.bmf-app.front .hof-ev:hover .hof-card { border-color: var(--warm-stroke); }
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
.bmf-app.front .hof-trib-go { margin-top: 16px; text-decoration: none; }

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
  .bmf-app.front .hof-trib { padding: 24px 26px; }
}
`,document.head.appendChild(e)}w();
