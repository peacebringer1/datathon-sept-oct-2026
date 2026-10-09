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
    event.preventDefault()
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

export function cleanAIResponse(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\w-]*\s*\n?/g, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*(?:\d+[.)][ \t]*)?/gm, '')
    .replace(/^([ \t]*)[*+][ \t]+/gm, '$1— ')
    .replace(/\*\*(.*?)\*\*|__(.*?)__/g, (_match, stars, underscores) => stars || underscores)
    .replace(/(^|[\s([{«])\*([^*\n]+)\*(?=$|[\s.,!?;:)\]}»])/gm, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^[ \t]*(?:-{3,}|_{3,}|\*{3,})[ \t]*$/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  const sendButton = document.getElementById('chatSendButton');
  const sendSpinner = sendButton?.querySelector('.chat-send-spinner');
  const message = input?.value.trim();
  if (!message || !input) return;

  appendMessage(message, 'user');
  input.value = '';
  input.disabled = true;
  if (sendButton) {
    sendButton.disabled = true;
  }
  if (sendButton) {
    sendButton.setAttribute('aria-busy', 'true');
    sendButton.classList.add('is-loading');
  }
  if (sendSpinner) sendSpinner.hidden = false;
  const loadingBubble = appendMessage('Формирую ответ…', 'ai');
  if (loadingBubble) {
    loadingBubble.classList.add('chat-loading');
    loadingBubble.innerHTML = '<span class="loading-spinner" aria-hidden="true"></span><span>Формирую ответ…</span>';
  }

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
      const message = response.status >= 500
        ? `Ошибка Flask API (HTTP ${response.status}). Проверьте traceback в терминале backend.`
        : `Flask API вернул не JSON (HTTP ${response.status}). Проверьте, что запрос отправлен на актуальный сервер.`;
      throw new Error(message);
    }
    if (!response.ok) {
      const errorMessage = typeof result.error === 'string'
        ? result.error
        : result.error?.message;
      throw new Error(errorMessage || 'Не удалось получить ответ ИИ.');
    }
    if (typeof result.answer !== 'string' || !result.answer.trim()) {
      throw new Error('Flask API не вернул текст ответа.');
    }

    const answer = cleanAIResponse(result.answer);
    if (!answer) {
      throw new Error('После очистки форматирования ответ ИИ оказался пустым.');
    }
    chatHistory = [...nextHistory, { role: 'model', text: answer }].slice(-10);
    appendMessage(answer, 'ai');
  } catch (error) {
    const errorMessage = error.message || '';
    const friendlyMessage = /Claude API \(429\)|HTTP 429|rate.?limit|quota/i.test(errorMessage)
      ? 'Временно достигнут лимит запросов Claude. Попробуйте позже.'
      : 'Не удалось получить ответ ИИ. Проверьте подключение и попробуйте ещё раз.';
    appendMessage(friendlyMessage, 'ai');
  } finally {
    loadingBubble?.remove();
    input.disabled = false;
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.removeAttribute('aria-busy');
      sendButton.classList.remove('is-loading');
    }
    if (sendSpinner) sendSpinner.hidden = true;
    input.focus();
  }
}
