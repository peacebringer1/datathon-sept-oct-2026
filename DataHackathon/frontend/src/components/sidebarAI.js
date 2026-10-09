// sidebarAI.js — модуль управления правым сайдбаром ассистента

export function initAISidebar() {
    const sidebar = document.getElementById('aiPopupSidebar');
    const appLayout = document.querySelector('.app-layout');
    const closeBtn = sidebar?.querySelector('.close-chat-btn');
    const expandBtn = sidebar?.querySelector('.expand-chat-btn');
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
        if (!isOpen) setExpanded(false);
        if (isOpen) input?.focus();
    };

    function setExpanded(expanded) {
        sidebar.classList.toggle('is-fullscreen', expanded);
        if (!expandBtn) return;
        expandBtn.setAttribute('aria-pressed', String(expanded));
        expandBtn.setAttribute('aria-label', expanded
            ? 'Свернуть ИИ-панель до боковой'
            : 'Развернуть ИИ-панель на весь экран');
        expandBtn.title = expanded ? 'Вернуть боковой вид' : 'Развернуть на весь экран';
        expandBtn.textContent = expanded ? '↙' : '⛶';
    }

    expandBtn?.addEventListener('click', () => {
        setExpanded(!sidebar.classList.contains('is-fullscreen'));
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('open');
            setExpanded(false);
            appLayout.classList.remove('ai-sidebar-open');
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && sidebar.classList.contains('is-fullscreen')) {
            setExpanded(false);
        }
    });

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
