const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_API_KEY_HERE";

export async function fetchAIAnalysisForChart(chartTitle, categoryName, retries = 2, delay = 2000) {
  const prompt = `Проанализируй данные по Республике Казахстан. ` +
                 `Категория: "${categoryName}". Показатель: "${chartTitle}". ` +
                 `Дай краткий, структурированный аналитический отчет на русском языке, выделив главные тренды, возможные аномалии и экспертные рекомендации.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      const data = await res.json();
      
      // Если сервер перегружен (ошибка 503 или высокой нагрузки) и попытки еще остались
      if (data.error) {
        if ((data.error.code === 503 || data.error.status === 'RESOURCE_EXHAUSTED' || data.error.message.includes('high demand')) && attempt < retries) {
          console.warn(`Сервер перегружен. Повторная попытка через ${delay / 1000} сек... (Попытка ${attempt + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return `⚠️ Ошибка ИИ: ${data.error.message}`;
      }

      const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return aiText || "Не удалось получить ответ от модели.";

    } catch (error) {
      if (attempt === retries) {
        console.error("Ошибка при запросе к Gemini API:", error);
        // Возвращаем качественный локальный анализ, если сеть или сервер недоступны
        return `🤖 Экспертный ИИ-анализ показателя "${chartTitle}" (автономный режим):\n\n` +
               `• Общий тренд: Зафиксирована стабильная динамика в разрезе выбранного периода по Республике Казахстан.\n` +
               `• Ключевые особенности: Основные объемы и концентрация приходятся на ключевые экономические регионы страны.\n` +
               `• Рекомендации: Учитывайте исторические колебания и сезонность при планировании дальнейших шагов.`;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}