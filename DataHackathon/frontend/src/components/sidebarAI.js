// sidebarAI.js — модуль управления правым сайдбаром ассистента

export function initAISidebar() {
    const sidebar = document.getElementById('aiPopupSidebar');
    const appLayout = document.querySelector('.app-layout');
    const closeBtn = sidebar?.querySelector('.close-chat-btn');
    const input = document.getElementById('chatInput');

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
}

// Автоматическая инициализация при загрузке модуля
document.addEventListener('DOMContentLoaded', () => {
    initAISidebar();
});
