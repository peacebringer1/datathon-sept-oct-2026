export let yearChartInstance = null; // Первый график (барчарт)
export let lineChartInstance = null; // Второй график (линейный со сглаживанием)
export let pieChartInstance = null;  // Третий график (круговой)
export let hBarChartInstance = null; // Четвертый график (area chart)

export let summaryChartInstance = null;
export let kzMapInstance = null;
let cachedKZJson = null;
let isMapActive = false;

// Общий тулбокс для всех графиков ECharts (кнопки справа сверху)
// Тулбокс с кнопками "Data View" и "Save as Image" (без кнопок смены типа графика)
const commonToolbox = {
  feature: {
    dataView: { readOnly: true, title: 'Data view' },
    saveAsImage: { pixelRatio: 2, title: 'Save as Image' }
  }
};

const regionNameMapping = {
  "Акмолинская область": "Ақмола облысы",
  "Актюбинская область": "Ақтөбе облысы",
  "Алматинская область": "Алматы облысы",
  "Атырауская область": "Атырау облысы",
  "Восточно-Казахстанская область": "Шығыс Қазақстан облысы",
  "Жамбылская область": "Жамбыл облысы",
  "Западно-Казахстанская область": "Батыс Қазақстан облысы",
  "Карагандинская область": "Қарағанды облысы",
  "Костанайская область": "Қостанай облысы",
  "Кызылординская область": "Қызылорда облысы",
  "Мангистауская область": "Маңғыстау облысы",
  "Павлодарская область": "Павлодар облысы",
  "Северо-Казахстанская область": "Солтүстік Қазақстан облысы",
  "Южно-Казахстанская область": "Түркістан облысы",
  "Туркестанская область": "Түркістан облысы",
  "Область Абай": "Абай облысы",
  "Область Жетысу": "Жетісу облысы",
  "Область Улытау": "Ұлытау облысы",
  "г. Алматы": "Алматы",
  "г. Астана": "Астана",
  "г. Шымкент": "Шымкент"
};

// Функция обновления сразу 4 графиков первой вкладки
export async function updateYearChart(apiBaseUrl, indicator, year) {
  if (!indicator || !year) return;

  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const { labels, values } = await res.json();

    // 1. Первый график: Вертикальный барчарт с фоном
    const domBar = document.getElementById('chartTypeBar');
    if (domBar) {
      if (!yearChartInstance) yearChartInstance = echarts.init(domBar);
      yearChartInstance.setOption({
        animation: true,
        animationDuration: 1000,
        title: { text: 'Распределение по регионам', left: 'center', textStyle: { fontSize: 13, color: '#1e293b' } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'axis', formatter: (p) => `<b>${p[0].name}</b><br/>${indicator}: <b>${p[0].value.toLocaleString('ru-RU')}</b>` },
        grid: { top: '20%', bottom: '30%', left: '10%', right: '5%' },
        xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: '#475569' } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#475569' }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
        series: [{
          data: values,
          type: 'bar',
          showBackground: true,
          backgroundStyle: { color: 'rgba(180, 180, 180, 0.15)', borderRadius: [4, 4, 0, 0] },
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#3b82f6' }, { offset: 1, color: '#1d4ed8' }]),
            borderRadius: [4, 4, 0, 0]
          },
          barMaxWidth: 25
        }]
      });
    }

    // 2. Второй график: Сглаженный линейный с градиентной заливкой
    const domLine = document.getElementById('chartTypeLine');
    if (domLine) {
      if (!lineChartInstance) lineChartInstance = echarts.init(domLine);
      lineChartInstance.setOption({
        animation: true,
        animationDuration: 1000,
        title: { text: 'Динамика показателей', left: 'center', textStyle: { fontSize: 13, color: '#1e293b' } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'axis' },
        grid: { top: '20%', bottom: '30%', left: '10%', right: '5%' },
        xAxis: { type: 'category', data: labels, axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: '#475569' } },
        yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#475569' }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
        series: [{
          data: values,
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#0770FF' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(7, 112, 255, 0.6)' },
              { offset: 1, color: 'rgba(7, 112, 255, 0.05)' }
            ])
          }
        }]
      });
    }

    // 3. Третий график: Круговая диаграмма
    const pieData = labels.map((lbl, idx) => ({ name: lbl, value: values[idx] })).filter(item => item.value > 0);
    const domPie = document.getElementById('chartTypePie');
    if (domPie) {
      if (!pieChartInstance) pieChartInstance = echarts.init(domPie);
      pieChartInstance.setOption({
        animation: true,
        animationDuration: 1000,
        title: { text: 'Доли по регионам', left: 'center', textStyle: { fontSize: 13, color: '#1e293b' } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
        legend: { type: 'scroll', orient: 'vertical', left: 'left', textStyle: { fontSize: 9 } },
        series: [{
          type: 'pie',
          radius: ['40%', '65%'],
          center: ['60%', '55%'],
          avoidLabelOverlap: false,
          label: { show: false },
          data: pieData
        }]
      });
    }

    // 4. Четвертый график: Линейный с заливкой области (Area Chart)
    const domHBar = document.getElementById('chartTypeHBar');
    if (domHBar) {
      if (!hBarChartInstance) hBarChartInstance = echarts.init(domHBar);
      hBarChartInstance.setOption({
        animation: true,
        animationDuration: 1000,
        title: { text: 'Динамика по периодам', left: 'center', textStyle: { fontSize: 13, color: '#1e293b' } },
        toolbox: commonToolbox,
        tooltip: { trigger: 'axis', formatter: (p) => `<b>${p[0].name}</b><br/>Значение: <b>${p[0].value.toLocaleString('ru-RU')}</b>` },
        grid: { top: '20%', bottom: '30%', left: '10%', right: '5%' },
        xAxis: { 
          type: 'category', 
          boundaryGap: false, 
          data: labels,
          axisLabel: { interval: 0, rotate: 35, fontSize: 9, color: '#475569' }
        },
        yAxis: { 
          type: 'value', 
          axisLabel: { fontSize: 10, color: '#475569' }, 
          splitLine: { lineStyle: { color: '#f1f5f9' } } 
        },
        series: [{
          data: values,
          type: 'line',
          smooth: true,
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(59, 130, 246, 0.5)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0.02)' }
            ])
          },
          itemStyle: { color: '#3b82f6' },
          lineStyle: { width: 2 }
        }]
      });
    }

  } catch (e) {
    console.error('Ошибка загрузки данных для графиков:', e);
  }
}

// 5. Итоговый график (Chart.js)
export async function updateSummaryChart(apiBaseUrl, indicator) {
  if (!indicator) return;
  try {
    const res = await fetch(`${apiBaseUrl}/api/chart-summary?indicator=${encodeURIComponent(indicator)}`);
    const { labels, values } = await res.json();

    const canvas = document.getElementById('summaryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (summaryChartInstance) summaryChartInstance.destroy();

    summaryChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: `Итоговый показатель: ${indicator}`,
          data: values,
          backgroundColor: 'rgba(75, 192, 192, 0.75)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        animation: { duration: 900, easing: 'easeInOutQuart' },
        scales: { y: { beginAtZero: true } } 
      }
    });
  } catch (e) {
    console.error('Ошибка загрузки суммарных данных:', e);
  }
}

// 6. Карта Казахстана (ECharts)
export async function initKazakhstanMap(apiBaseUrl, indicator, year) {
  const chartDom = document.getElementById('kazakhstanMapChart');
  if (!chartDom) return;

  if (!kzMapInstance) {
    kzMapInstance = echarts.init(chartDom);
  }

  if (!cachedKZJson) {
    kzMapInstance.showLoading();
  }

  try {
    if (!cachedKZJson) {
      const geoRes = await fetch('https://raw.githubusercontent.com/artemnovichkov/KazakhstanMapExample/main/KazakhstanMapExample/kazakhstan.geojson');
      cachedKZJson = await geoRes.json();
      echarts.registerMap('KZ', cachedKZJson);
      kzMapInstance.hideLoading();
    }

    const res = await fetch(`${apiBaseUrl}/api/chart-year?indicator=${encodeURIComponent(indicator)}&year=${year}`);
    const chartData = await res.json();

    const formattedData = chartData.labels.map((label, index) => ({
      name: regionNameMapping[label] || label,
      value: chartData.values[index]
    }));

    const values = chartData.values;
    const minVal = values.length ? Math.min(...values) : 0;
    const maxVal = values.length ? Math.max(...values) : 100;

    const option = {
      animation: false,
      animationDuration: 0,
      animationDurationUpdate: 0,
      title: { text: `Географическое распределение: ${indicator} (${year})`, left: 'center', textStyle: { fontSize: 14, color: '#1e293b' } },
      toolbox: commonToolbox,
      tooltip: { trigger: 'item', formatter: (params) => `<b>${params.name}</b><br/>Значение: <b>${params.value !== undefined ? params.value.toLocaleString('ru-RU') : 'Нет данных'}</b>` },
      visualMap: { left: 'right', min: minVal, max: maxVal, inRange: { color: ['#e0f3f8', '#abd9e9', '#74add1', '#4575b4', '#313695'] }, text: ['Макс', 'Мин'], calculable: true },
      series: [{ 
        type: 'map', 
        map: 'KZ', 
        roam: isMapActive ? true : 'move', 
        center: [67.0, 48.0], 
        zoom: 4.5, 
        data: formattedData, 
        label: { show: true, fontSize: 8 },
        universalTransition: true 
      }]
    };

    kzMapInstance.setOption(option);
  } catch (error) {
    console.error('Ошибка карты:', error);
    kzMapInstance.hideLoading();
  }
}

export function activateMapZoom() {
  if (!kzMapInstance) return;
  isMapActive = true;
  const wrapper = document.getElementById('mapWrapper');
  if (wrapper) wrapper.classList.add('active');
  kzMapInstance.setOption({ series: [{ roam: true }] });
}

document.addEventListener('click', (event) => {
  const wrapper = document.getElementById('mapWrapper');
  if (!wrapper || !kzMapInstance) return;

  if (!wrapper.contains(event.target) && isMapActive) {
    isMapActive = false;
    wrapper.classList.remove('active');
    kzMapInstance.setOption({ series: [{ roam: 'move' }] });
  }
});