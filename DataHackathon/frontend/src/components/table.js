let currentPage = 1;

export async function loadTablePage(API_BASE_URL) {
  const indicatorEl = document.getElementById('regionIndicatorSelect');
  const searchEl = document.getElementById('searchInput');
  const counterEl = document.getElementById('counter');
  const head = document.getElementById('tableHead');
  const body = document.getElementById('tableBody');

  if (!indicatorEl || !head || !body) return;

  const indicator = indicatorEl.value;
  const search = searchEl ? searchEl.value : '';

  try {
    const res = await fetch(`${API_BASE_URL}/api/table-data?page=${currentPage}&limit=50&indicator=${encodeURIComponent(indicator)}&search=${encodeURIComponent(search)}`);
    const { total, columns, data } = await res.json();

    if (counterEl) {
      counterEl.innerText = `Записей в базе: ${total.toLocaleString('ru-RU')}`;
    }

    head.innerHTML = `<tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>`;
    body.innerHTML = data.map(row => `
      <tr>
        <td>${row.indicator}</td>
        <td>${row.year}</td>
        <td>${row.province}</td>
        <td>${row.value !== undefined && row.value !== null ? row.value.toLocaleString('ru-RU') : 0}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Ошибка загрузки таблицы:', err);
  }
}

export function filterTable(API_BASE_URL) {
  currentPage = 1;
  loadTablePage(API_BASE_URL);
}

export function toggleTableVisibility() {
  const wrapper = document.getElementById('tableContentWrapper');
  const icon = document.getElementById('toggleTableIcon');
  const text = document.getElementById('toggleTableText');

  if (!wrapper) return;

  const isCollapsed = wrapper.classList.toggle('collapsed');

  if (isCollapsed) {
    icon.innerText = '▶';
    text.innerText = 'Показать таблицу';
  } else {
    icon.innerText = '▼';
    text.innerText = 'Скрыть таблицу';
  }
}