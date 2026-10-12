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

    let expandedSize = null;

    window.toggleAIChat = function() {
        const isOpen = sidebar.classList.toggle('open');
        appLayout.classList.toggle('ai-sidebar-open', isOpen);
        if (!isOpen) setExpanded(false);
        if (isOpen) input?.focus();
    };

    function setExpanded(expanded) {
        const wasExpanded = sidebar.classList.contains('is-fullscreen');
        if (expanded === wasExpanded) return;
        if (expanded) {
            expandedSize = {
                width: sidebar.style.width,
                height: sidebar.style.height,
                top: sidebar.style.top
            };
            sidebar.style.width = '';
            sidebar.style.height = '';
            sidebar.style.top = '';
        } else if (expandedSize) {
            sidebar.style.width = expandedSize.width;
            sidebar.style.height = expandedSize.height;
            sidebar.style.top = expandedSize.top;
            expandedSize = null;
        }
        sidebar.classList.toggle('is-fullscreen', expanded);
        if (!expandBtn) return;
        expandBtn.setAttribute('aria-pressed', String(expanded));
        expandBtn.setAttribute('aria-label', expanded
            ? 'Свернуть ИИ-панель до боковой'
            : 'Развернуть ИИ-панель на весь экран');
        expandBtn.title = expanded ? 'Вернуть боковой вид' : 'Развернуть на весь экран';
        expandBtn.textContent = expanded ? '↙' : '⛶';
    }

    const getResizeDirection = (event) => {
        const bounds = sidebar.getBoundingClientRect();
        const edgeSize = 12;
        const horizontal = event.clientX - bounds.left <= edgeSize
            ? 'w'
            : bounds.right - event.clientX <= edgeSize ? 'e' : '';
        const vertical = event.clientY - bounds.top <= edgeSize ? 'n' : '';
        if (vertical && horizontal) return `${vertical}${horizontal}`;
        return vertical || horizontal;
    };

    sidebar.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || sidebar.classList.contains('is-fullscreen')) return;
        if (window.matchMedia('(max-width: 760px)').matches) return;
        if (event.target.closest('button, input, textarea, select, a')) return;

        const direction = getResizeDirection(event);
        if (!direction) return;
        event.preventDefault();

        const bounds = sidebar.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const startWidth = bounds.width;
        const startHeight = bounds.height;
        const startTop = bounds.top;
        const startRight = window.innerWidth - bounds.right;
        const minWidth = Math.min(560, window.innerWidth - 32);
        const maxWidth = window.innerWidth - 32;
        const minHeight = Math.min(420, window.innerHeight - 32);
        const maxHeight = window.innerHeight - 32;

        const resize = (moveEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaY = moveEvent.clientY - startY;
            const resizeWest = direction.includes('w');
            const resizeEast = direction.includes('e');
            const resizeNorth = direction.includes('n');
            const width = Math.min(maxWidth, Math.max(
                minWidth,
                startWidth + (resizeWest ? -deltaX : resizeEast ? deltaX : 0)
            ));
            const height = Math.min(maxHeight, Math.max(
                minHeight,
                startHeight - (resizeNorth ? deltaY : 0)
            ));

            sidebar.style.width = `${width}px`;
            sidebar.style.height = `${height}px`;
            if (resizeEast) sidebar.style.right = `${Math.max(16, startRight - (width - startWidth))}px`;
            if (resizeNorth) sidebar.style.top = `${Math.max(16, startTop + startHeight - height)}px`;
        };
        const finish = () => {
            sidebar.removeEventListener('pointermove', resize);
            sidebar.removeEventListener('pointerup', finish);
            sidebar.removeEventListener('pointercancel', finish);
            sidebar.classList.remove('is-resizing');
            delete sidebar.dataset.resizeDirection;
        };

        sidebar.classList.add('is-resizing');
        sidebar.dataset.resizeDirection = direction;
        sidebar.setPointerCapture(event.pointerId);
        sidebar.addEventListener('pointermove', resize);
        sidebar.addEventListener('pointerup', finish, { once: true });
        sidebar.addEventListener('pointercancel', finish, { once: true });
    });

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
