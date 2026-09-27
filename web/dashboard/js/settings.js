/** Settings dropdown: click/keyboard toggle, arrow-key navigation, outside-click + Esc to close. */
export function initSettings({ root, trigger, menu, onAction }) {
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const isOpen = () => root.hasAttribute('data-open');

  // Numbered for the rows' staggered rise as the menu opens (dashboard.css).
  [...menu.children].forEach((row, i) => row.style.setProperty('--i', i));

  function open(focusIndex = null) {
    root.setAttribute('data-open', '');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    if (focusIndex !== null) items().at(focusIndex)?.focus();
  }

  function close(returnFocus = false) {
    root.removeAttribute('data-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    if (returnFocus) trigger.focus();
  }

  function onOutside(e) {
    if (!root.contains(e.target)) close();
  }

  trigger.addEventListener('click', () => (isOpen() ? close() : open()));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open(e.key === 'ArrowDown' ? 0 : -1);
    }
  });

  root.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    const list = items();
    const i = list.indexOf(document.activeElement);
    const focus = (n) => list[(n + list.length) % list.length].focus();
    switch (e.key) {
      case 'Escape': e.preventDefault(); close(true); break;
      case 'Tab': close(); break;
      case 'ArrowDown': e.preventDefault(); focus(i + 1); break;
      case 'ArrowUp': e.preventDefault(); focus(i < 0 ? -1 : i - 1); break;
      case 'Home': e.preventDefault(); focus(0); break;
      case 'End': e.preventDefault(); focus(-1); break;
    }
  });

  menu.addEventListener('click', (e) => {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    close(true);
    onAction(item.dataset.action);
  });
}
