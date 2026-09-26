export async function fetchAIInsights(API_BASE_URL) {
  const indicatorEl = document.getElementById('regionIndicatorSelect');
  const track = document.getElementById('tickerTrack');
  if (!indicatorEl || !track) return;

  const indicator = indicatorEl.value;

  try {
    const res = await fetch(`${API_BASE_URL}/api/ai-insights?indicator=${encodeURIComponent(indicator)}`);
    const { insights } = await res.json();

    if (!insights || insights.length === 0) {
      track.innerHTML = '<div class="ticker-item">Аномалий не обнаружено</div>';
      return;
    }

    const fullList = [...insights, ...insights];
    track.innerHTML = fullList.map(item => `
      <div class="ticker-item ${item.type}">
        <span class="ticker-title">${item.title}</span>
        <span class="ticker-badge">${item.badge}</span>
        <span class="ticker-sub">(${item.text})</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('Ошибка тикера:', err);
  }
}