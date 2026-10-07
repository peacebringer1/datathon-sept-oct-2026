// frontend/src/components/householdComponent.js

export async function initHouseholdSection(apiBaseUrl) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/household-radar`);
    const data = await response.json();

    if (!data || data.error) {
      console.error('Ошибка получения данных домохозяйств');
      return;
    }

    const blocksConfig = [
      { id: 'householdRadarQuestion1', title: '1. Первый вопрос (GR1)', rawBlockData: data.block1 },
      { id: 'householdRadarQuestion2', title: '2. Второй вопрос (GR4)', rawBlockData: data.block2 },
      { id: 'householdRadarQuestion3', title: '3. Третий вопрос (GR7)', rawBlockData: data.block3 },
      { id: 'householdRadarQuestion4', title: '4. Четвертый вопрос (GR10)', rawBlockData: data.block4 },
      { id: 'householdRadarQuestion5', title: '5. Пятый вопрос (GR13)', rawBlockData: data.block5 }
    ];

    const scoresRange = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

    blocksConfig.forEach((block) => {
      const dom = document.getElementById(block.id);
      if (dom) {
        dom.style.width = '100%';
        dom.style.height = '100%';

        const bData = block.rawBlockData || {};
        const values = scoresRange.map(score => Number(bData[`score_${score}`] || 0));

        const maxCount = Math.max(...values, 10);
        const indicators = scoresRange.map(score => ({
          name: `${score} баллов`,
          max: maxCount
        }));

        const chart = echarts.getInstanceByDom(dom) || echarts.init(dom);
        
        const option = {
          title: {
            text: block.title,
            left: 'center',
            top: '10px',
            textStyle: { fontSize: 13, fontWeight: '600', color: '#1e293b' }
          },
          tooltip: {
            trigger: 'item',
            formatter: function () {
              let res = `<b>${block.title}</b><br/>`;
              scoresRange.forEach((score, i) => {
                res += `Оценка ${score}: <b>${values[i]} чел.</b><br/>`;
              });
              return res;
            }
          },
          radar: {
            indicator: indicators,
            radius: '50%',
            center: ['50%', '58%'],
            splitNumber: 4,
            axisName: { color: '#475569', fontSize: 11 },
            splitLine: { lineStyle: { color: ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b'] } },
            splitArea: { areaStyle: { color: ['rgba(248,250,252,0.6)', 'rgba(241,245,249,0.6)'] } }
          },
          series: [{
            type: 'radar',
            data: [{ value: values, name: 'Кол-во людей' }],
            areaStyle: { color: 'rgba(59, 130, 246, 0.4)' },
            lineStyle: { color: '#2563eb', width: 2 },
            itemStyle: { color: '#1d4ed8' }
          }]
        };

        chart.setOption(option);
        setTimeout(() => chart.resize(), 100);
        window.addEventListener('resize', () => chart.resize());
      }
    });

  } catch (e) {
    console.error('Ошибка загрузки радарных диаграмм:', e);
  }
}

window.switchMainSection = async function(sectionName, element) {
  if (sectionName === 'dashboard' && window.waitForAnalyzerDatasetSync) {
    const datasetReady = await window.waitForAnalyzerDatasetSync();
    if (!datasetReady) return;
  }

  document.querySelectorAll('.cat-header').forEach(el => el.classList.remove('active'));
  if (element) element.classList.add('active');

  const activeProgram = sectionName === 'data-analyzer' ? 'data-analyzer' : 'dashboard';
  document.querySelectorAll('.program-switcher-button').forEach(button => {
    const isActive = button.dataset.program === activeProgram;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  const dashboard = document.getElementById('mainDashboardContent');
  const household = document.getElementById('householdSection');
  const datasetPage = document.getElementById('datasetViewSection');
  const detailed = document.getElementById('detailedViewSection');
  const analyzer = document.getElementById('dataAnalyzerSection');

  if (detailed) detailed.style.display = 'none';
  if (datasetPage) datasetPage.style.display = 'none';
  document.querySelectorAll('.cat-subitem').forEach(el => el.classList.remove('active'));

  if (sectionName === 'household') {
    if (dashboard) dashboard.style.display = 'none';
    if (dashboard) dashboard.classList.remove('program-analyzer-active');
    if (household) household.style.display = 'block';
    if (analyzer) analyzer.style.display = 'none';
    initHouseholdSection(window.API_BASE_URL || 'http://127.0.0.1:5000');
  } else if (sectionName === 'data-analyzer') {
    if (dashboard) {
      dashboard.style.display = 'block';
      dashboard.classList.add('program-analyzer-active');
    }
    if (household) household.style.display = 'none';
    if (analyzer) analyzer.style.display = 'block';

    const frame = document.getElementById('dataAnalyzerFrame');
    if (frame && window.DATA_ANALYZER_URL && frame.dataset.loaded !== 'true') {
      frame.src = `${window.DATA_ANALYZER_URL}/`;
      frame.dataset.loaded = 'true';
    }
  } else {
    if (dashboard) dashboard.classList.remove('program-analyzer-active');
    if (household) household.style.display = 'none';
    if (analyzer) analyzer.style.display = 'none';
    if (dashboard) dashboard.style.display = 'block';
    if (sectionName === 'dashboard' && window.refreshDemographyCharts) {
      await window.refreshDemographyCharts();
    }
  }
};

export function initHouseholdComponent(dataset) {
    renderGeneralCharts(dataset);
    populateTable(dataset);
}

function parseRowValues(row) {
    return {
        year: Number(row['Год'] || 0),
        territoryCode: Number(row['Код территории'] || 0),
        age: Number(row['Возраст лица'] || 0),
        id: row['ID']
    };
}

function renderGeneralCharts(rawData) {
    const data = rawData.map(parseRowValues);
    const ages = data.map(item => item.age);
    const chartElement = document.getElementById('realDetailedChart');
    if (!chartElement || !window.echarts) return;

    const chart = window.echarts.getInstanceByDom(chartElement) || window.echarts.init(chartElement);
    chart.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: 48, right: 20, top: 24, bottom: 55, containLabel: true },
        xAxis: {
            type: 'category',
            data: data.map((_, index) => `Респондент ${index + 1}`),
            axisLabel: { rotate: 35 }
        },
        yAxis: { type: 'value', name: 'Возраст', minInterval: 1 },
        series: [{
            name: 'Возраст респондентов',
            type: 'bar',
            data: ages,
            itemStyle: { color: '#2563eb', borderRadius: [4, 4, 0, 0] }
        }]
    }, true);
    chart.resize();
}

function populateTable(rawData) {
    const tableBody = document.querySelector('#datasetTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    rawData.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row['Год'] || ''}</td>
            <td>${row['Код территории'] || ''}</td>
            <td>${row['Пол'] == 1 ? 'Мужской' : 'Женский'}</td>
            <td>${row['Возраст лица'] || ''}</td>
            <td>${row['GR1'] || ''}</td>
            <td>${row['GR2'] || ''}</td>
            <td>${row['GR3'] || ''}</td>
            <td>${row['ID'] || ''}</td>
        `;
        tableBody.appendChild(tr);
    });
}
