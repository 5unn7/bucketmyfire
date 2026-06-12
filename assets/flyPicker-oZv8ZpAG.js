import{l as o,p as h}from"./frontShell-98g2TKKh.js";function g(t,e,a){const p=t.imageUrl?`<div class="fd-m-art"><img src="${t.imageUrl}" alt="" loading="lazy" /></div>`:'<div class="fd-m-art proc"></div>',f=t.specs?`<div class="fd-m-specs">${t.specs.map(r=>`<div class="fd-spec"><span>${o(r.label)}</span><i class="trk"><b style="--v:${r.value}"></b></i></div>`).join("")}</div>`:t.stats?`<div class="fd-m-meta"><span>${o(t.stats.area)}</span><span>${o(t.stats.lakes)}</span></div>`:"",d=a.locked?t.stats?`<button type="button" class="btn secondary block fd-m-notify" data-notify-map="${o(t.id)}">${h("bell")}Notify me</button>`:t.cost?`<span class="fd-m-unlock">${h("spark")}Unlock · ${t.cost.toLocaleString()} pts</span>`:"":`<span class="fd-m-go">${a.href?"Fly":"Choose"} →</span>`,l=p+`<span class="fd-m-scrim"></span><div class="fd-m-top">${e}</div><div class="fd-m-body"><p class="fd-m-kicker">${o(t.tagline)}</p><div class="fd-m-name">${o(t.name)}</div>`+f+d+"</div>",n=`fd-mcard fd-card${t.stats?" fd-map":""}`;return a.locked?`<div class="${n} locked" aria-disabled="true">${l}</div>`:a.href?`<a class="${n}" href="${a.href}" aria-label="Fly ${o(t.name)}">${l}</a>`:`<button class="${n}" data-pick="${o(a.pick??"")}" aria-label="Choose ${o(t.name)}">${l}</button>`}function u(t){const e=t.querySelector(".fly-strip"),a=t.querySelector(".fly-dots");if(!e||!a)return;const p=Array.from(e.querySelectorAll(".fd-mcard"));if(p.length<2)return;a.innerHTML=p.map((r,s)=>`<i${s===0?' class="on"':""}></i>`).join("");const f=Array.from(a.children),d=r=>f.forEach((s,i)=>s.classList.toggle("on",i===r)),l=()=>{const r=e.scrollLeft+e.clientWidth/2;let s=0,i=1/0;return p.forEach((c,b)=>{const m=Math.abs(c.offsetLeft+c.clientWidth/2-r);m<i&&(i=m,s=b)}),s};let n=0;e.addEventListener("scroll",()=>{n||(n=requestAnimationFrame(()=>{n=0,d(l())}))},{passive:!0}),f.forEach((r,s)=>r.addEventListener("click",()=>{const i=p[s];e.scrollTo({left:i.offsetLeft-(e.clientWidth-i.clientWidth)/2,behavior:"smooth"})}))}function v(){if(document.getElementById("fd-flypicker-css"))return;const t=document.createElement("style");t.id="fd-flypicker-css",t.textContent=`
/* Bigger, image-forward picker posters in a swipeable carousel — ONE horizontal row at every width, no
   wrap. On a PHONE one tall poster sits in view with a peek of the next (swipe to advance). On a wider
   screen the posters fix to a comfortable width so several ride the same line and the row scrolls past
   the edge when they don't all fit. Position dots track the strip the whole way. */
.bmf-app.front .fly-strip { display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 2px; }
.bmf-app.front .fly-strip::-webkit-scrollbar { display: none; }
.bmf-app.front .fly-strip > .fd-mcard { flex: 0 0 86%; max-width: 400px; scroll-snap-align: start; }
.bmf-app.front .fly-dots { display: flex; justify-content: center; gap: 6px; margin-top: 14px; }
.bmf-app.front .fly-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--track);
  transition: width .2s, background .2s; cursor: pointer; }
.bmf-app.front .fly-dots i.on { width: 18px; border-radius: var(--r-pill); background: var(--ember-hi); }
/* Tablet+ : fixed-width posters so the strip stays ONE line and overflows horizontally rather than wrapping. */
@media (min-width: 600px) {
  .bmf-app.front .fly-strip > .fd-mcard { flex: 0 0 300px; max-width: none; }
}
/* Pick posters carry a FIXED height (overriding the base 3/4 aspect) so EVERY card matches — the map
   step and the aircraft step land at the same height even though a heli card's body (4 spec meters) is
   taller than a map's two-fact line. Kept a touch shorter than the natural poster so the full card —
   name, specs, CTA — clears the fold without scrolling. */
.bmf-app.front .fly-strip .fd-mcard { height: 372px; min-height: 0; aspect-ratio: auto; }
@media (min-width: 600px) { .bmf-app.front .fly-strip .fd-mcard { height: 384px; } }
/* The pick card can be a <button>; null its UA chrome so the copy left/bottom-aligns in the app font,
   exactly like the locked <div> and the <a> aircraft cards (a bare button defaults to centre + Arial). */
.bmf-app.front .fly-strip button.fd-mcard { appearance: none; -webkit-appearance: none; text-align: left; font: inherit; color: var(--text); cursor: pointer; }
.bmf-app.front .fly-strip .fd-mcard .fd-m-top { justify-content: flex-end; }
.bmf-app.front .fly-strip .fd-mcard .fd-m-body { padding: 16px 16px 17px; }
.bmf-app.front .fly-strip .fd-m-kicker { margin: 0 0 5px; font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .16em; text-transform: uppercase; color: var(--menu); }
.bmf-app.front .fly-strip .fd-m-name { font-size: clamp(20px, 2.2vw, 25px); line-height: 1.05; }
.bmf-app.front .fly-strip .fd-m-meta { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 9px; }
.bmf-app.front .fly-strip .fd-m-meta span { font-family: var(--mono); font-size: var(--fs-meta); letter-spacing: .02em; color: var(--text-subtle); }
.bmf-app.front .fly-strip .fd-m-specs { display: grid; gap: 6px; margin-top: 11px; max-width: 232px; }
.bmf-app.front .fly-strip .fd-spec { display: grid; grid-template-columns: 56px 1fr; align-items: center; gap: 9px; }
.bmf-app.front .fly-strip .fd-spec > span { font-family: var(--mono); font-size: var(--fs-micro); letter-spacing: .07em; text-transform: uppercase; color: var(--dim); }
.bmf-app.front .fly-strip .fd-spec .trk { height: 4px; border-radius: 99px; background: var(--recess); overflow: hidden; }
.bmf-app.front .fly-strip .fd-spec .trk b { display: block; height: 100%; width: calc(var(--v, 0) * 100%); border-radius: 99px; background: linear-gradient(90deg, var(--ember), var(--ember-hi)); }
/* Map pick cards (.fd-map): the art is a 3D terrain SLAB rendered on transparency — built to FLOAT, not
   to fill. Show the WHOLE slab (contain), parked in the upper card over a faint warm spotlight and casting
   a true silhouette shadow, so it reads as a floating object rather than a zoomed-in cover crop (mirrors
   the in-game .artcard.map). Helis keep the full-bleed cover key art. */
.bmf-app.front .fly-strip .fd-mcard.fd-map { background: radial-gradient(118% 82% at 50% 27%, var(--ember-12), var(--card-bg) 70%); }
.bmf-app.front .fly-strip .fd-mcard.fd-map .fd-m-art { inset: 0 0 auto 0; height: 72%; }
.bmf-app.front .fly-strip .fd-mcard.fd-map .fd-m-art img { object-fit: contain; object-position: 50% 42%;
  padding: 20px 18px 0; box-sizing: border-box; filter: drop-shadow(0 18px 22px rgba(0,0,0,0.5)); }
/* Base-anchored scrim only — the slab floats above it, so don't wash the whole card (which would dim the slab). */
.bmf-app.front .fly-strip .fd-mcard.fd-map .fd-m-scrim { background: linear-gradient(180deg, transparent 0%, transparent 52%, rgba(6,9,11,0.74) 82%, rgba(6,9,11,0.95) 100%); }
/* Hover LIFTS the slab (a contained slab should rise, not zoom like the cover key-art cards). */
.bmf-app.front .fly-strip .fd-mcard.fd-map:hover .fd-m-art img { transform: translateY(-6px); }
/* Upcoming (locked) MAP cards carry a working "Notify me" CTA: only the slab stays dimmed (the "not
   flyable yet" signal) — keep the copy + button crisp, and re-enable pointer events on the button since
   the locked card itself is inert (pointer-events:none from the shell). */
.bmf-app.front .fly-strip .fd-mcard.fd-map.locked .fd-m-body { filter: none; opacity: 1; }
.bmf-app.front .fly-strip .fd-mcard.locked .fd-m-notify { pointer-events: auto; }
.bmf-app.front .fly-strip .fd-m-notify { margin-top: 13px; }
/* Locked AIRCRAFT surface their career-points unlock PRICE. Keep the locked heli BODY crisp (like locked
   maps) so the price + specs stay readable — only the art dims to signal "not flyable yet". The price uses
   the same warm wallet language as .pts-bal everywhere (text = --menu, the ◇ spark = --ember-hi). */
.bmf-app.front .fly-strip .fd-mcard.locked:not(.fd-map) .fd-m-body { filter: none; opacity: 1; }
.bmf-app.front .fly-strip .fd-m-unlock { display: inline-flex; align-items: center; gap: 5px; margin-top: 12px;
  font-family: var(--mono); font-size: var(--fs-meta); font-weight: var(--fw-bold); letter-spacing: .03em; color: var(--menu); }
.bmf-app.front .fly-strip .fd-m-unlock svg { width: 14px; height: 14px; color: var(--ember-hi); flex: none; }
`,document.head.appendChild(t)}export{v as i,g as p,u as w};
