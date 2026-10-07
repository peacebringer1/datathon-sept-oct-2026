export async function fetchAIAnalysisForChart(chartTitle, categoryName, apiBaseUrl, chartContext = {}) {
  const settingsResponse = await fetch(`${apiBaseUrl}/api/settings/claude-key`);
  const settings = await settingsResponse.json();
  if (!settingsResponse.ok || settings.configured !== true) {
    return 'Подключите ключ Claude в настройках, чтобы получить анализ этого графика.';
  }

  const rawChart = chartContext.chart || {};
  const labels = Array.isArray(rawChart.labels) ? rawChart.labels : [];
  const series = Array.isArray(rawChart.series) ? rawChart.series.map((item) => ({
    name: item.name || '',
    type: item.type || '',
    points: Array.isArray(item.points)
      ? item.points
      : (item.values || []).map((value, index) => ({
        label: labels[index] || String(index + 1),
        value
      }))
  })) : [];

  const response = await fetch(`${apiBaseUrl}/api/chart-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      indicator: chartTitle,
      category: categoryName,
      year: String(chartContext.year || ''),
      chart: { title: chartTitle, labels, series }
    })
  });
  const result = await response.json();
  if (!response.ok) {
    const message = typeof result.error === 'string' ? result.error : result.error?.message;
    throw new Error(message || `Ошибка сервера (HTTP ${response.status}).`);
  }

  const analysis = result.analysis;
  if (!analysis || typeof analysis !== 'object') return 'ИИ не вернул анализ графика.';
  const observations = Array.isArray(analysis.observations) ? analysis.observations : [];
  const hypotheses = Array.isArray(analysis.hypotheses) ? analysis.hypotheses : [];
  return [
    analysis.trend,
    observations.length ? `Наблюдения:\n• ${observations.join('\n• ')}` : '',
    hypotheses.length ? `Гипотезы:\n• ${hypotheses.join('\n• ')}` : ''
  ].filter(Boolean).join('\n\n');
}
