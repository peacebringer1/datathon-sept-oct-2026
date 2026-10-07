export function initProjectPages() {
  const filterButtons = [...document.querySelectorAll('[data-hypothesis-filter]')];
  const cards = [...document.querySelectorAll('[data-hypothesis-card]')];

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.hypothesisFilter;
      filterButtons.forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      cards.forEach((card) => {
        const matches = filter === 'all' || card.dataset.hypothesisCard === filter;
        card.hidden = !matches;
      });
    });
  });

  document.querySelectorAll('[data-open-dataset]').forEach((button) => {
    button.addEventListener('click', () => {
      const dataset = button.dataset.openDataset;
      const sidebarItem = document.getElementById(`nav${dataset.toUpperCase()}`);
      window.switchSubSection?.(dataset, sidebarItem || button);
    });
  });
}

document.addEventListener('DOMContentLoaded', initProjectPages);
