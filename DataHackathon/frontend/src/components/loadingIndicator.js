const activeLoads = new Map();
let sequence = 0;
const PAGE_SELECTORS = ['#datasetViewSection', '#populationHypothesesSection', '#aboutProjectSection', '#householdSection', '#dataAnalyzerSection', '#detailedViewSection', '#mainDashboardContent'];
const STAGGER_SELECTORS = '.dataset-page-header, .dataset-filter-panel, .dataset-stat-grid, .dataset-panel, .d006-chart-panel, .d002-question-card, .home-category-card, .table-section, .summary-card-box, .household-radar-card, .hypothesis-card, .about-team-card, .about-university-card';

function visiblePage() {
  return PAGE_SELECTORS.map((selector) => document.querySelector(selector)).find((element) =>
    element && !element.hidden && getComputedStyle(element).display !== 'none'
  );
}

function staggerPageElements(page, className) {
  if (!page) return [];
  page.classList.add(className);
  const children = [...page.querySelectorAll(STAGGER_SELECTORS)]
    .filter((element) => !element.hidden && getComputedStyle(element).display !== 'none')
    .slice(0, 8);
  children.forEach((element, index) => element.style.setProperty('--page-order', index));
  return children;
}

export async function transitionAppPage(changePage) {
  const outgoing = visiblePage();
  const outgoingItems = staggerPageElements(outgoing, 'page-stage-out');
  if (outgoingItems.length) await new Promise((resolve) => setTimeout(resolve, 390));

  let task;
  let incoming;
  let incomingItems = [];
  try {
    task = changePage();
    incoming = visiblePage();
    incomingItems = staggerPageElements(incoming, 'page-stage-in');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return await task;
  } finally {
    outgoing?.classList.remove('page-stage-out');
    outgoingItems.forEach((element) => element.style.removeProperty('--page-order'));
    setTimeout(() => {
      incoming?.classList.remove('page-stage-in');
      incomingItems.forEach((element) => element.style.removeProperty('--page-order'));
    }, 1200);
  }
}

function render() {
  const overlay = document.getElementById('appLoadingOverlay');
  const message = document.getElementById('appLoadingMessage');
  if (!overlay) return;

  const visibleLoads = [...activeLoads.values()].filter((load) => load.visible);
  if (visibleLoads.length) {
    const latestMessage = visibleLoads.at(-1)?.label;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-visible');
    if (message) message.textContent = latestMessage;
    return;
  }

  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
}

export function startAppLoading(label = 'Загружаем…') {
  const id = ++sequence;
  const load = { label, visible: false, timer: null };
  activeLoads.set(id, load);
  load.timer = setTimeout(() => {
    if (!activeLoads.has(id)) return;
    load.visible = true;
    render();
  }, 5000);

  const finish = () => {
    if (!activeLoads.has(id)) return;
    clearTimeout(load.timer);
    activeLoads.delete(id);
    render();
  };
  finish.update = (nextLabel) => {
    if (!activeLoads.has(id)) return;
    load.label = nextLabel;
    render();
  };
  return finish;
}

window.appLoading = { start: startAppLoading };
