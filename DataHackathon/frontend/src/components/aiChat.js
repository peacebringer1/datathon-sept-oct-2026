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

export function initAIChat() {
    const chatContainer = document.getElementById('ai-chat-container');
    const sendButton = document.getElementById('ai-send-btn');
    const inputField = document.getElementById('ai-input-field');
    const messagesList = document.getElementById('ai-messages-list');

    if (!chatContainer || !sendButton || !inputField || !messagesList) return;

    function appendMessage(sender, text) {
        const messageElement = document.createElement('div');
        messageElement.className = `ai-message ${sender}`;
        messageElement.textContent = text;
        messagesList.appendChild(messageElement);
        messagesList.scrollTop = messagesList.scrollHeight;
    }

    async function handleSendMessage() {
        const text = inputField.value.trim();
        if (!text) return;

        appendMessage('user', text);
        inputField.value = '';

        try {
            const response = await window.electronAPI.sendAIQuery(text);
            appendMessage('assistant', response);
        } catch (error) {
            appendMessage('assistant', 'Ошибка при обработке запроса.');
        }
    }

    sendButton.addEventListener('click', handleSendMessage);
    inputField.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSendMessage();
        }
    });
}