function s(t){return t.replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]??a)}function b(t,a,r){const n=t.imageUrl?`<div class="fd-m-art"><img src="${t.imageUrl}" alt="" loading="lazy" /></div>`:'<div class="fd-m-art proc"></div>',l=t.specs?`<div class="fd-m-specs">${t.specs.map(o=>`<div class="fd-spec"><span>${s(o.label)}</span><i class="trk"><b style="--v:${o.value}"></b></i></div>`).join("")}</div>`:t.stats?`<div class="fd-m-meta"><span>${s(t.stats.area)}</span><span>${s(t.stats.lakes)}</span></div>`:"",d=r.locked?"":`<span class="fd-m-go">${r.href?"Fly":"Choose"} →</span>`,f=n+`<span class="fd-m-scrim"></span><div class="fd-m-top">${a}</div><div class="fd-m-body"><p class="fd-m-kicker">${s(t.tagline)}</p><div class="fd-m-name">${s(t.name)}</div>`+l+d+"</div>";return r.locked?`<div class="fd-mcard fd-card locked" aria-disabled="true">${f}</div>`:r.href?`<a class="fd-mcard fd-card" href="${r.href}" aria-label="Fly ${s(t.name)}">${f}</a>`:`<button class="fd-mcard fd-card" data-pick="${s(r.pick??"")}" aria-label="Choose ${s(t.name)}">${f}</button>`}function y(t){const a=t.querySelector(".fly-strip"),r=t.querySelector(".fly-dots");if(!a||!r)return;const n=Array.from(a.querySelectorAll(".fd-mcard"));if(n.length<2)return;r.innerHTML=n.map((p,e)=>`<i${e===0?' class="on"':""}></i>`).join("");const l=Array.from(r.children),d=p=>l.forEach((e,i)=>e.classList.toggle("on",i===p)),f=()=>{const p=a.scrollLeft+a.clientWidth/2;let e=0,i=1/0;return n.forEach((c,h)=>{const m=Math.abs(c.offsetLeft+c.clientWidth/2-p);m<i&&(i=m,e=h)}),e};let o=0;a.addEventListener("scroll",()=>{o||(o=requestAnimationFrame(()=>{o=0,d(f())}))},{passive:!0}),l.forEach((p,e)=>p.addEventListener("click",()=>{const i=n[e];a.scrollTo({left:i.offsetLeft-(a.clientWidth-i.clientWidth)/2,behavior:"smooth"})}))}function v(){if(document.getElementById("fd-flypicker-css"))return;const t=document.createElement("style");t.id="fd-flypicker-css",t.textContent=`
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
.bmf-app.front .fly-strip .fd-mcard { min-height: 300px; }
@media (min-width: 600px) { .bmf-app.front .fly-strip .fd-mcard { min-height: 326px; } }
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
`,document.head.appendChild(t)}export{v as i,b as p,y as w};
