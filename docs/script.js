// Carousels (reviews + LinkedIn): mouse drag-to-scroll that settles on the nearest card,
// the reviews slider, and the LinkedIn prev/next carets. Touch and trackpads scroll natively.
(function () {
  const GAP = 12; // space between cards (var(--stasis-spacing-md))
  const scrollers = {};
  document.querySelectorAll('[data-scroller]').forEach((el) => {
    scrollers[el.dataset.scroller] = el;
  });

  const maxScroll = (track) => Math.max(0, track.scrollWidth - track.clientWidth);
  const cardStep = (track) => {
    const card = track.querySelector('article') || track.firstElementChild;
    return card ? card.getBoundingClientRect().width + GAP : track.clientWidth * 0.8;
  };

  // Shared drag behaviour for one scrolling row. Returns start/end hooks so other
  // controls (the reviews slider) can use the same "follow, then settle" behaviour.
  const makeDraggable = (track) => {
    // Scroll position that puts the card nearest to the current position at the row's start
    const nearestCardLeft = () => {
      const pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
      const trackLeft = track.getBoundingClientRect().left;
      const max = maxScroll(track);
      let best = track.scrollLeft, bestDist = Infinity;
      track.querySelectorAll('article').forEach((card) => {
        const target = Math.min(max, Math.max(0, track.scrollLeft + card.getBoundingClientRect().left - trackLeft - pad));
        const dist = Math.abs(target - track.scrollLeft);
        if (dist < bestDist) { best = target; bestDist = dist; }
      });
      return best;
    };

    // While dragging, snapping is off so the row follows the pointer 1:1;
    // on release, glide to the nearest card and then switch snapping back on.
    let settleTimer;
    const startDrag = () => { clearTimeout(settleTimer); track.classList.add('is-dragging'); };
    const endDrag = () => {
      track.scrollTo({ left: nearestCardLeft(), behavior: 'smooth' });
      settleTimer = setTimeout(() => track.classList.remove('is-dragging'), 450);
    };

    // Mouse / pen dragging of the row itself
    let drag = null;
    let suppressClick = false;
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      drag = { x: e.clientX, left: track.scrollLeft, moved: false, id: e.pointerId };
    });
    track.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 4) return;   // tiny jitters still count as a click
      if (!drag.moved) {
        drag.moved = true;
        track.setPointerCapture(drag.id);             // capture only once it is a real drag, so links still click
        startDrag();
      }
      track.scrollLeft = drag.left - dx;
    });
    const release = () => {
      if (!drag) return;
      const wasDrag = drag.moved;
      drag = null;
      if (wasDrag) { suppressClick = true; endDrag(); }
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
    // A drag that ends on a "View post" link must not also open the link
    track.addEventListener('click', (e) => {
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; }
    }, true);
    // Stop images/links from being picked up by the browser's own drag-and-drop
    track.addEventListener('dragstart', (e) => e.preventDefault());

    return { startDrag, endDrag };
  };

  const dragHooks = {};
  Object.entries(scrollers).forEach(([name, track]) => { dragHooks[name] = makeDraggable(track); });

  // Reviews slider: drag the thumb, click the track to jump, or use arrow keys / Home / End
  const reviews = scrollers.reviews;
  const bar = document.querySelector('[data-progress="reviews"]');
  const slider = document.querySelector('[data-slider="reviews"]');
  if (reviews && bar && slider) {
    const { startDrag, endDrag } = dragHooks.reviews;
    const travel = () => slider.clientWidth - bar.offsetWidth; // how far the 60px thumb can move (100px)
    // When the continuous ticker has added its hidden copies, one "lap" is the width of the
    // original set of reviews and the slider wraps with the loop; otherwise it spans the row.
    const firstClone = () => reviews.querySelector('.review--clone');
    const span = () => {
      const clone = firstClone();
      if (!clone) return maxScroll(reviews);
      return clone.offsetLeft - reviews.querySelector('.review').offsetLeft;
    };

    // Keep the thumb in step with the row
    const update = () => {
      const s = span();
      let ratio = 0;
      if (s > 0) ratio = firstClone() ? (reviews.scrollLeft % s) / s : Math.min(1, reviews.scrollLeft / s);
      bar.style.transform = `translateX(${ratio * travel()}px)`;
      slider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    };
    reviews.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();

    let thumb = null;
    const scrollToThumb = (thumbX) => {
      const t = travel();
      const ratio = t > 0 ? Math.min(1, Math.max(0, thumbX / t)) : 0;
      reviews.scrollLeft = ratio * span();
    };
    slider.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = slider.getBoundingClientRect();
      const thumbLeft = new DOMMatrixReadOnly(getComputedStyle(bar).transform).m41;
      // grabbing the thumb keeps the grab point; clicking the track centres the thumb on the click
      const grabOffset = e.target === bar ? e.clientX - rect.left - thumbLeft : bar.offsetWidth / 2;
      thumb = { rectLeft: rect.left, grabOffset };
      slider.setPointerCapture(e.pointerId);
      slider.classList.add('is-dragging');
      startDrag();
      scrollToThumb(e.clientX - rect.left - grabOffset);
      // Focused for the arrow keys, but marked as mouse focus: the pointerdown default is prevented,
      // so browsers treat this scripted focus like keyboard focus and would draw the outline.
      slider.dataset.pointerFocus = '';
      slider.focus({ preventScroll: true, focusVisible: false });
    });
    slider.addEventListener('blur', () => delete slider.dataset.pointerFocus);
    slider.addEventListener('pointermove', (e) => {
      if (thumb) scrollToThumb(e.clientX - thumb.rectLeft - thumb.grabOffset);
    });
    const releaseSlider = () => {
      if (!thumb) return;
      thumb = null;
      slider.classList.remove('is-dragging');
      endDrag();
    };
    slider.addEventListener('pointerup', releaseSlider);
    slider.addEventListener('pointercancel', releaseSlider);

    slider.addEventListener('keydown', (e) => {
      delete slider.dataset.pointerFocus; // keyboard in use: show the focus outline again
      const step = cardStep(reviews);
      const moves = { ArrowRight: step, ArrowDown: step, ArrowLeft: -step, ArrowUp: -step };
      if (e.key in moves) reviews.scrollBy({ left: moves[e.key], behavior: 'smooth' });
      else if (e.key === 'Home') reviews.scrollTo({ left: 0, behavior: 'smooth' });
      // End = the last real review (not the hidden loop copies)
      else if (e.key === 'End') reviews.scrollTo({ left: firstClone() ? span() - step : maxScroll(reviews), behavior: 'smooth' });
      else return;
      e.preventDefault();
    });
  }

  // Prev / next carets: one card per click; each is disabled at its end of the row
  // (both are disabled when every card already fits on screen)
  const buttons = document.querySelectorAll('[data-scroll]');
  const sync = (name) => {
    const el = scrollers[name];
    if (!el) return;
    const max = maxScroll(el) - 1;
    buttons.forEach((b) => {
      if (b.dataset.scroll !== name) return;
      b.disabled = b.dataset.dir === '-1' ? el.scrollLeft <= 0 : el.scrollLeft >= max;
    });
  };
  const synced = new Set();
  buttons.forEach((btn) => {
    const name = btn.dataset.scroll;
    const el = scrollers[name];
    if (!el) return;
    btn.addEventListener('click', () => {
      el.scrollBy({ left: cardStep(el) * Number(btn.dataset.dir), behavior: 'smooth' });
    });
    if (synced.has(name)) return;
    synced.add(name);
    el.addEventListener('scroll', () => sync(name), { passive: true });
    window.addEventListener('resize', () => sync(name));
    window.addEventListener('load', () => sync(name)); // images can change the row's width
    sync(name);
  });
})();

// Nav search: icon click expands the field leftward; icon click again (empty), Escape,
// or a click outside collapses it. With text typed, the icon submits the search.
(function () {
  const form = document.querySelector('[data-search]');
  if (!form) return;
  const input = form.querySelector('.nav-search__input');
  const btn = form.querySelector('.nav-search__btn');
  const slot = form.closest('.nav-search-slot');
  const actions = form.closest('.nav__actions');
  const wrap = form.closest('.nav__wrap');
  const FULL = 300;   // Figma "Expand" width
  const CLEAR = 24;   // minimum space kept between the open field and the nav links
  const CLOSED = 44;

  // Right edge of whatever sits left of the actions group (the links, or the logo when links are hidden)
  const leftNeighbourRight = () => {
    let right = wrap.getBoundingClientRect().left;
    [...wrap.children].forEach((child) => {
      if (child === actions || getComputedStyle(child).display === 'none') return;
      right = Math.max(right, child.getBoundingClientRect().right);
    });
    return right;
  };

  // Decide how to open, measured with the slot at its closed 44px width.
  // The field always grows out of the slot's right edge (which never moves). If the empty space
  // beside the links already fits it, nothing else moves. If not, the slot widens by just enough
  // to slide the links over by the shortfall — no further.
  const layout = () => {
    slot.classList.remove('is-pushing');
    slot.style.removeProperty('--slot-w');
    const free = slot.getBoundingClientRect().right - leftNeighbourRight() - CLEAR; // fits without moving anything

    // In the space-between row, a visible middle group (the links) moves by half of any growth
    // in the slot; with the links hidden, nothing on the left moves at all.
    const links = [...wrap.children].filter((c) => c !== actions && getComputedStyle(c).display !== 'none');
    const shift = links.length > 1 ? 0.5 : 0;

    // How far the slot could grow before the row runs out of space
    const cs = getComputedStyle(wrap);
    const inner = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const gap = parseFloat(cs.columnGap) || 0;
    const used = [...wrap.children]
      .filter((c) => getComputedStyle(c).display !== 'none')
      .reduce((sum, c) => sum + c.getBoundingClientRect().width, 0);
    const slack = Math.max(0, inner - used - gap * (links.length));

    const width = Math.max(160, Math.min(FULL, Math.floor(free + shift * slack)));
    const shortfall = Math.max(0, width - free);
    const slotWidth = shift && shortfall ? Math.ceil(CLOSED + shortfall / shift) : CLOSED;
    return { width, slotWidth };
  };

  const applyLayout = () => {
    const { width, slotWidth } = layout();
    slot.style.setProperty('--search-open-w', width + 'px');
    slot.style.setProperty('--slot-w', slotWidth + 'px');
    slot.classList.toggle('is-pushing', slotWidth > CLOSED);
  };

  const setOpen = (open) => {
    if (open) {
      actions.classList.add('is-searching'); // lets phones hide Contact Us before measuring
      applyLayout();
    } else {
      actions.classList.remove('is-searching');
      slot.classList.remove('is-pushing');
    }
    form.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Search' : 'Open search');
    input.tabIndex = open ? 0 : -1;
    if (open) input.focus({ preventScroll: true });
    else { input.value = ''; input.blur(); }
  };
  const isOpen = () => form.classList.contains('is-open');

  btn.addEventListener('click', () => {
    if (!isOpen()) return setOpen(true);
    if (input.value.trim()) return form.requestSubmit();
    setOpen(false);
  });
  form.addEventListener('submit', (e) => { if (!input.value.trim()) e.preventDefault(); });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { setOpen(false); btn.focus(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !form.contains(e.target) && !input.value.trim()) setOpen(false);
  });
  window.addEventListener('resize', () => { if (isOpen()) applyLayout(); });
})();

// Mobile / tablet menu (below 1180px): the hamburger opens a panel with search + the links.
// Closes on the toggle, Escape, choosing a link, or widening past the breakpoint.
(function () {
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('mobile-menu');
  if (!toggle || !menu) return;
  const BREAKPOINT = window.matchMedia('(max-width: 1180px)');
  const focusables = () => [...menu.querySelectorAll('input, button, a[href]')];
  let closeTimer;

  const open = () => {
    clearTimeout(closeTimer);
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open')); // let it render before fading in
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close menu');
    document.documentElement.classList.add('menu-open');
  };
  const close = ({ restoreFocus = true } = {}) => {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    document.documentElement.classList.remove('menu-open');
    closeTimer = setTimeout(() => { menu.hidden = true; }, 300); // after the fade-out
    if (restoreFocus) toggle.focus({ preventScroll: true });
  };
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';

  toggle.addEventListener('click', () => (isOpen() ? close() : open()));
  // Choosing a link closes the menu (its #anchor still scrolls the page)
  menu.querySelectorAll('.mobile-menu__links a').forEach((a) => a.addEventListener('click', () => close({ restoreFocus: false })));
  // Empty search does nothing; with text it submits as ?q=
  menu.querySelector('.mobile-menu__search').addEventListener('submit', (e) => {
    if (!menu.querySelector('.mobile-menu__input').value.trim()) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { close(); return; }
    // Keep Tab inside the toggle + menu while it is open
    if (e.key === 'Tab') {
      const items = [toggle, ...focusables()];
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  });
  // Widening past the breakpoint hides the hamburger, so close the menu with it
  BREAKPOINT.addEventListener('change', (e) => { if (!e.matches) close({ restoreFocus: false }); });
})();

// Offering cards: reveal one by one the first time the grid scrolls into view (or at load,
// if it is already on screen). The fade itself is CSS; this sets each card's order (--i)
// and adds .is-revealed once.
(function () {
  const grid = document.querySelector('.bento');
  if (!grid) return;
  grid.querySelectorAll('.bento__item').forEach((card, i) => card.style.setProperty('--i', i));
  const reveal = () => grid.classList.add('is-revealed');
  if (!('IntersectionObserver' in window)) { reveal(); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { reveal(); io.disconnect(); }
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }); // start once ~15% is comfortably on screen
  io.observe(grid);
})();

// Reviews ticker: the row drifts continuously to the left (35px/s) and loops forever without a
// jump: a hidden copy of the reviews follows the originals, and once a full set has scrolled
// past, the position quietly steps back by one set width. It stops at once while the pointer is
// over the reviews or slider, while keyboard focus is inside, while dragging/swiping, off screen,
// and in background tabs, then eases back up to speed. Not used for reduced-motion users.
(function () {
  const track = document.querySelector('.reviews__track');
  const slider = document.querySelector('[data-slider="reviews"]');
  if (!track) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion.matches) return; // the row stays a normal, still carousel
  const SPEED = 35;          // px per second
  const RAMP = 0.35;         // seconds to ease back up to full speed
  const RESUME_AFTER_DRAG = 900; // ms: lets a drag's settle-glide finish before drifting again

  // Hidden copy of every review for the seamless loop (ignored by screen readers and Tab)
  const originals = [...track.querySelectorAll('.review')];
  originals.forEach((card) => {
    const copy = card.cloneNode(true);
    copy.classList.add('review--clone');
    copy.setAttribute('aria-hidden', 'true');
    copy.inert = true;
    track.appendChild(copy);
  });
  const lap = () => track.querySelector('.review--clone').offsetLeft - originals[0].offsetLeft;
  track.classList.add('is-ticker'); // turns off card snapping, which would fight the drift

  const state = { hovering: false, focused: false, pressed: false, inView: false, held: false };
  const canPlay = () => !reduceMotion.matches && state.inView && !state.hovering && !state.focused && !state.pressed && !state.held && !document.hidden;

  let pos = track.scrollLeft;  // precise position (scrollLeft rounds)
  let speedFactor = 0;         // 0 → 1 while easing back up
  let last = 0;
  let wasPlaying = false;
  let holdTimer;

  const frame = (now) => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; // cap long frames (tab switches)
    last = now;
    if (canPlay()) {
      if (!wasPlaying) { pos = track.scrollLeft; speedFactor = 0; wasPlaying = true; } // pick up from wherever the user left it
      speedFactor = Math.min(1, speedFactor + dt / RAMP);
      pos += SPEED * speedFactor * dt;
      const l = lap();
      if (l > 0 && pos >= l) pos -= l;                  // seamless loop: the copy looks identical
      track.scrollLeft = pos;
    } else {
      wasPlaying = false;                                // stop immediately; never fight the user
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Manual scrolling past the copies also wraps back, so the row never runs out
  track.addEventListener('scroll', () => {
    if (state.pressed || wasPlaying) return;
    const l = lap();
    if (l > 0 && track.scrollLeft >= l + 1) track.scrollLeft -= l;
  }, { passive: true });

  const set = (flag, value) => { state[flag] = value; };
  [track, slider].filter(Boolean).forEach((el) => {
    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') set('hovering', true); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') set('hovering', false); });
    // Only keyboard focus pauses it; a mouse click/drag also focuses the row but shouldn't
    el.addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible') && !('pointerFocus' in e.target.dataset)) set('focused', true); });
    el.addEventListener('keydown', () => set('focused', true)); // keys after a mouse focus count as keyboard use
    el.addEventListener('focusout', () => set('focused', false));
    el.addEventListener('pointerdown', () => { clearTimeout(holdTimer); set('pressed', true); });
  });
  // Drags and swipes can end anywhere; wait for the settle-glide before drifting again
  const release = () => {
    if (!state.pressed) return;
    set('pressed', false);
    set('held', true);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => set('held', false), RESUME_AFTER_DRAG);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  // Trackpad / wheel scrolling: pause briefly while the user is scrolling
  track.addEventListener('wheel', () => {
    set('held', true);
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => set('held', false), RESUME_AFTER_DRAG);
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => set('inView', entries[0].isIntersecting), { threshold: 0.3 }).observe(track);
  } else {
    set('inView', true);
  }
})();
