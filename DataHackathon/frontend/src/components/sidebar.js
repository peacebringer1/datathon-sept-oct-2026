export function toggleCategory(headerElement) {
  const group = headerElement.closest('.cat-group');
  if (group) {
    group.classList.toggle('open');
  }
}

export function selectIndicator(indicatorName, event, onFilterChangeCallback) {
  const select = document.getElementById('indicatorSelect');
  if (!select) return;
  
  let optionExists = false;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === indicatorName) {
      select.selectedIndex = i;
      optionExists = true;
      break;
    }
  }

  document.querySelectorAll('.subcat-item').forEach(el => el.classList.remove('active'));
  if (event && event.target) {
    event.target.classList.add('active');
  }

  if (optionExists) {
    onFilterChangeCallback();
  }
}

function highlightMatch(text, query) {
  if (!query) return text;
  const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return text.replace(regex, '<span style="background-color: #bfdbfe; color: #1e3a8a; border-radius: 3px; padding: 0 2px; font-weight: 500;">$1</span>');
}

export function filterCategoriesSidebar() {
  const searchInput = document.getElementById('categorySearchInput');
  if (!searchInput) return;

  const query = searchInput.value.trim().toLowerCase();
  const groups = document.querySelectorAll('.cat-group');

  groups.forEach(group => {
    const headerEl = group.querySelector('.cat-header');
    const subitems = group.querySelectorAll('.subcat-item');
    
    if (!headerEl.dataset.original) {
      headerEl.dataset.original = headerEl.innerText;
    }
    const headerOriginalText = headerEl.dataset.original;

    let groupMatches = false;

    subitems.forEach(item => {
      if (!item.dataset.original) {
        item.dataset.original = item.innerText;
      }
      const itemOriginalText = item.dataset.original;

      const matches = itemOriginalText.toLowerCase().includes(query) || headerOriginalText.toLowerCase().includes(query);

      if (query === '' || matches) {
        item.style.display = 'block';
        item.style.color = 'var(--text-color, #1e293b)'; // Надежный цвет текста без слияния с фоном
        if (query !== '') {
          item.innerHTML = highlightMatch(itemOriginalText, query);
        } else {
          item.innerHTML = itemOriginalText;
        }
        groupMatches = true;
      } else {
        item.style.display = 'none';
        item.innerHTML = itemOriginalText;
      }
    });

    const headerMatches = headerOriginalText.toLowerCase().includes(query);
    if (headerMatches) {
      groupMatches = true;
    }

    if (query !== '' && headerMatches) {
      headerEl.innerHTML = highlightMatch(headerOriginalText, query);
    } else {
      headerEl.innerHTML = headerOriginalText;
    }

    if (groupMatches) {
      group.style.display = 'block';
      if (query !== '') {
        group.classList.add('open');
      } else {
        group.classList.remove('open');
      }
    } else {
      group.style.display = 'none';
    }
  });
}

export function initSidebarSearch() {
  const searchInput = document.getElementById('categorySearchInput');
  if (!searchInput) return;

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      filterCategoriesSidebar();
      searchInput.blur();
    }
  });
}

window.toggleCategory = toggleCategory;
window.filterCategoriesSidebar = filterCategoriesSidebar;