export let chatHistory = [];

export function toggleAIChat() {
  const sidebar = document.getElementById('aiPopupSidebar');
  if (!sidebar) return;

  if (sidebar.style.display === 'none' || sidebar.style.display === '') {
    sidebar.style.display = 'block';
    const input = document.getElementById('chatInput');
    if (input) input.focus();
  } else {
    sidebar.style.display = 'none';
  }
}

export function handleChatKeyDown(event, sendMessageCallback) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessageCallback();
  }
}

export function appendMessage(text, type) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return null;
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${type}`;
  bubble.innerText = text;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

export function initAIChat(apiBaseUrl) {
  window.sendMessageToAI = () => sendMessageToAI(apiBaseUrl);
  window.handleChatKeyDown = (event) => handleChatKeyDown(event, window.sendMessageToAI);
}

function getDashboardContext() {
  const getSelection = (id) => {
    const select = document.getElementById(id);
    return select?.selectedOptions?.[0]?.textContent?.trim() || '';
  };

  const activeCategory = document.querySelector('.cat-header.active .cat-text');
  const context = {
    category: activeCategory?.textContent?.trim() || '',
    indicator: getSelection('regionIndicatorSelect'),
    year: getSelection('regionYearSelect'),
    mapIndicator: getSelection('mapIndicatorSelect'),
    mapYear: getSelection('mapYearSelect'),
    summaryIndicator: getSelection('summaryIndicatorSelect')
  };

  for (let card = 1; card <= 6; card += 1) {
    const indicator = getSelection(`card${card}Indicator`);
    const year = getSelection(`card${card}Year`);
    if (indicator || year) context[`card${card}`] = { indicator, year };
  }

  return context;
}

export async function sendMessageToAI(apiBaseUrl) {
  const input = document.getElementById('chatInput');
  const sendButton = document.querySelector('.chat-input-area button');
  const message = input?.value.trim();
  if (!message || !input) return;

  appendMessage(message, 'user');
  input.value = '';
  input.disabled = true;
  if (sendButton) sendButton.disabled = true;

  const nextHistory = [...chatHistory, { role: 'user', text: message }].slice(-10);

  try {
    const response = await fetch(`${apiBaseUrl}/api/ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: nextHistory,
        dashboard_context: getDashboardContext()
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
    if (!response.ok) throw new Error(result.error || 'Не удалось получить ответ ИИ.');

    chatHistory = [...nextHistory, { role: 'model', text: result.answer }].slice(-10);
    appendMessage(result.answer, 'ai');
  } catch (error) {
    appendMessage(error.message || 'Не удалось связаться с ИИ-помощником.', 'ai');
  } finally {
    input.disabled = false;
    if (sendButton) sendButton.disabled = false;
    input.focus();
  }
}