/* Stream theme interactions: Lenis smooth scroll, GSAP/ScrollTrigger, mega-menu preview. */
(function () {
  'use strict';
  var d = document;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var desktop = function () { return window.matchMedia('(min-width: 1025px)').matches; };
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };
  var lenis = null;

  /* Smooth scroll, kept in step with ScrollTrigger */
  function initSmooth() {
    if (reduce || !window.Lenis) return;
    lenis = new window.Lenis({ duration: 1.1, easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); }, anchors: false });
    if (window.gsap && window.ScrollTrigger) {
      lenis.on('scroll', window.ScrollTrigger.update);
      window.gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
      window.gsap.ticker.lagSmoothing(0);
    } else {
      (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
    }
    $$('a[href^="#"]').forEach(function (a) {
      var id = a.getAttribute('href');
      if (id.length < 2) return;
      a.addEventListener('click', function (e) {
        var t = $(id);
        if (t) { e.preventDefault(); lenis.scrollTo(t, { offset: -70 }); }
      });
    });
  }

  /* Header: reading progress */
  var header = $('[data-header]');
  var bar = $('[data-progress]');
  function onScroll() {
    var y = window.scrollY || 0;
    if (bar) {
      var max = d.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
    }
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Mega menu: hover intent, live preview pane, accordion on mobile */
  var items = $$('.nav-item.has-mega, .nav-item.has-drop');
  var closeTimer = null;
  function closeAll(except) {
    items.forEach(function (li) {
      if (li !== except) {
        li.classList.remove('is-open');
        var a = $('.nav-link', li);
        if (a) a.setAttribute('aria-expanded', 'false');
        resetPreview(li);
      }
    });
  }
  function open(li) {
    clearTimeout(closeTimer);
    closeAll(li);
    li.classList.add('is-open');
    var a = $('.nav-link', li);
    if (a) a.setAttribute('aria-expanded', 'true');
  }
  var previews = new WeakMap();
  function setPreview(li, link) {
    var pane = $('.mega-preview', li);
    if (!pane || !link.getAttribute('data-art')) return;
    if (!previews.has(pane)) previews.set(pane, pane.innerHTML);
    var img = $('img', pane), strong = $('strong', pane), p = $('p', pane), cta = $('.mp-cta', pane), frame = $('.mp-frame', pane);
    if (img.getAttribute('src') !== link.getAttribute('data-art')) img.setAttribute('src', link.getAttribute('data-art'));
    strong.textContent = link.getAttribute('data-title') || '';
    p.textContent = link.getAttribute('data-desc') || '';
    if (cta) cta.setAttribute('href', link.getAttribute('href'));
    if (frame) frame.setAttribute('href', link.getAttribute('href'));
  }
  function resetPreview(li) {
    var pane = $('.mega-preview', li);
    if (pane && previews.has(pane)) { pane.innerHTML = previews.get(pane); previews.delete(pane); }
  }
  items.forEach(function (li) {
    li.addEventListener('mouseenter', function () { if (desktop() && finePointer) { clearTimeout(closeTimer); closeTimer = setTimeout(function () { open(li); }, 60); } });
    li.addEventListener('mouseleave', function () { if (desktop() && finePointer) { clearTimeout(closeTimer); closeTimer = setTimeout(function () { closeAll(null); }, 140); } });
    li.addEventListener('focusin', function () { if (desktop()) open(li); });
    li.addEventListener('focusout', function (e) { if (desktop() && !li.contains(e.relatedTarget)) closeAll(null); });
    $$('.mega-link a', li).forEach(function (a) {
      a.addEventListener('mouseenter', function () { setPreview(li, a); });
      a.addEventListener('focus', function () { setPreview(li, a); });
    });
    var link = $('.nav-link', li);
    link.addEventListener('click', function (e) {
      if (desktop() && !finePointer && !li.classList.contains('is-open')) { e.preventDefault(); open(li); }
    });
    var tog = $('.sub-toggle', li);
    if (tog) tog.addEventListener('click', function () { li.classList.toggle('is-open'); });
  });
  var lastY = window.scrollY || 0;
  window.addEventListener('scroll', function () {
    var y = window.scrollY || 0;
    if (desktop() && Math.abs(y - lastY) > 40) { closeAll(null); lastY = y; }
  }, { passive: true });
  d.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeAll(null); closeNav(); } });
  d.addEventListener('click', function (e) { if (desktop() && !e.target.closest('.nav-item')) closeAll(null); });

  var burger = $('[data-burger]');
  function closeNav() { d.body.classList.remove('nav-open'); if (burger) burger.setAttribute('aria-expanded', 'false'); if (lenis) lenis.start(); }
  if (burger) {
    burger.addEventListener('click', function () {
      var on = !d.body.classList.contains('nav-open');
      if (on) {
        var hb = header ? header.getBoundingClientRect().bottom : 60;
        d.documentElement.style.setProperty('--hdr-bottom', Math.max(0, hb) + 'px');
      }
      d.body.classList.toggle('nav-open', on);
      burger.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (lenis) { on ? lenis.stop() : lenis.start(); }
    });
  }
  window.addEventListener('resize', function () { if (desktop()) closeNav(); });

  /* Reveal on scroll with sibling stagger */
  var reveals = $$('[data-reveal]');
  reveals.forEach(function (el) {
    var sibs = $$('[data-reveal]', el.parentNode).filter(function (s) { return s.parentNode === el.parentNode; });
    var i = sibs.indexOf(el);
    if (i > 0) el.style.setProperty('--d', Math.min(i, 6) * 0.06 + 's');
  });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* Pause animated SVGs that are off screen (CSS + SMIL) */
  var arts = $$('.art[data-art]');
  function setSvgPaused(art, paused) {
    var svg = $('svg', art);
    if (!svg) return;
    try { paused ? svg.pauseAnimations() : svg.unpauseAnimations(); } catch (e) { /* older browsers */ }
  }
  if ('IntersectionObserver' in window) {
    var artIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        en.target.classList.toggle('is-offscreen', !en.isIntersecting);
        setSvgPaused(en.target, !en.isIntersecting);
      });
    }, { rootMargin: '120px 0px' });
    arts.forEach(function (a) { artIo.observe(a); });
  }

  /* Count-up numbers */
  var counters = $$('[data-counter]');
  function count(el) {
    var to = parseInt(el.getAttribute('data-counter'), 10) || 0;
    if (reduce || to < 2) { el.textContent = to; return; }
    var t0 = performance.now(), dur = 1400;
    (function tick(t) {
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * e);
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }
  if ('IntersectionObserver' in window) {
    var cIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { count(en.target); cIo.unobserve(en.target); } });
    }, { threshold: 0.6 });
    counters.forEach(function (c) { cIo.observe(c); });
  } else { counters.forEach(count); }

  /* Sticky storytelling: swap the art as each step passes mid-screen */
  var flow = $('[data-flow]');
  if (flow && 'IntersectionObserver' in window) {
    var steps = $$('.flow-step', flow), flowArts = $$('.flow-art', flow);
    var setStep = function (i) {
      steps.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
      flowArts.forEach(function (a, k) {
        a.classList.toggle('is-active', k === i);
        var art = $('.art', a);
        if (art) { art.classList.toggle('is-inactive', k !== i); setSvgPaused(art, k !== i); }
      });
    };
    setStep(0);
    var sIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) setStep(steps.indexOf(en.target)); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { sIo.observe(s); });
  }

  /* Role tabs */
  $$('[data-tabs]').forEach(function (wrap) {
    var tabs = $$('.tab', wrap), panels = $$('.tab-panel', wrap);
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var i = t.getAttribute('data-tab');
        tabs.forEach(function (x) { var on = x === t; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
        panels.forEach(function (p) { p.classList.toggle('is-active', p.getAttribute('data-panel') === i); });
      });
    });
  });

  /* Pricing toggle */
  $$('[data-billing]').forEach(function (wrap) {
    var btns = $$('[data-period]', wrap);
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-period');
        btns.forEach(function (x) { x.classList.toggle('is-active', x === b); });
        $$('[data-monthly]', wrap).forEach(function (n) { n.textContent = n.getAttribute('data-' + p); });
      });
    });
  });

  /* Live Double Point Frenzy countdown (demo: restarts at 48h on each visit) */
  var cds = $$('[data-countdown]');
  if (cds.length) {
    var end = Date.now() + (47 * 3600 + 59 * 60 + 59) * 1000;
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var tick = function () {
      var s = Math.max(0, Math.floor((end - Date.now()) / 1000));
      var txt = Math.floor(s / 3600) + 'h ' + pad(Math.floor((s % 3600) / 60)) + 'm ' + pad(s % 60) + 's';
      cds.forEach(function (c) { c.textContent = txt; });
    };
    tick();
    setInterval(tick, 1000);
  }

  /* GSAP: headline reveal and a product frame that settles as you scroll */
  function initGsap() {
    initSmooth();
    if (!window.gsap || reduce) return;
    var gsap = window.gsap;
    if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);

    var h1 = $('[data-split]');
    if (h1) {
      var frag = d.createDocumentFragment();
      var unit = function (node) {
        var w = d.createElement('span'); w.className = 'w';
        var i = d.createElement('span'); i.appendChild(node); w.appendChild(i);
        frag.appendChild(w); frag.appendChild(d.createTextNode(' '));
      };
      Array.prototype.slice.call(h1.childNodes).forEach(function (n) {
        if (n.nodeType === 3) n.textContent.split(/\s+/).filter(Boolean).forEach(function (word) { unit(d.createTextNode(word)); });
        else unit(n);
      });
      h1.textContent = '';
      h1.appendChild(frag);
      gsap.from('[data-split] .w > span', { yPercent: 110, duration: 1, ease: 'power4.out', stagger: 0.055, delay: 0.05 });
    }

    var frame = $('[data-hero-frame]');
    if (frame && window.ScrollTrigger) {
      gsap.from(frame, { y: 70, opacity: 0, duration: 1.2, ease: 'power3.out', delay: 0.35 });
      gsap.fromTo(frame, { scale: 0.94 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: frame, start: 'top 92%', end: 'top 38%', scrub: true } });
    }
    if (window.ScrollTrigger) {
      gsap.utils.toArray('.frow .frame, .plumb .frame, .roles .frame').forEach(function (el) {
        gsap.fromTo(el, { yPercent: 3 }, { yPercent: -3, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    }
  }
  if (d.readyState === 'complete') initGsap(); else window.addEventListener('load', initGsap);
})();

/* ── v2.1 playful layer: transitions, tilt, sparkles, sticky CTA ────────── */
(function () {
  'use strict';
  var d = document, w = window;
  var reduce = w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = w.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };

  /* Page transitions: fade/slide between internal pages */
  if (!reduce) {
    d.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest('a');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || a.target === '_blank' || a.hasAttribute('download')) return;
      var url;
      try { url = new URL(href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      if (/^\/(wp-admin|wp-login|wp-json)/.test(url.pathname) || /\.(zip|pdf)$/i.test(url.pathname)) return;
      e.preventDefault();
      d.body.classList.add('page-out');
      setTimeout(function () { location.href = url.href; }, 210);
    });
    w.addEventListener('pageshow', function (e) { if (e.persisted) d.body.classList.remove('page-out'); });
  }

  /* Pointer tilt on illustration frames */
  if (finePointer && !reduce) {
    $$('[data-tilt]').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--tx', ((e.clientY - r.top) / r.height - 0.5) * -5 + 'deg');
        el.style.setProperty('--ty', ((e.clientX - r.left) / r.width - 0.5) * 6 + 'deg');
      });
      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--tx', '0deg');
        el.style.setProperty('--ty', '0deg');
      });
    });
    /* Spotlight follows the pointer on dark bands */
    $$('.spot').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--sx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--sy', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* Sparkles: burst of brand-coloured bits */
  function burst(x, y, n, colors) {
    if (reduce) return;
    colors = colors || ['#4463FF', '#19C8A0', '#FFB020', '#8B5CF6', '#0A0B10'];
    for (var i = 0; i < n; i++) {
      var s = d.createElement('span');
      s.className = 'sparkle';
      var ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      var dist = 34 + Math.random() * 54;
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.background = colors[i % colors.length];
      s.style.setProperty('--sx', Math.cos(ang) * dist + 'px');
      s.style.setProperty('--sy', Math.sin(ang) * dist - 22 + 'px');
      d.body.appendChild(s);
      setTimeout(function (el) { el.remove(); }, 950, s);
    }
  }
  /* A little celebration on primary CTAs */
  $$('.cta-actions .btn-light, .hero-cta .btn-primary').forEach(function (b) {
    b.addEventListener('click', function (e) {
      var r = b.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 10);
    });
  });
  /* Frenzy scene: clicking the big 2x pops confetti */
  d.addEventListener('click', function (e) {
    var x = e.target.closest && e.target.closest('.bigx');
    if (!x) return;
    x.classList.remove('bigx-pop');
    void x.getBoundingClientRect();
    x.classList.add('bigx-pop');
    burst(e.clientX, e.clientY, 14, ['#FFB020', '#FF5C8A', '#4463FF', '#19C8A0']);
  });

  /* Hero art parallax: wrap the animated float layers at runtime and nudge them */
  var heroArt = $('.hero-stage .art svg');
  if (heroArt && finePointer && !reduce) {
    var layers = [];
    $$('.float', heroArt).forEach(function (g, i) {
      var wrap = d.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.parentNode.insertBefore(wrap, g);
      wrap.appendChild(g);
      layers.push({ el: wrap, d: 8 + (i % 4) * 6, x: 0, y: 0, tx: 0, ty: 0 });
    });
    var stage = $('.hero-stage');
    stage.addEventListener('pointermove', function (e) {
      var r = stage.getBoundingClientRect();
      var nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
      layers.forEach(function (l) { l.tx = -nx * l.d; l.ty = -ny * l.d; });
    });
    stage.addEventListener('pointerleave', function () { layers.forEach(function (l) { l.tx = 0; l.ty = 0; }); });
    (function plx() {
      var live = false;
      layers.forEach(function (l) {
        l.x += (l.tx - l.x) * 0.07; l.y += (l.ty - l.y) * 0.07;
        if (Math.abs(l.x) > 0.05 || Math.abs(l.y) > 0.05 || Math.abs(l.tx) > 0.05) live = true;
        l.el.setAttribute('transform', 'translate(' + l.x.toFixed(2) + ' ' + l.y.toFixed(2) + ')');
      });
      if (live || layers.some(function (l) { return l.x || l.y; })) requestAnimationFrame(plx); else setTimeout(plx, 120);
    })();
  }

  /* Sticky demo pill: appears after the hero, hides near the end or on form pages */
  var pill = $('[data-sticky-cta]');
  if (pill) {
    var seen = false;
    function pillCheck() {
      var y = w.scrollY || 0;
      var endNear = d.documentElement.scrollHeight - (y + w.innerHeight) < 640;
      var ctaNear = false;
      var band = $('.cta-band');
      if (band) {
        var br = band.getBoundingClientRect();
        ctaNear = br.top < w.innerHeight && br.bottom > 0;
      }
      pill.classList.toggle('on', y > w.innerHeight * 0.75 && !endNear && !ctaNear);
    }
    if ('IntersectionObserver' in window) {
      var heroEl = $('.hero, .page-hero');
      if (heroEl) new IntersectionObserver(function (en) { seen = !en[0].isIntersecting; pillCheck(); }).observe(heroEl);
    }
    w.addEventListener('scroll', pillCheck, { passive: true });
    pillCheck();
  }
})();
