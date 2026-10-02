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
      `Flask API вернул не JSON (HTTP ${response.status}). Проверьте, что запрос отправлен на актуальный сервер.`
    );
  }
  if (!response.ok) {
    const errorMessage = typeof result.error === 'string'
      ? result.error
      : result.error?.message;
    throw new Error(errorMessage || 'Не удалось получить анализ графика.');
  }
  return result.answer;
}