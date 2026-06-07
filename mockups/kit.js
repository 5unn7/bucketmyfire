/* ============================================================================
   bucketmyfire — PROTOTYPE KIT behaviors
   Injects shared chrome (svg defs, ambient scene, bottom rail) and wires the
   clickable navigation so the prototype hangs together as one app.

   ICON SET mirrors src/three/ui/svgIcons.ts (Lucide, MIT) so the prototype trains
   the SAME eye as the in-game HUD; a few extra glyphs (heli, wind, tree, droplet,
   house, clock, target, shield) are added in the same 24px stroke style.

   Per-screen contract (set on <body>):
     data-screen="home|coop|maps|hangar|board|shop|settings|…"  -> active rail tab
     data-rail="false"   -> suppress the bottom rail (title/onboarding/briefing/debrief)
     data-bg="false"     -> suppress the ambient scene (rare)
   Navigation: any element with data-nav="<key>" routes to that screen file.
   Icons: any element with data-icon="<name>" is filled with that glyph (currentColor).
   Modals: data-open="#id" opens, data-close closes (also backdrop + Esc).
   ========================================================================== */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var body = document.body;

  /* ---- screen routing map ---- */
  var NAV = {
    index: 'index.html', title: 'title.html', onboarding: 'onboarding.html',
    home: 'home.html', daily: 'daily.html', campaign: 'campaign.html',
    briefing: 'briefing.html', debrief: 'debrief.html', maps: 'maps.html',
    hangar: 'hangar.html', coop: 'coop.html', board: 'leaderboard.html',
    leaderboard: 'leaderboard.html', settings: 'settings.html',
    shop: 'store.html', store: 'store.html',
  };

  /* ---- shared icon set (24x24, stroke=currentColor) ---- */
  var ICON = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    map: '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
    heli: '<line x1="3" y1="7" x2="14" y2="7"/><line x1="8.5" y1="7" x2="8.5" y2="4.5"/><path d="M4 13.5c0-2 1.6-3.5 3.5-3.5H11l5 2.5"/><path d="M4 13.5h8a2.5 2.5 0 0 0 2.5-2.5"/><line x1="16" y1="12.5" x2="21" y2="11"/><line x1="20" y1="9" x2="20" y2="14"/><path d="M7 16l-1.5 3"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    shop: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    fire: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    wind: '<path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>',
    droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
    tree: '<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17z"/><path d="M12 22v-3"/>',
    house: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  };
  function iconSvg(name, cls) {
    return '<svg viewBox="0 0 24 24" class="' + (cls || '') + '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || ICON['chevron-right']) + '</svg>';
  }
  // fill any data-icon placeholder
  document.querySelectorAll('[data-icon]').forEach(function (n) {
    var nm = n.getAttribute('data-icon'); if (ICON[nm]) n.innerHTML = iconSvg(nm);
  });

  /* ---- shared SVG gradient defs (brand flame + helmet) ---- */
  if (!document.getElementById('flameGrad')) {
    var defs = document.createElement('div');
    defs.innerHTML =
      '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
      '<linearGradient id="flameGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc24a"/><stop offset="1" stop-color="#ff6a2c"/></linearGradient>' +
      '<linearGradient id="helmGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd98a"/><stop offset="1" stop-color="#ff8a4a"/></linearGradient>' +
      '</defs></svg>';
    body.insertBefore(defs.firstChild, body.firstChild);
  }

  /* ---- ambient backdrop ---- */
  if (body.getAttribute('data-bg') !== 'false') {
    function add(cls) { var d = document.createElement('div'); d.className = cls; d.setAttribute('aria-hidden', 'true'); body.insertBefore(d, body.firstChild); return d; }
    add('filmgrain');
    var embers = add('embers');
    add('scene');
    if (!reduce) {
      for (var i = 0; i < 14; i++) {
        var e = document.createElement('span'); e.className = 'ember-mote';
        e.style.left = (Math.random() * 100).toFixed(1) + '%';
        var dur = (6 + Math.random() * 7).toFixed(1);
        e.style.animationDuration = dur + 's';
        e.style.animationDelay = (-Math.random() * dur) + 's';
        e.style.transform = 'scale(' + (0.6 + Math.random() * 1.6).toFixed(2) + ')';
        e.style.setProperty('--drift', (Math.random() * 60 - 20).toFixed(0) + 'px');
        embers.appendChild(e);
      }
    }
  }

  /* ---- bottom rail ---- */
  var TABS = [
    { key: 'home', label: 'Home', icon: 'home' },
    { key: 'coop', label: 'Co-op', icon: 'users' },
    { key: 'maps', label: 'Maps', icon: 'map' },
    { key: 'hangar', label: 'Hangar', icon: 'heli' },
    { key: 'board', label: 'Board', icon: 'trophy' },
    { key: 'shop', label: 'Shop', icon: 'shop' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];
  if (body.getAttribute('data-rail') !== 'false') {
    var active = body.getAttribute('data-screen') || 'home';
    var nav = document.createElement('nav');
    nav.className = 'rail'; nav.setAttribute('aria-label', 'Primary');
    var html = '<div class="keys">';
    TABS.forEach(function (t) {
      var on = t.key === active;
      html += '<button class="key' + (on ? ' active' : '') + '" data-nav="' + t.key + '"' + (on ? ' aria-current="page"' : '') + '>' +
        (on ? '<span class="tick"></span>' : '') + iconSvg(t.icon, 'line') + '<span class="lbl">' + t.label + '</span></button>';
    });
    html += '</div>';
    nav.innerHTML = html;
    body.appendChild(nav);
  }

  /* ---- navigation ---- */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-nav]');
    if (t) {
      var key = t.getAttribute('data-nav');
      if (key === body.getAttribute('data-screen')) { ev.preventDefault(); return; }
      if (NAV[key]) { ev.preventDefault(); location.href = NAV[key]; }
    }
  });

  /* ---- modals / sheets ---- */
  function closeAll() {
    document.querySelectorAll('.modal-wrap.open').forEach(function (m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); });
  }
  document.addEventListener('click', function (ev) {
    var opener = ev.target.closest && ev.target.closest('[data-open]');
    if (opener) {
      var m = document.querySelector(opener.getAttribute('data-open'));
      if (m) { m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
      return;
    }
    if (ev.target.closest && ev.target.closest('[data-close]')) closeAll();
    else if (ev.target.classList && ev.target.classList.contains('backdrop')) closeAll();
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeAll(); });

  /* ---- toggles ---- */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-toggle]');
    if (!t) return;
    var on = t.classList.toggle('on');
    t.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  document.addEventListener('keydown', function (ev) {
    var t = ev.target.closest && ev.target.closest('[data-toggle]');
    if (t && (ev.key === ' ' || ev.key === 'Enter')) { ev.preventDefault(); t.classList.toggle('on'); t.setAttribute('aria-checked', t.classList.contains('on') ? 'true' : 'false'); }
  });

  /* ---- segmented tabs ---- */
  document.querySelectorAll('.tabs').forEach(function (grp) {
    grp.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      grp.querySelectorAll('button').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      var panel = grp.getAttribute('data-panels');
      if (panel) {
        var idx = Array.prototype.indexOf.call(grp.querySelectorAll('button'), b);
        document.querySelectorAll(panel + ' > [data-tabpanel]').forEach(function (p, i) { p.style.display = i === idx ? '' : 'none'; });
      }
    });
  });

  /* ---- carousels: keep dots in sync ---- */
  document.querySelectorAll('[data-dots]').forEach(function (sc) {
    var dots = document.querySelector(sc.getAttribute('data-dots'));
    if (!dots) return;
    var items = sc.children.length;
    function sync() {
      var i = Math.round(sc.scrollLeft / (sc.scrollWidth / items));
      dots.querySelectorAll('i').forEach(function (d, k) { d.classList.toggle('on', k === Math.min(i, items - 1)); });
    }
    sc.addEventListener('scroll', function () { window.requestAnimationFrame(sync); }, { passive: true });
  });
})();
