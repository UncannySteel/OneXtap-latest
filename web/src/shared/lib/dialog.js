import '../styles/dialog.css';

/* --- a pop-up window ------------------------------------------------------
   What every window on the site shares (the feedback window, the FAQ,
   sign-in). Any `opts.trigger` button opens it. While it is open everything
   behind it is inert, so nothing but the window can be clicked, tabbed to or
   read out, and the page is held still (html.dlg-open, and onToggle for the
   smooth scroll). Escape, or anything inside it marked [data-dlg-close] (the
   ×, a Cancel, the scrim), closes it, and focus goes back to the button that
   opened it.

   `opts.reset()` runs on every opening, so the window starts fresh, and
   `opts.focus()` returns what takes focus once it is open. */
var STOPS = 'button, input, textarea, select, summary, a[href]';

export function createDialog(root, opts) {
  var open = false, opener = null, held = [], toggled = [];

  // `from` is the button that opened it: Safari does not focus a button on
  // a click, so what has focus is not always what was pressed.
  function setOpen(next, from) {
    if (next === open) return;
    open = next;
    if (open) {
      opener = from || document.activeElement;
      if (opts.reset) opts.reset();
      // Hold everything else inert, remembering what we changed: the closed
      // menu and the other windows are inert already, and have to stay that
      // way afterwards.
      Array.prototype.forEach.call(document.body.children, function (el) {
        if (el === root || el.inert) return;
        el.inert = true;
        held.push(el);
      });
    } else {
      held.forEach(function (el) { el.inert = false; });
      held = [];
    }
    root.inert = !open;
    root.classList.toggle('is-open', open);
    document.documentElement.classList.toggle('dlg-open', open);
    toggled.forEach(function (fn) { fn(open); });
    if (open) opts.focus().focus();
    else if (opener && opener.isConnected) opener.focus();
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var trigger = e.target.closest(opts.trigger);
    if (trigger) setOpen(true, trigger);
    else if (open && root.contains(e.target) && e.target.closest('[data-dlg-close]')) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      wrapTab(e);
      // Safari's Tab skips links unless asked not to, so the stop we took for
      // the last one may not be; if Tab has left the window anyway, it comes
      // back round from the other end.
      if (!e.defaultPrevented) setTimeout(function () {
        var to = ends()[e.shiftKey ? 1 : 0];
        if (open && to && !root.contains(document.activeElement)) to.focus();
      });
    }
  });

  function ends() {
    var stops = Array.prototype.filter.call(root.querySelectorAll(STOPS), function (el) {
      return !el.disabled && el.getClientRects().length > 0;
    });
    return [stops[0], stops[stops.length - 1]];
  }

  // With the page inert, Tab past the window's last control would leave for
  // the browser's own toolbar; it comes round to the first instead (and
  // Shift+Tab the other way).
  function wrapTab(e) {
    var edge = ends(), first = edge[0], last = edge[1];
    if (!first) return;
    var at = document.activeElement;
    if (e.shiftKey && (at === first || !root.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !root.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }

  return {
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    onToggle: function (fn) { toggled.push(fn); }
  };
}
