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
    const res = await fetch(`${API_BASE_URL}/api/table-data?page=${currentPage}&limit=2000&indicator=${encodeURIComponent(indicator)}&search=${encodeURIComponent(search)}`);
    const { total, columns, data } = await res.json();
    if (counterEl) counterEl.innerText = `Записей в базе: ${total.toLocaleString('ru-RU')}`;
    head.innerHTML = `<tr>${columns.map((column) => `<th>${column}</th>`).join('')}</tr>`;
    body.innerHTML = data.map((row) => `<tr><td>${row.indicator}</td><td>${row.year}</td><td>${row.province}</td><td>${row.value != null ? row.value.toLocaleString('ru-RU') : 0}</td></tr>`).join('');
  } catch (error) {
    console.error('Ошибка загрузки таблицы:', error);
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
    if (icon) icon.innerText = '▶';
    if (text) text.innerText = 'Показать таблицу';
  } else {
    if (icon) icon.innerText = '▼';
    if (text) text.innerText = 'Скрыть таблицу';
  }
}

function getExportTable(source) {
  if (source instanceof HTMLTableElement) return source;
  if (source?.closest) return source.closest('.table-toolbar')?.parentElement?.querySelector('.table-wrapper table')
    || source.closest('article, section')?.querySelector('table') || null;
  return document.querySelector('.table-wrapper table');
}

function getExportFilename(table, extension) {
  const title = table?.closest('article, section')?.querySelector('h2, h3')?.textContent || 'Данные проекта';
  const safeTitle = title.trim().replace(/[^\p{L}\p{N}-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 70) || 'Данные';
  return `${safeTitle}.${extension}`;
}

let exportToastTimer = 0;
function showExportToast(message, type = 'success') {
  let toast = document.getElementById('exportToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'exportToast';
    toast.className = 'export-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }
  toast.replaceChildren();
  toast.className = `export-toast is-${type}`;
  const icon = document.createElement('span');
  icon.className = 'export-toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = type === 'success' ? '✓' : '!';
  const text = document.createElement('span');
  text.className = 'export-toast-message';
  text.textContent = message;
  const close = document.createElement('button');
  close.className = 'export-toast-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Закрыть уведомление');
  close.textContent = '×';
  close.addEventListener('click', () => toast.classList.remove('is-visible'), { once: true });
  toast.append(icon, text, close);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  clearTimeout(exportToastTimer);
  exportToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 5000);
}

async function exportExcelTable(table) {
  if (!table) {
    showExportToast('Таблица не найдена на странице.', 'error');
    return;
  }
  try {
    const XLSX = window.XLSX;
    if (!XLSX?.utils?.aoa_to_sheet || !XLSX?.write || !window.appSettings?.exportTableToExcel) {
      throw new Error('Библиотека Excel не загрузилась. Перезапустите приложение и попробуйте снова.');
    }

    const rows = [...table.querySelectorAll('tr')];
    const headers = [...(rows[0]?.cells || [])].map((cell) => cell.innerText.trim());
    const percentageCells = [];
    const data = rows.map((row, rowIndex) => [...row.cells].map((cell, columnIndex) => {
      const text = cell.innerText.replace(/[\u00a0\u202f]/g, ' ').trim();
      const header = headers[columnIndex] || '';
      if (!text) return '';

      const percentMatch = text.match(/^([+-]?[\d\s.,]+)\s*%$/);
      if (percentMatch) {
        const number = parseLocalizedNumber(percentMatch[1]);
        if (Number.isFinite(number)) {
          percentageCells.push({ row: rowIndex, column: columnIndex, decimals: (percentMatch[1].match(/[,.](\d+)\s*$/)?.[1] || '').length });
          return number / 100;
        }
      }

      if (/код|\bid\b|артикул/i.test(header)) return text;
      if (/^[+-]?[\d\s.,]+$/.test(text)) {
        const number = parseLocalizedNumber(text);
        if (Number.isFinite(number)) return number;
      }
      return text;
    }));

    const sheet = XLSX.utils.aoa_to_sheet(data);
    percentageCells.forEach(({ row, column, decimals }) => {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (sheet[address]) sheet[address].z = decimals ? `0.${'0'.repeat(decimals)}%` : '0%';
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Данные');
    const filename = getExportFilename(table, 'xlsx');
    const base64 = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64', compression: true });
    const result = await window.appSettings.exportTableToExcel({ base64, filename });
    if (result?.saved) {
      const savedName = String(result.filePath || '').split(/[\\/]/).pop() || filename;
      showExportToast(`Excel сохранён · ${savedName}`);
    }
  } catch (error) {
    console.error('Ошибка экспорта таблицы в Excel:', error);
    showExportToast('Не удалось сохранить таблицу в Excel.', 'error');
  }
}

function parseLocalizedNumber(value) {
  let normalized = String(value).replace(/\s/g, '');
  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }
  return Number(normalized);
}

async function exportPDFTable(table) {
  if (!table) {
    alert('Таблица не найдена на странице.');
    return;
  }
  if (!window.appSettings?.exportTableToPDF) {
    alert('Прямое сохранение PDF доступно в настольном приложении.');
    return;
  }
  const title = table.closest('article, section')?.querySelector('h2, h3')?.textContent || 'Данные проекта';
  const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const printableTable = table.cloneNode(true);
  printableTable.querySelectorAll('button, input, select, textarea, script').forEach((element) => element.remove());
  printableTable.querySelectorAll('*').forEach((element) => [...element.attributes]
    .filter((attribute) => attribute.name.toLowerCase().startsWith('on'))
    .forEach((attribute) => element.removeAttribute(attribute.name)));
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
    <title>${escapeHtml(title)}</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font: 12px Arial, sans-serif; color: #111; }
    h1 { font-size: 18px; margin: 0 0 14px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #888; padding: 5px 7px; text-align: left; overflow-wrap: anywhere; }
    th { background: #eee; }
    tr { break-inside: avoid; }
  </style></head><body><h1>${escapeHtml(title)}</h1>${printableTable.outerHTML}</body></html>`;
  try {
    const result = await window.appSettings.exportTableToPDF({ html, filename: getExportFilename(table, 'pdf') });
    if (result?.saved) {
      const savedName = String(result.filePath || '').split(/[\\/]/).pop() || 'Файл PDF';
      showExportToast(`PDF сохранён · ${savedName}`);
    }
  } catch (error) {
    console.error('Ошибка экспорта таблицы в PDF:', error);
    showExportToast(error.message || 'Не удалось сохранить таблицу в PDF.', 'error');
  }
}

window.exportTableToCSV = function () {
  const table = getExportTable();
  if (!table) return;
  const rows = [...table.querySelectorAll('tr')].map((row) => [...row.querySelectorAll('td, th')]
    .map((cell) => `"${cell.innerText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').replaceAll('"', '""')}"`).join(';'));
  const blob = new Blob([`\ufeff${rows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = getExportFilename(table, 'csv');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

window.exportTableToExcel = (source) => exportExcelTable(getExportTable(source));
window.exportTableToPDF = (source) => exportPDFTable(getExportTable(source));

function addTableExportButtons(table) {
  if (!(table instanceof HTMLTableElement) || table.dataset.exportButtonsReady === 'true') return;
  const scrollContainer = table.closest('.dataset-table-scroll, .d008-values-scroll');
  if (!scrollContainer) return;
  table.dataset.exportButtonsReady = 'true';
  const actions = document.createElement('div');
  actions.className = 'table-export-actions';
  actions.setAttribute('aria-label', 'Экспорт таблицы');
  [['Excel', 'excel-btn', () => exportExcelTable(table)], ['PDF', 'pdf-btn', () => exportPDFTable(table)]]
    .forEach(([label, style, action]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tab-btn ${style}`;
      button.textContent = label;
      button.addEventListener('click', action);
      actions.append(button);
    });
  scrollContainer.before(actions);
}

function initTableExports() {
  document.querySelectorAll('table').forEach(addTableExportButtons);
  if (!('MutationObserver' in window) || !document.body) return;
  const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches?.('table')) addTableExportButtons(node);
    node.querySelectorAll?.('table').forEach(addTableExportButtons);
  })));
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTableExports, { once: true });
else initTableExports();
