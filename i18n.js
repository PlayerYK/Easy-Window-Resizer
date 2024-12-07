document.addEventListener('DOMContentLoaded', () => {
  // 处理普通文本内容的国际化
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const message = element.getAttribute('data-i18n');
    element.textContent = chrome.i18n.getMessage(message);
  });

  // 处理 placeholder 的国际化
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const message = element.getAttribute('data-i18n-placeholder');
    element.placeholder = chrome.i18n.getMessage(message);
  });
}); 