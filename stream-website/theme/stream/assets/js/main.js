/* Stream theme interactions. Vanilla JS plus GSAP/ScrollTrigger for the hero and scroll effects. */
(function () {
  'use strict';
  var d = document;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var desktop = function () { return window.matchMedia('(min-width: 1025px)').matches; };
  var $ = function (s, c) { return (c || d).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); };

  /* Header: scrolled state + reading progress */
  var header = $('[data-header]');
  var bar = $('[data-progress]');
  function onScroll() {
    var y = window.scrollY || 0;
    if (header) header.classList.toggle('is-scrolled', y > 8);
    if (bar) {
      var max = d.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
    }
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Mega menu: hover intent on desktop, accordion on mobile */
  var scrim = $('[data-scrim]');
  var items = $$('.nav-item.has-mega, .nav-item.has-drop');
  var closeTimer = null;
  function closeAll(except) {
    items.forEach(function (li) {
      if (li !== except) {
        li.classList.remove('is-open');
        var a = $('.nav-link', li);
        if (a) a.setAttribute('aria-expanded', 'false');
      }
    });
    if (scrim) scrim.classList.toggle('on', !!except && except.classList.contains('has-mega'));
  }
  function open(li) {
    clearTimeout(closeTimer);
    closeAll(li);
    li.classList.add('is-open');
    var a = $('.nav-link', li);
    if (a) a.setAttribute('aria-expanded', 'true');
    if (scrim && li.classList.contains('has-mega') && desktop()) scrim.classList.add('on');
  }
  items.forEach(function (li) {
    li.addEventListener('mouseenter', function () { if (desktop() && finePointer) { clearTimeout(closeTimer); closeTimer = setTimeout(function () { open(li); }, 70); } });
    li.addEventListener('mouseleave', function () { if (desktop() && finePointer) { clearTimeout(closeTimer); closeTimer = setTimeout(function () { closeAll(null); }, 160); } });
    li.addEventListener('focusin', function () { if (desktop()) open(li); });
    li.addEventListener('focusout', function (e) { if (desktop() && !li.contains(e.relatedTarget)) closeAll(null); });
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
  if (scrim) scrim.addEventListener('click', function () { closeAll(null); });

  var burger = $('[data-burger]');
  function closeNav() { d.body.classList.remove('nav-open'); if (burger) burger.setAttribute('aria-expanded', 'false'); }
  if (burger) {
    burger.addEventListener('click', function () {
      var on = !d.body.classList.contains('nav-open');
      if (on) {
        var hb = header ? header.getBoundingClientRect().bottom : 64;
        d.documentElement.style.setProperty('--hdr-bottom', Math.max(0, hb) + 'px');
      }
      d.body.classList.toggle('nav-open', on);
      burger.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  }
  window.addEventListener('resize', function () { if (desktop()) closeNav(); });

  /* Reveal on scroll with sibling stagger */
  var reveals = $$('[data-reveal]');
  reveals.forEach(function (el) {
    var sibs = $$('[data-reveal]', el.parentNode).filter(function (s) { return s.parentNode === el.parentNode; });
    var i = sibs.indexOf(el);
    if (i > 0) el.style.setProperty('--d', Math.min(i, 6) * 0.08 + 's');
  });
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
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
    steps.forEach(function (s, i) { s.addEventListener('click', function () { setStep(i); }); });
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

  /* Cursor glow on cards + magnetic buttons */
  if (finePointer) {
    $$('[data-glow]').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
    if (!reduce) {
      $$('[data-magnetic]').forEach(function (el) {
        el.addEventListener('pointermove', function (e) {
          var r = el.getBoundingClientRect();
          var x = (e.clientX - r.left - r.width / 2) * 0.18, y = (e.clientY - r.top - r.height / 2) * 0.3;
          el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        });
        el.addEventListener('pointerleave', function () { el.style.transform = ''; });
      });
    }
  }

  /* GSAP: hero intro, parallax and scroll scrubbing */
  function initGsap() {
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
        if (n.nodeType === 3) {
          n.textContent.split(/\s+/).filter(Boolean).forEach(function (word) { unit(d.createTextNode(word)); });
        } else unit(n);
      });
      h1.textContent = '';
      h1.appendChild(frag);
      gsap.from('[data-split] .w > span', { yPercent: 115, rotate: 3, duration: 1, ease: 'power4.out', stagger: 0.06, delay: 0.1 });
    }

    gsap.from('.hero-art', { y: 60, opacity: 0, scale: 0.96, duration: 1.2, ease: 'power3.out', delay: 0.25 });

    if (window.ScrollTrigger) {
      gsap.utils.toArray('.hero .orb').forEach(function (o, i) {
        gsap.to(o, { yPercent: (i % 2 ? -1 : 1) * 40, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      });
      gsap.to('.hero-art', { yPercent: -6, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      gsap.utils.toArray('.bento-art, .frenzy-art, .auto-art, .orbit-art').forEach(function (el) {
        gsap.fromTo(el, { yPercent: 4 }, { yPercent: -4, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    }

    var heroArt = $('[data-parallax]');
    if (heroArt && finePointer) {
      var qx = gsap.quickTo(heroArt, 'rotationY', { duration: 0.8, ease: 'power3' });
      var qy = gsap.quickTo(heroArt, 'rotationX', { duration: 0.8, ease: 'power3' });
      gsap.set(heroArt, { transformPerspective: 1200 });
      window.addEventListener('pointermove', function (e) {
        qx((e.clientX / window.innerWidth - 0.5) * 6);
        qy(-(e.clientY / window.innerHeight - 0.5) * 5);
      });
    }
  }
  if (d.readyState === 'complete') initGsap(); else window.addEventListener('load', initGsap);
})();
