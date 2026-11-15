// Presentation only: keep the existing controls mounted and preserve their state.
export function setupPanels(onResize) {
  const workspace = document.querySelector('.workspace');
  const panel = document.getElementById('panel');
  const title = document.getElementById('panel-title');
  const content = panel.querySelector('.panel-content');
  const links = [...document.querySelectorAll('.bottom-nav a')];
  const titles = { points: 'Puntos', planner: 'Planificar', plans: 'Planes', layers: 'Capas' };
  let active = 'visor';

  function openPanel(tab, focusHeading = false) {
    if (tab !== 'visor' && !titles[tab]) return;
    active = tab;
    const isOpen = tab !== 'visor';
    if (!isOpen && panel.contains(document.activeElement)) links[0].focus({ preventScroll: true });
    panel.inert = !isOpen;
    workspace.classList.toggle('panel-open', isOpen);
    panel.querySelectorAll('[data-panel]').forEach(section => {
      section.hidden = !section.dataset.panel.split(' ').includes(tab);
    });
    if (isOpen) title.textContent = titles[tab];
    content.scrollTop = 0;
    links.forEach(link => {
      const selected = link.hash === `#${tab}`;
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
      if (link.hash !== '#visor') {
        link.setAttribute('aria-controls', 'panel');
        link.setAttribute('aria-expanded', String(selected && isOpen));
      }
    });
    document.querySelectorAll('a[href="#layers"]').forEach(link => {
      link.setAttribute('aria-controls', 'panel');
      link.setAttribute('aria-expanded', String(tab === 'layers'));
    });
    if (focusHeading && isOpen) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
    onResize();
  }

  document.querySelectorAll('.bottom-nav a, a[href="#layers"]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      openPanel(link.hash.slice(1), event.detail === 0);
    });
  });
  panel.querySelector('.panel-close').addEventListener('click', () => openPanel('visor'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active !== 'visor') openPanel('visor');
  });
  openPanel('visor');
  new ResizeObserver(onResize).observe(document.querySelector('.map-wrap'));
}
