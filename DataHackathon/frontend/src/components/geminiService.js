export async function fetchAIAnalysisForChart(chartTitle, categoryName, apiBaseUrl, dashboardContext) {
  const response = await fetch(`${apiBaseUrl}/api/ai-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{
        role: 'user',
        text: `Проанализируй выбранный график «${chartTitle}» в категории «${categoryName}». Опиши значения, сравнения и тенденции, подтверждая числовые выводы данными базы.`
      }],
      dashboard_context: dashboardContext
    })
  });
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Сервер вернул не JSON (HTTP ${response.status}). Полностью перезапустите приложение, чтобы обновить Flask API.`
    );
  }
  if (!response.ok) throw new Error(result.error || 'Не удалось получить анализ графика.');
  return result.answer;
}