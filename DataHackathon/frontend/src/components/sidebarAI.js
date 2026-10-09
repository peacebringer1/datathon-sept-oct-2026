// sidebarAI.js — модуль управления правым сайдбаром ассистента

export function initAISidebar() {
    const sidebar = document.getElementById('aiPopupSidebar');
    const appLayout = document.querySelector('.app-layout');
    const closeBtn = sidebar?.querySelector('.close-chat-btn');
    const input = document.getElementById('chatInput');
    const assistantButton = document.getElementById('aiToggleBtn');
    const assistantVideo = assistantButton?.querySelector('video');
    const notification = document.getElementById('aiNotificationBubble');
    const notificationText = document.getElementById('aiNotificationText');
    const notificationClose = document.getElementById('aiNotificationClose');

    if (!sidebar || !appLayout) return;

    window.toggleAIChat = function() {
        const isOpen = sidebar.classList.toggle('open');
        appLayout.classList.toggle('ai-sidebar-open', isOpen);
        if (isOpen) input?.focus();
    };

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('open');
            appLayout.classList.remove('ai-sidebar-open');
        });
    }

    if (assistantVideo && notification && notificationText) {
        const messages = [
            'Привет! Я готов проанализировать демографию 📊',
            'Спросите меня о показателях и графиках.',
            'Помогу разобраться в данных по регионам Казахстана.'
        ];
        let messageIndex = 0;
        let hideTimer;
        let messageTimer;
        const stopMotion = () => {
            window.clearTimeout(hideTimer);
            notification.classList.remove('show');
            assistantVideo.pause();
        };
        const showMessage = () => {
            if (document.hidden || sidebar.classList.contains('open')) return;
            notificationText.textContent = window.translateAppText?.(messages[messageIndex % messages.length]) || messages[messageIndex % messages.length];
            messageIndex += 1;
            notification.classList.add('show');
            assistantVideo.currentTime = 0;
            assistantVideo.play().catch(() => {});
            hideTimer = window.setTimeout(() => {
                notification.classList.remove('show');
                assistantVideo.pause();
            }, 4800);
        };
        messageTimer = window.setInterval(showMessage, 16000);
        window.setTimeout(showMessage, 1800);
        notificationClose?.addEventListener('click', stopMotion);
        assistantButton.addEventListener('click', stopMotion);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stopMotion();
        });
        window.addEventListener('app-language-changed', () => {
            if (notification.classList.contains('show')) {
                const current = messages[(messageIndex - 1 + messages.length) % messages.length];
                notificationText.textContent = window.translateAppText?.(current) || current;
            }
        });
        window.addEventListener('beforeunload', () => {
            window.clearInterval(messageTimer);
            stopMotion();
        }, { once: true });
    }
}

// Автоматическая инициализация при загрузке модуля
document.addEventListener('DOMContentLoaded', () => {
    initAISidebar();
});
