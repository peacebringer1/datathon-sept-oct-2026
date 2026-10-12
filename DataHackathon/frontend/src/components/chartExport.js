(() => {
  const installChartExport = () => {
    const echarts = window.echarts;
    if (!echarts || echarts.__chartExportInstalled) return;

    const originalInit = echarts.init.bind(echarts);
    echarts.init = (...args) => {
      const chart = originalInit(...args);
      if (chart.__chartExportWrapped) return chart;

      const originalSetOption = chart.setOption.bind(chart);
      chart.setOption = (option, ...setOptionArgs) => {
        if (option && typeof option === 'object' && !Array.isArray(option)) {
          const existingToolbox = option.toolbox && typeof option.toolbox === 'object' && !Array.isArray(option.toolbox)
            ? option.toolbox
            : {};
          if (existingToolbox.show !== false) {
            option.toolbox = {
              right: 12,
              top: 8,
              itemSize: 16,
              ...existingToolbox,
              feature: {
                saveAsImage: {
                  type: 'png',
                  pixelRatio: 2,
                  title: 'Скачать график PNG',
                  ...existingToolbox.feature?.saveAsImage
                },
                ...existingToolbox.feature
              }
            };
          }
        }
        return originalSetOption(option, ...setOptionArgs);
      };
      chart.__chartExportWrapped = true;
      return chart;
    };
    echarts.__chartExportInstalled = true;
  };

  installChartExport();
  document.addEventListener('DOMContentLoaded', installChartExport, { once: true });
})();
