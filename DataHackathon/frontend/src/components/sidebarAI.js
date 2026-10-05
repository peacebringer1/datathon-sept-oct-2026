// sidebarAI.js — модуль управления правым сайдбаром ассистента

export function initAISidebar() {
    const sidebar = document.getElementById('aiPopupSidebar');
    const appLayout = document.querySelector('.app-layout');
    const toggleBtn = document.getElementById('aiToggleBtn');
    const closeBtn = sidebar?.querySelector('.close-chat-btn');
    const input = document.getElementById('chatInput');
    const sendBtn = sidebar?.querySelector('.chat-input-area button');
    const messagesContainer = document.getElementById('chatMessages');

    if (!sidebar || !appLayout) return;

    // Функция переключения видимости сайдбара и сдвига main
    window.toggleAIChat = function() {
        sidebar.classList.toggle('open');
        appLayout.classList.toggle('ai-sidebar-open');
    };

    // Закрытие по кнопке "крестик"
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('open');
            appLayout.classList.remove('ai-sidebar-open');
        });
    }

    // Функция отправки сообщения
    const sendMessage = () => {
        if (!input || !messagesContainer) return;
        const text = input.value.trim();
        if (!text) return;

        // Создаем сообщение пользователя
        const userBubble = document.createElement('div');
        userBubble.className = 'chat-bubble user';
        userBubble.textContent = text;
        messagesContainer.appendChild(userBubble);

        input.value = '';
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Имитация ответа ИИ
        setTimeout(() => {
            const aiBubble = document.createElement('div');
            aiBubble.className = 'chat-bubble ai';
            aiBubble.textContent = 'Анализирую данные графиков и показатели...';
            messagesContainer.appendChild(aiBubble);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 600);
    };

    // Обработчик кнопки "Отправить"
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }

    // Обработчик клавиши Enter в поле ввода
    if (input) {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });
    }
}

// Автоматическая инициализация при загрузке модуля
document.addEventListener('DOMContentLoaded', () => {
    initAISidebar();
});