// 后台服务
chrome.runtime.onInstalled.addListener(() => {
  // 初始化存储
  chrome.storage.sync.get(['predefinedSizes', 'recentSizes', 'windowPosition'], (result) => {
    if (!result.predefinedSizes) {
      chrome.storage.sync.set({
        predefinedSizes: [
          { width: 1920, height: 1080, name: "1920x1080" },
          { width: 1366, height: 768, name: "1366x768" },
          { width: 1280, height: 720, name: "1280x720" },
          { width: 1280, height: 760, name: "1280x760" }
        ]
      });
    }
    if (!result.recentSizes) {
      chrome.storage.sync.set({ recentSizes: [] });
    }
    // 添加默认位置设置
    if (!result.windowPosition) {
      chrome.storage.sync.set({ windowPosition: 'center' });
    }
  });
});

// 处理窗口位置的函数
async function setWindowPosition(windowId, position) {
  const display = await chrome.system.display.getInfo();
  const screen = display[0].workArea;
  
  const window = await chrome.windows.get(windowId);
  const { width, height } = window;
  
  let left, top;
  
  switch (position) {
    case 'topLeft':
      left = screen.left;
      top = screen.top;
      break;
    case 'topRight':
      left = screen.left + screen.width - width;
      top = screen.top;
      break;
    case 'center':
      left = screen.left + (screen.width - width) / 2;
      top = screen.top + (screen.height - height) / 2;
      break;
    case 'bottomLeft':
      left = screen.left;
      top = screen.top + screen.height - height;
      break;
    case 'bottomRight':
      left = screen.left + screen.width - width;
      top = screen.top + screen.height - height;
      break;
  }
  
  await chrome.windows.update(windowId, { left, top });
}

// 消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setWindowPosition') {
    chrome.windows.getCurrent(async (window) => {
      await setWindowPosition(window.id, request.position);
      sendResponse({ success: true });
    });
    return true; // 保持消息通道开启
  }
}); 