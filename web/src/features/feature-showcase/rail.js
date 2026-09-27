import { gsap } from 'gsap';

/* --- CH 02: the infinite drag rail -------------------------------------
   The headline promises the loop repeats forever, so the carousel is that
   loop. One offset is the single source of truth: drag, flick, wheel and
   arrow keys all write to it, and the wrap is plain modular arithmetic
   against one set's width — which is why there is no seam and no slide
   index to fall out of sync. Page scroll deliberately does not.

   Tilt is velocity, not position. The faster the offset is moving, the
   harder the cards turn away from the direction of travel.
   When everything stops, the lean is handed to an elastic tween so it
   overshoots home rather than sliding there. That overshoot is the bounce.
   ----------------------------------------------------------------------- */
export function initRail(opts) {
  var paintFeature = opts.paintFeature;       // from feature-tabs.js
  var setSwapHandler = opts.setSwapHandler;   // from feature-tabs.js
  var cursorEl = opts.cursor.el;              // from cursor.js
  var fine = opts.cursor.fine;

  var rail = document.getElementById('rail');
  var track = document.getElementById('railTrack');
  if (!rail || !track) return;

  var FRICTION    = 0.90;  // per-frame decay once you let go
  var MIN_VEL     = 0.05;  // below this the throw is over
  var THROW_MAX   = 95;    // px/frame ceiling — past this a flick is a jump
  // Magnet. Once a throw has slowed to walking pace the nearest card pulls
  // it in and keeps pulling until the deck sits exactly on the slot. That
  // exactness is the point: the depth-of-field blur is a function of
  // distance from centre, so only a card at dead centre is truly crisp.
  var MAGNET_VEL  = 16;    // px/frame below which the nearest card grabs
  var MAGNET_PULL = 0.18;  // spring constant toward the slot
  var MAGNET_DAMP = 0.58;  // velocity retained per frame while it pulls
  var TILT_PER_PX = 0.62;  // velocity -> degrees
  var TILT_MAX    = 24;
  var SPIN_PEAK   = 96;    // px/frame at the top of a feature swap
  var SPIN_TILT_MAX = 38;  // a swap may lean further than a drag ever does

  var cards = [];
  var setW = 0, halfRail = 1, pitch = 1, firstCentre = 0;

  // Deck geometry. SPREAD under 1 is what makes it a spread deck rather
  // than a row: each card is pulled back toward the middle by that fraction
  // of its distance from it, so they overlap and the centre one sits on top.
  var SPREAD = 0.58;   // 1 = no overlap, 0 = a single pile
  // SPREAD compresses travel, so a card moves SPREAD px on screen for every
  // px of drag. Dividing it back out is what makes the deck follow the
  // pointer exactly instead of lagging behind it by that fraction.
  var dragGain = 1 / SPREAD;
  var FAN    = 4.2;    // degrees of rotation per card-width from centre
  var RISE   = 9;      // px each card drops per card-width from centre
  var SHRINK = 0.085;  // scale lost per card-width from centre
  // Depth of field. Without it every card in the deck keeps its headline
  // perfectly sharp and five of them compete at once; blurring by distance
  // is what leaves exactly one card being read.
  var DOF    = 2.2;    // px of blur per card-width from centre
  var DOF_MAX = 6;
  var DOF_FLAT = 0.14; // card-widths around centre that stay perfectly sharp
  // FADE * TCAP must be >= 1: a card has to reach zero opacity BEFORE it is
  // culled, or it pops out of a deck it was still covering.
  var FADE   = 0.31;   // opacity lost per card-width from centre
  var TCAP   = 3.3;    // beyond this many card-widths a card is not drawn

  var offset = 0, vel = 0, dragDelta = 0, lastX = 0;
  var T = { v: 0 };                  // the lean, in degrees
  var spin = { v: 0 };               // phase 1 of a swap: free spin, px/frame
  var glide = { o: 0 };              // phase 2: a measured distance, so it
  var glideLast = 0, gliding = false;// can stop exactly on the first card
  var dragging = false, pointerId = null, settle = null;
  var spinTl = null, pendingFeature = null;
  var dirty = true;

  function spinning() { return spinTl !== null; }

  // Re-derives the real card set from whatever is in the track, drops any
  // stale clones, then clones until the track is wide enough that wrapping
  // by exactly one set-width can never expose an edge. Self-healing, so a
  // feature swap only has to replace the cards and call this.
  function cloneCard(el) {
    var c = el.cloneNode(true);
    c.setAttribute('data-clone', '');
    c.setAttribute('aria-hidden', 'true');
    return c;
  }

  function stock() {
    var kids = Array.prototype.slice.call(track.children);
    var base = [];
    kids.forEach(function (el) {
      if (el.hasAttribute('data-clone')) el.remove(); else base.push(el);
    });

    setW = base.reduce(function (w, el) {
      var cs = getComputedStyle(el);
      return w + el.offsetWidth + parseFloat(cs.marginLeft) + parseFloat(cs.marginRight);
    }, 0);
    if (!setW) return;

    halfRail = Math.max(rail.clientWidth / 2, 1);
    pitch = setW / base.length;
    // A narrow rail shows one card at a time, so it wants far less overlap
    // and a flatter fan — otherwise the neighbours bury the focused card.
    var narrow = rail.clientWidth < 620;
    SPREAD = narrow ? 0.84 : 0.58;
    dragGain = 1 / SPREAD;
    FAN    = narrow ? 2.4  : 4.2;
    RISE   = narrow ? 6    : 9;

    // One clone set LEADS the base set so the left of the deck is always
    // populated, at rest and at every wrap.
    var lead = document.createDocumentFragment();
    base.forEach(function (el) { lead.appendChild(cloneCard(el)); });
    track.insertBefore(lead, base[0]);

    // Rest position centres the base set's first card: it is the one in
    // focus whenever the rail is at rest or has just been handed a feature.
    firstCentre = base[0].offsetLeft + base[0].offsetWidth / 2;

    // How far out a card can still be seen once SPREAD has pulled it in —
    // compression means cards from further away in layout reach the screen.
    var reach = Math.min(TCAP * pitch, (halfRail + pitch) / SPREAD);
    var sets = Math.max(3, Math.ceil((firstCentre + setW + reach) / setW) + 1);
    for (var n = 2; n < sets; n++) {
      base.forEach(function (el) { track.appendChild(cloneCard(el)); });
    }

    cards = Array.prototype.slice.call(track.children);
    dirty = true;
  }

  // Visibility and stacking are only written when they actually change —
  // both force style work the per-frame transform does not.
  function setVis(c, on) {
    if (c._vis === on) return;
    c._vis = on;
    c.style.visibility = on ? '' : 'hidden';
  }
  function setZ(c, z) {
    if (c._z === z) return;
    c._z = z;
    c.style.zIndex = z;
  }

  function render() {
    if (!setW) return;
    // Rest position (offset a whole number of set-widths) leaves the base
    // set's first card dead centre — the focused card of the deck.
    var w = ((offset % setW) + setW) % setW;
    var x = halfRail - firstCentre - w;
    track.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0)';

    var lean = T.v;

    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var d = c.offsetLeft + c.offsetWidth / 2 + x - halfRail;  // px from centre
      var t = d / pitch;                                        // in card-widths
      var a = t < 0 ? -t : t;

      if (a > TCAP) {
        if (c._vis !== false && c.style.filter) c.style.filter = '';
        setVis(c, false);
        continue;
      }
      setVis(c, true);

      c.style.transform =
        'translate3d(' + ((SPREAD - 1) * d).toFixed(1) + 'px,' +
                         (a * RISE).toFixed(1) + 'px,0)' +
        ' rotate(' + (t * FAN - lean * 0.3).toFixed(2) + 'deg)' +
        ' scale(' + (1 - a * SHRINK).toFixed(4) + ')';
      c.style.opacity = Math.max(0, 1 - a * FADE).toFixed(3);
      var b = (a - DOF_FLAT) * DOF;
      c.style.filter = b < 0.05 ? '' : 'blur(' + Math.min(b, DOF_MAX).toFixed(2) + 'px)';
      setZ(c, 200 - Math.round(a * 20));
    }
  }

  function tick() {
    if (dragging) {
      vel = dragDelta * dragGain;
      dragDelta = 0;
    } else {
      vel *= FRICTION;
      if (Math.abs(vel) < MIN_VEL) vel = 0;

      // The magnet. It is deliberately not gated on a gesture flag: however
      // the deck came to be off-centre — a throw, a wheel, a key — it
      // belongs on a card, so it goes there.
      if (pitch && !gliding && !spinning() && Math.abs(vel) < MAGNET_VEL) {
        var gap = Math.round(offset / pitch) * pitch - offset;
        vel = vel * MAGNET_DAMP + gap * MAGNET_PULL;
        if (Math.abs(gap) < 0.4 && Math.abs(vel) < 0.4) {
          offset += gap;      // land exactly on the slot, so a === 0
          vel = 0;
          dirty = true;
        }
      }
    }
    if (vel > THROW_MAX) vel = THROW_MAX;
    else if (vel < -THROW_MAX) vel = -THROW_MAX;

    // At rest the rail is genuinely still — no drift — so there is nothing
    // to draw either. `dirty` is what guarantees the one render that still
    // has to happen after a swap, a resize, or a settle's last frame.
    // Phase 2 of a swap moves by position, not velocity, so its per-frame
    // delta is read back out here and fed the lean like any other push.
    var spinPush = gliding ? (glide.o - glideLast) : spin.v;
    if (gliding) glideLast = glide.o;

    var moving = dragging || vel !== 0 || spinPush !== 0 || gliding || settle !== null;
    if (!moving && !dirty && Math.abs(T.v) <= 0.02) return;
    if (!moving && Math.abs(T.v) <= 0.02) T.v = 0;

    offset += vel + spinPush;

    // A swap spin may lean harder than a hand ever could — that extra
    // angle is what separates "it span" from "someone flicked it".
    var cap = spinning() ? SPIN_TILT_MAX : TILT_MAX;
    var target = (vel + spinPush) * TILT_PER_PX;
    if (target > cap) target = cap;
    else if (target < -cap) target = -cap;

    // A grab outranks a spring already in flight. A *decaying* throw does
    // not — once you let go the lean belongs to the spring, while the track
    // keeps gliding underneath.
    if (settle && dragging) { settle.kill(); settle = null; }

    if (!settle) {
      T.v += (target - T.v) * 0.17;
      // Lean with the motion now stopped: same spring.
      if (!dragging && Math.abs(target) < 0.35 && Math.abs(T.v) > 1.2) startSettle();
    }
    render();
    dirty = false;
  }

  // The bounce. `elastic.out` from wherever the lean happens to be carries
  // it through upright and back a couple of times before it rests.
  function startSettle() {
    if (settle) settle.kill();
    settle = gsap.to(T, {
      v: 0, duration: 1.05, ease: 'elastic.out(1, 0.34)',
      onComplete: function () { settle = null; }
    });
  }

  /* --- feature swap: spin hard, change the cards at the blur, settle ----
     The cards are replaced at 0.42 — fast enough and blurred enough that
     the substitution is never seen, which is the whole trick. The spring
     is handed the lean at 0.62, while the spin is still winding down, so
     there is a real angle left to bounce out of. ------------------------- */
  function spinTo(key) {
    // A second click mid-spin: apply the swap the killed timeline still
    // owed, so what is on screen always matches the selected tab.
    if (spinTl) {
      spinTl.kill();
      gsap.killTweensOf(glide);
      gliding = false;
      spin.v = 0;
      if (pendingFeature) { paintFeature(pendingFeature); offset = 0; stock(); }
    }
    if (settle) { settle.kill(); settle = null; }
    pendingFeature = key;
    vel = 0;

    var blur = { b: 0 };
    var paint = function () {
      track.style.filter = blur.b > 0.05 ? 'blur(' + blur.b.toFixed(2) + 'px)' : '';
    };

    spinTl = gsap.timeline({
      onComplete: function () { spinTl = null; spin.v = 0; track.style.filter = ''; }
    });
    spinTl
      .to(spin, { v: SPIN_PEAK, duration: 0.26, ease: 'power2.in' }, 0)
      .to(blur, { b: 5, duration: 0.26, ease: 'power2.in', onUpdate: paint }, 0)
      .add(function () {
        paintFeature(key);
        offset = 0;
        stock();               // the new set's width is known from here
        spin.v = 0;

        // Glide a whole number of set-widths so the deceleration ends on
        // card one. Anything shorter than `reach` would stop too abruptly
        // to read as a spin winding down.
        var reach = SPIN_PEAK * 7;
        var over = setW ? ((-reach % setW) + setW) % setW : 0;
        glide.o = 0; glideLast = 0; gliding = true;
        gsap.to(glide, {
          o: reach + over, duration: 0.56, ease: 'power3.out',
          onComplete: function () {
            gliding = false;
            glideLast = glide.o;   // the tween's last frame is applied, not dropped
            if (setW) offset = Math.round(offset / setW) * setW;
            dirty = true;
          }
        });

        render();
        pendingFeature = null;
      }, 0.42)
      .to(blur, { b: 0, duration: 0.46, ease: 'power2.out', onUpdate: paint }, 0.42)
      .add(startSettle, 0.66);
  }
  setSwapHandler(spinTo);

  /* --- input ----------------------------------------------------------- */
  function onDown(e) {
    if (spinning()) return;          // a swap owns the rail for its one second
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true; dragDelta = 0; lastX = e.clientX; pointerId = e.pointerId;
    try { rail.setPointerCapture(pointerId); } catch (err) { /* capture is a nicety */ }
    rail.classList.add('is-dragging');
    cursorEl.classList.add('is-dragging');
    if (settle) { settle.kill(); settle = null; }
  }
  function onMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    var dx = e.clientX - lastX;
    lastX = e.clientX;
    dragDelta -= dx;
  }
  function onUp(e) {
    if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
    dragging = false;
    // tick() only reads the drag while it is still going, so a drag that
    // ends before the next frame (a quick flick, a slow device) would be
    // dropped whole. Whatever it has not read yet is applied here.
    if (dragDelta) {
      offset += dragDelta * dragGain;
      dragDelta = 0;
      dirty = true;
    }
    try { rail.releasePointerCapture(pointerId); } catch (err) { /* already gone */ }
    pointerId = null;
    rail.classList.remove('is-dragging');
    cursorEl.classList.remove('is-dragging');
    // Let go at the top of the lean — that is the moment worth springing from.
    if (Math.abs(T.v) > 1.2) startSettle();
    // Pointer capture defers pointerleave, so the hover state is settled here.
    if (!rail.matches(':hover')) cursorEl.classList.remove('is-drag');
  }

  rail.addEventListener('pointerdown', onDown);
  rail.addEventListener('pointermove', onMove);
  rail.addEventListener('pointerup', onUp);
  rail.addEventListener('pointercancel', onUp);
  rail.addEventListener('dragstart', function (e) { e.preventDefault(); });

  // Horizontal trackpad swipes drive the rail; vertical ones stay the page's.
  rail.addEventListener('wheel', function (e) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    offset += e.deltaX * dragGain;
    vel = e.deltaX * 0.5 * dragGain;
  }, { passive: false });

  // Arrow keys reuse the same physics, so a keyboard flick tilts and bounces.
  rail.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    if (settle) { settle.kill(); settle = null; }
    vel += e.key === 'ArrowRight' ? 20 : -20;
  });

  if (fine) {
    rail.addEventListener('pointerenter', function () { cursorEl.classList.add('is-drag'); });
    rail.addEventListener('pointerleave', function () {
      if (dragging) return;
      cursorEl.classList.remove('is-drag');
      cursorEl.classList.remove('is-dragging');
    });
  }

  /* --- go -------------------------------------------------------------- */
  rail.classList.add('is-live');   // hands the scroller over to the script
  stock();
  render();
  gsap.ticker.add(tick);

  window.addEventListener('resize', function () { stock(); render(); });
  // WebKit can run this before any page CSS applies (it holds style back
  // while the font stylesheet loads), so measure again once it all has.
  if (document.readyState !== 'complete') {
    window.addEventListener('load', function () { stock(); render(); }, { once: true });
  }
}
