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

// 获取活动标签页的 tabId（无需 tabs 权限）
async function getActiveTabId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0]?.id ?? null;
  } catch (e) {
    console.warn('获取活动标签页失败:', e);
    return null;
  }
}

// 从活动标签页注入脚本，获取当前屏幕的可用区域
async function getCurrentScreenBounds() {
  const tabId = await getActiveTabId();
  if (!tabId) return null;
  try {
    const [injectionResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          return {
            left: window.screen.availLeft,
            top: window.screen.availTop,
            width: window.screen.availWidth,
            height: window.screen.availHeight,
            dpr: window.devicePixelRatio
          };
        } catch (e) {
          return null;
        }
      }
    });
    return injectionResult?.result ?? null;
  } catch (e) {
    // 受限页面（如 chrome://、商店页）会抛错
    console.warn('获取屏幕边界失败，将降级为仅调整尺寸:', e);
    return null;
  }
}

// 处理窗口位置的函数（在“当前屏幕”内定位）
async function setWindowPosition(windowId, position) {
  try {
    const bounds = await getCurrentScreenBounds();

    // 获取窗口信息
    let win = await chrome.windows.get(windowId);

    // 如果处于最大化/全屏/停靠等状态，先恢复到 normal 再移动
    if (win.state && win.state !== 'normal') {
      await chrome.windows.update(windowId, { state: 'normal' });
      win = await chrome.windows.get(windowId);
    }

    // 注入失败时，保守降级：不移动，仅返回成功
    if (!bounds) {
      return;
    }

    const { width, height } = win;
    const { left: sLeft, top: sTop, width: sWidth, height: sHeight } = bounds;

    let left, top;
    switch (position) {
      case 'topLeft':
        left = sLeft;
        top = sTop;
        break;
      case 'topRight':
        left = sLeft + Math.max(0, sWidth - width);
        top = sTop;
        break;
      case 'center':
        left = sLeft + Math.max(0, (sWidth - width) / 2);
        top = sTop + Math.max(0, (sHeight - height) / 2);
        break;
      case 'bottomLeft':
        left = sLeft;
        top = sTop + Math.max(0, sHeight - height);
        break;
      case 'bottomRight':
        left = sLeft + Math.max(0, sWidth - width);
        top = sTop + Math.max(0, sHeight - height);
        break;
      default:
        left = win.left ?? sLeft;
        top = win.top ?? sTop;
        break;
    }

    await chrome.windows.update(windowId, { left: Math.round(left), top: Math.round(top) });
  } catch (e) {
    console.warn('设置窗口位置失败:', e);
  }
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
