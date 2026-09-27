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
    // Увеличиваем limit до 2000, чтобы выгрузить все данные датасета целиком
    const res = await fetch(`${API_BASE_URL}/api/table-data?page=${currentPage}&limit=2000&indicator=${encodeURIComponent(indicator)}&search=${encodeURIComponent(search)}`);
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

// Экспорт в CSV
window.exportTableToCSV = function() {
  const table = document.querySelector('.table-wrapper table');
  if (!table) return;
  
  let csv = [];
  const rows = table.querySelectorAll('tr');
  
  for (let i = 0; i < rows.length; i++) {
    const row = [], cols = rows[i].querySelectorAll('td, th');
    for (let j = 0; j < cols.length; j++) {
      let data = cols[j].innerText.replace(/(\r\n|\n|\r)/gm, '').replace(/(\s+)/gm, ' ');
      row.push('"' + data + '"');
    }
    csv.push(row.join(';'));
  }
  
  const csvFile = new Blob(["\uFEFF" + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const downloadLink = document.createElement('a');
  downloadLink.download = 'kazakhstan_analytics_data.csv';
  downloadLink.href = window.URL.createObjectURL(csvFile);
  downloadLink.style.display = 'none';
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
};

// Экспорт в Excel (.xls / .xlsx без сторонних либ)
window.exportTableToExcel = function() {
  const table = document.querySelector('.table-wrapper table');
  if (!table) {
    alert('Таблица не найдена на странице');
    return;
  }

  try {
    const html = table.outerHTML;
    const blob = new Blob(['\ufeff' + html], {
      type: 'application/vnd.ms-excel;charset=utf-8;'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kazakhstan_analytics_data.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Ошибка экспорта в Excel:', e);
  }
};