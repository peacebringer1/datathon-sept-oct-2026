const SEARCHABLE_SELECTOR = [
  '.sidebar-home-link', '.cat-header', '.cat-subitem', '.home-category-card',
  '.dataset-page-header h1', '.dataset-page-header p', '#datasetViewSection h2',
  '#datasetViewSection h3', '#datasetViewSection label', '#datasetViewSection button',
  '#datasetViewSection p', '#datasetViewSection [aria-label]',
  '#datasetViewSection th', '#datasetViewSection td', '#datasetViewSection option',
  '#householdSection h2', '#householdSection h3', '#householdSection button',
  '#householdSection label', '#dataAnalyzerSection h1', '#dataAnalyzerSection h2',
  '#dataAnalyzerSection h3', '#dataAnalyzerSection label', '#dataAnalyzerSection button',
  '#dataAnalyzerSection p', '#populationHypothesesSection h1', '#populationHypothesesSection h2',
  '#populationHypothesesSection h3', '#populationHypothesesSection p', '#populationHypothesesSection button',
  '#aboutProjectSection h1', '#aboutProjectSection h2', '#aboutProjectSection h3',
  '#aboutProjectSection p', '#aboutProjectSection button', '.ai-card h3', '.ai-card p'
].join(',');

const PAGE_DATASETS = ['d002', 'd004', 'd006', 'd008'];

export function toggleCategory(headerElement) {
  headerElement.closest('.cat-group')?.classList.toggle('open');
}

export function selectIndicator(indicatorName, event, onFilterChangeCallback) {
  const select = document.getElementById('indicatorSelect');
  if (!select) return;

  const option = [...select.options].find((item) => item.value === indicatorName);
  if (option) select.value = option.value;
  document.querySelectorAll('.subcat-item').forEach((element) => element.classList.remove('active'));
  event?.target?.classList.add('active');
  if (option) onFilterChangeCallback();
}

function normalized(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function getSearchDataset(element) {
  const directMatch = element.closest('[data-search-dataset]')?.dataset.searchDataset;
  if (directMatch) return directMatch;
  const dashboard = element.closest('[id$="Dashboard"]');
  const id = dashboard?.id.match(/^d(002|004|006|008)Dashboard$/)?.[1];
  return id ? `d${id}` : '';
}

function getSearchRecords(query) {
  const matches = [];
  const seen = new Set();
  const search = normalized(query);
  document.querySelectorAll(SEARCHABLE_SELECTOR).forEach((element) => {
    if (element.closest('#legacyMainDashboardContent')) return;
    const visibleText = (element.textContent || '').replace(/\s+/g, ' ').trim();
    const accessibleText = element.getAttribute('aria-label') || '';
    const text = (element.dataset.searchTerms || accessibleText || visibleText).replace(/\s+/g, ' ').trim();
    const aliases = window.getAppTextVariants?.(`${text} ${visibleText} ${accessibleText}`) || [];
    if (text.length < 2 || text.length > 1200 || ![text, visibleText, accessibleText, ...aliases].some((value) => normalized(value).includes(search))) return;
    const dataset = getSearchDataset(element);
    const title = text.length > 112 ? `${text.slice(0, 109).trimEnd()}…` : text;
    const key = `${dataset}:${normalized(title)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const group = element.closest('.cat-group')?.querySelector('.cat-header')?.textContent.trim();
    matches.push({ element, title, dataset, category: group || (dataset ? dataset.toUpperCase() : 'Раздел приложения') });
  });
  return matches.slice(0, 14);
}

async function openSearchResult(result) {
  const dataset = result.dataset || PAGE_DATASETS.find((id) => result.element.closest(`#${id}Dashboard`));
  if (dataset && window.switchSubSection) {
    const navItem = document.querySelector(`[data-search-dataset="${dataset}"].cat-subitem`) || document.getElementById(`nav${dataset.toUpperCase()}`);
    await window.switchSubSection(dataset, navItem || result.element);
    requestAnimationFrame(() => result.element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return;
  }

  if (result.element.classList.contains('sidebar-home-link')) {
    const section = result.element.id === 'navAboutProject' ? 'about' : 'home';
    await window.switchMainSection?.(section, result.element);
  } else if (result.element.matches('.hypothesis-open')) {
    const dataset = result.element.dataset.openDataset;
    await window.switchSubSection?.(dataset, document.getElementById(`nav${dataset.toUpperCase()}`));
  } else if (result.element.closest('#aboutProjectSection')) {
    await window.switchMainSection?.('about', document.getElementById('navAboutProject'));
    requestAnimationFrame(() => result.element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } else if (result.element.closest('#populationHypothesesSection')) {
    await window.switchMainSection?.('hypotheses', document.querySelector('[data-search-section="hypotheses"]'));
    requestAnimationFrame(() => result.element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } else if (result.element.matches('.cat-header')) {
    const section = result.element.dataset.searchSection || 'household';
    await window.switchMainSection?.(section, result.element);
  } else if (result.element.matches('.home-category-card')) {
    result.element.click();
  } else {
    result.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function renderSearchResults(query) {
  const input = document.getElementById('categorySearchInput');
  const panel = document.getElementById('globalSearchResults');
  if (!input || !panel) return;
  panel.replaceChildren();
  if (!query.trim()) {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    return;
  }

  const records = getSearchRecords(query);
  if (!records.length) {
    const empty = document.createElement('p');
    empty.className = 'sidebar-search-empty';
    empty.textContent = window.translateAppText?.('Совпадений не найдено') || 'Совпадений не найдено';
    panel.append(empty);
  } else {
    records.forEach((record, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sidebar-search-result';
      button.id = `sidebarSearchResult${index}`;
      button.setAttribute('role', 'option');
      const title = document.createElement('span');
      title.className = 'sidebar-search-result-title';
      title.textContent = record.title;
      const category = document.createElement('small');
      category.textContent = record.category;
      button.append(title, category);
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        panel.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        await openSearchResult(record);
      });
      panel.append(button);
    });
  }
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

export function filterCategoriesSidebar() {
  const input = document.getElementById('categorySearchInput');
  if (!input) return;
  const query = normalized(input.value);
  document.querySelectorAll('.cat-group').forEach((group) => {
    const header = group.querySelector('.cat-header');
    const items = [...group.querySelectorAll('.cat-subitem')];
    const headerMatches = normalized(header?.textContent).includes(query);
    let groupMatches = !query || headerMatches;
    items.forEach((item) => {
      const match = !query || headerMatches || normalized(item.textContent).includes(query);
      item.style.display = match ? '' : 'none';
      groupMatches ||= match;
    });
    group.style.display = groupMatches ? '' : 'none';
    group.classList.toggle('open', Boolean(query && groupMatches));
  });
  renderSearchResults(input.value);
}

export function initSidebarSearch() {
  const input = document.getElementById('categorySearchInput');
  const panel = document.getElementById('globalSearchResults');
  if (!input || !panel) return;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      filterCategoriesSidebar();
      input.blur();
    } else if (event.key === 'Enter') {
      const firstResult = panel.querySelector('.sidebar-search-result');
      if (firstResult) {
        event.preventDefault();
        firstResult.click();
      }
    } else if (event.key === 'ArrowDown') {
      panel.querySelector('.sidebar-search-result')?.focus();
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.sidebar-search-box')) {
      panel.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
  });
}

window.toggleCategory = toggleCategory;
window.filterCategoriesSidebar = filterCategoriesSidebar;
