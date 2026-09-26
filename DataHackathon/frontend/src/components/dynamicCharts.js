const availableChartTypes = [
  { type: 'bar', name: 'Столбиковая (Bar)' },
  { type: 'line', name: 'Линейная (Line)' },
  { type: 'scatter', name: 'Точечная (Scatter)' },
  { type: 'pie', name: 'Круговая (Pie)' }
];

let selectedDynamicType = 'bar';

export function renderBarAnimationChart(regions, values) {
  const barAnimationDom = document.getElementById('barAnimationChart');
  if (!barAnimationDom) return;
  
  const barChart = echarts.init(barAnimationDom);
  const data1 = values && values.length > 0 ? values : [120, 200, 150, 80, 70];
  const data2 = data1.map(v => Math.round(v * 0.85));

  const barOption = {
    title: { text: 'Bar Animation Delay', textStyle: { fontSize: 13 } },
    legend: { data: ['Текущий', 'Прошлый'] },
    toolbox: {
      feature: {
        dataView: { title: 'Таблица данных', readOnly: true },
        saveAsImage: { title: 'Сохранить картинку' }
      }
    },
    tooltip: { trigger: 'axis' },
    xAxis: { 
      data: regions, 
      splitLine: { show: false },
      axisLabel: { interval: 0, rotate: 25, fontSize: 9 } 
    },
    yAxis: {},
    series: [
      {
        name: 'Текущий',
        type: 'bar',
        data: data1,
        emphasis: { focus: 'series' },
        animationDelay: (idx) => idx * 10
      },
      {
        name: 'Прошлый',
        type: 'bar',
        data: data2,
        emphasis: { focus: 'series' },
        animationDelay: (idx) => idx * 10 + 100
      }
    ],
    animationEasing: 'elasticOut',
    animationDelayUpdate: (idx) => idx * 5
  };

  barChart.setOption(barOption, true);
  window.addEventListener('resize', () => barChart.resize());
}

export function renderDynamicSwitchChart(regions, values) {
  const dynamicDom = document.getElementById('dynamicSwitchChart');
  if (!dynamicDom) return;

  let modal = document.getElementById('chartSelectorModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'chartSelectorModal';
    modal.className = 'chart-modal-overlay hidden';
    modal.innerHTML = `
      <div class="chart-modal-content">
        <h3>Выберите тип графика ECharts</h3>
        <div class="chart-types-grid">
          ${availableChartTypes.map(item => `
            <button class="chart-type-option" data-type="${item.type}">${item.name}</button>
          `).join('')}
        </div>
        <button class="close-modal-btn">Закрыть</button>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelectorAll('.chart-type-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        selectedDynamicType = e.target.getAttribute('data-type');
        modal.classList.add('hidden');
        buildChart(regions, values, selectedDynamicType, dynamicDom);
      });
    });

    modal.querySelector('.close-modal-btn').addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  const selectBtn = document.getElementById('openChartModalBtn');
  if (selectBtn) {
    selectBtn.onclick = () => {
      modal.classList.remove('hidden');
    };
  }

  buildChart(regions, values, selectedDynamicType, dynamicDom);
}

function buildChart(regions, values, type, domElement) {
  const chartInstance = echarts.init(domElement);

  const commonToolbox = {
    feature: {
      dataView: { readOnly: true, title: 'Data view' },
      saveAsImage: { pixelRatio: 2, title: 'Save as Image' }
    }
  };

  let option = {
    title: { text: `Тип: ${type.toUpperCase()}`, textStyle: { fontSize: 13 } },
    toolbox: commonToolbox,
    tooltip: { trigger: type === 'pie' ? 'item' : 'axis' },
  };

  if (type === 'pie') {
    option.series = [{
      type: 'pie',
      radius: ['35%', '65%'],
      data: regions.map((reg, idx) => ({ name: reg, value: values[idx] }))
    }];
  } else {
    option.xAxis = { type: 'category', data: regions, axisLabel: { interval: 0, rotate: 25, fontSize: 9 } };
    option.yAxis = { type: 'value' };
    option.series = [{
      data: values,
      type: type,
      smooth: type === 'line',
      itemStyle: { color: '#2563eb' }
    }];
  }

  chartInstance.setOption(option, true);
  window.addEventListener('resize', () => chartInstance.resize());
}