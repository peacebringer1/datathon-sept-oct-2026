let activeApiBaseUrl = '';
let latestRequestId = 0;

window.addEventListener('app-language-changed', () => {
  if (activeApiBaseUrl) void fetchAIInsights(activeApiBaseUrl);
});

export async function fetchAIInsights(API_BASE_URL) {
  activeApiBaseUrl = API_BASE_URL;
  const requestId = ++latestRequestId;
  const indicatorEl = document.getElementById('regionIndicatorSelect');
  const track = document.getElementById('tickerTrack');
  if (!indicatorEl || !track) return;

  const indicator = indicatorEl.value;

  try {
    const language = window.getAppLanguage?.() || 'ru';
    const res = await fetch(
      `${API_BASE_URL}/api/ai-insights?indicator=${encodeURIComponent(indicator)}&language=${encodeURIComponent(language)}`
    );
    const result = await res.json();
    if (requestId !== latestRequestId) return;
    if (!res.ok) {
      const message = typeof result.error === 'string'
        ? result.error
        : result.error?.message;
      throw new Error(message || `Не удалось получить ИИ-анализ (HTTP ${res.status}).`);
    }
    const { insights } = result;

    if (!insights || insights.length === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'ticker-item';
      emptyMessage.textContent = 'Недостаточно данных для достоверных наблюдений';
      track.replaceChildren(emptyMessage);
      return;
    }

    const fullList = [...insights, ...insights];
    const items = fullList.map((item) => {
      const tickerItem = document.createElement('div');
      tickerItem.className = 'ticker-item';
      if (item.type === 'positive') tickerItem.classList.add('positive');

      const title = document.createElement('span');
      title.className = 'ticker-title';
      title.textContent = item.title ?? '';

      const badge = document.createElement('span');
      badge.className = 'ticker-badge';
      badge.textContent = item.badge ?? '';

      const description = document.createElement('span');
      description.className = 'ticker-sub';
      description.textContent = `(${item.text ?? ''})`;

      tickerItem.append(title, badge, description);
      return tickerItem;
    });
    track.replaceChildren(...items);
  } catch (err) {
    if (requestId !== latestRequestId) return;
    console.error('Ошибка тикера:', err);
    const errorMessage = document.createElement('div');
    errorMessage.className = 'ticker-item';
    errorMessage.textContent = `ИИ-анализ недоступен: ${err.message || 'проверьте настройки API-ключа Claude'}`;
    track.replaceChildren(errorMessage);
  }
}
