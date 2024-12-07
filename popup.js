// 添加配置常量
const CONFIG = {
  MAX_RECENT_SIZES: 5,
  MIN_WINDOW_SIZE: 100,
  DEFAULT_SIZES: [
    { width: 1920, height: 1080, name: "1920x1080" },
    { width: 1366, height: 768, name: "1366x768" },
    { width: 1280, height: 720, name: "1280x720" },
    { width: 1280, height: 760, name: "1280x760" }
  ]
};

// 预定义尺寸列表
let predefinedSizes = CONFIG.DEFAULT_SIZES;

// 添加防抖函数
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // 获取存储的数据
    const storage = await chrome.storage.sync.get(['recentSizes', 'predefinedSizes', 'windowPosition']);
    
    if (storage.predefinedSizes) {
      predefinedSizes = storage.predefinedSizes;
    }
    
    // 渲染所有尺寸列表
    renderPredefinedSizes();
    renderRecentSizes(storage.recentSizes || []);
    
    // 绑定自定义尺寸添加按钮事件
    document.getElementById('add-custom').addEventListener('click', addCustomSize);

    // 添加获取当前尺寸按钮的事件监听
    document.getElementById('getCurrentSize').addEventListener('click', 
      debounce(async () => {
        // 获取当前窗口信息
        const currentWindow = await chrome.windows.getCurrent();
        
        // 填充到输入框
        document.getElementById('width').value = currentWindow.width;
        document.getElementById('height').value = currentWindow.height;

        const newSize = {
          width: currentWindow.width,
          height: currentWindow.height,
          name: `${currentWindow.width}x${currentWindow.height
}`      };

        // 添加到最近使用的尺寸列表
        const storage = await chrome.storage.sync.get(['recentSizes']);
        const recentSizes = storage.recentSizes || [];
        const updatedSizes = [newSize, ...recentSizes.filter(size => 
          size.width !== newSize.width || size.height !== newSize.height
        )].slice(0, 10); // 保留最近10个尺寸

        // 保存到 storage
        await chrome.storage.sync.set({ recentSizes: updatedSizes });
        
        // 刷新显示
        renderRecentSizes(updatedSizes);
      }, 300)
    );

    // 在页面加载时设置当前选中的位置
    if (storage.windowPosition) {
      const btn = document.querySelector(`[data-position="${storage.windowPosition}"]`);
      if (btn) {
        btn.classList.add('active');
      }
    }
  } catch (error) {
    console.error(chrome.i18n.getMessage('initError'), error);
  }
});

// 合并 renderPredefinedSizes 和 renderRecentSizes 函数，因为它们的逻辑非常相似
function renderSizeList(sizes, containerId, isRecent = false) {
  const container = document.getElementById(containerId);
  const html = sizes.map(size => `
    <div class="size-item" data-width="${size.width}" data-height="${size.height}">
      <div class="size-item-content">
        <span class="size-text">${chrome.i18n.getMessage('sizeFormat', [size.width, size.height])}</span>
        <span class="delete-btn" title="${chrome.i18n.getMessage(isRecent ? 'removeFromRecent' : 'delete')}">×</span>
      </div>
      <button class="apply-btn" title="${chrome.i18n.getMessage('resizeWindowTo', [size.width, size.height])}">${chrome.i18n.getMessage('apply')}</button>
    </div>
  `).join('');
  
  container.innerHTML = html;
  
  // 添加点击事件
  container.querySelectorAll('.size-item').forEach(item => {
    item.querySelector('.apply-btn').addEventListener('click', () => {
      const width = parseInt(item.dataset.width);
      const height = parseInt(item.dataset.height);
      resizeWindow(width, height);
      addToRecentSizes({ width, height });
    });
    
    item.querySelector('.delete-btn').addEventListener('click', () => {
      const width = parseInt(item.dataset.width);
      const height = parseInt(item.dataset.height);
      isRecent ? deleteRecentSize(width, height) : deletePredefinedSize(width, height);
    });
  });
}

// 使用新的渲染函数
function renderPredefinedSizes() {
  renderSizeList(predefinedSizes, 'predefined-sizes', false);
}

function renderRecentSizes(sizes) {
  renderSizeList(sizes, 'recent-sizes', true);
}

// 添加统一的错误处理函数
async function handleAsyncOperation(operation, errorMessageKey) {
  try {
    await operation();
  } catch (error) {
    console.error(chrome.i18n.getMessage(errorMessageKey), error);
  }
}

// 添加 setWindowPosition 函数
async function setWindowPosition(position) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'setWindowPosition',
      position: position
    }, response => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

// 修改 resizeWindow 函数
async function resizeWindow(width, height) {
  await handleAsyncOperation(async () => {
    const window = await chrome.windows.getCurrent();
    await chrome.windows.update(window.id, { width, height });
    
    // 获取保存的位置设置并应用
    const { windowPosition } = await chrome.storage.sync.get(['windowPosition']);
    if (windowPosition) {
      await setWindowPosition(windowPosition);
    }
  }, 'resizeError');
}

// 添加到最近使用
async function addToRecentSizes(size) {
  try {
    const { recentSizes = [] } = await chrome.storage.sync.get(['recentSizes']);
    // 移除重复的尺寸
    const newRecentSizes = [size, ...recentSizes.filter(s => 
      s.width !== size.width || s.height !== size.height
    )].slice(0, 5); // 只保留最近5个
    
    await chrome.storage.sync.set({ recentSizes: newRecentSizes });
    renderRecentSizes(newRecentSizes);
  } catch (error) {
    console.error(chrome.i18n.getMessage('addRecentError'), error);
  }
}

// 添加验证函数
function validateSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(chrome.i18n.getMessage('invalidSizeError'));
  }
  
  if (width < CONFIG.MIN_WINDOW_SIZE || height < CONFIG.MIN_WINDOW_SIZE) {
    throw new Error(chrome.i18n.getMessage('invalidSizeError'));
  }
  
  return true;
}

// 添加自定义尺寸
async function addCustomSize() {
  const width = parseInt(document.getElementById('width').value);
  const height = parseInt(document.getElementById('height').value);
  
  try {
    validateSize(width, height);
    // 检查是否已存在相同尺寸
    const isDuplicate = predefinedSizes.some(size => 
      size.width === width && size.height === height
    );

    if (isDuplicate) {
      alert(chrome.i18n.getMessage('duplicateSizeError') || '该尺寸已存在！');
      return;
    }

    const newSize = { width, height, name: `${width}×${height}` };
    predefinedSizes.push(newSize);
    await chrome.storage.sync.set({ predefinedSizes });
    renderPredefinedSizes();
    
    // 清空输入框
    document.getElementById('width').value = '';
    document.getElementById('height').value = '';
  } catch (error) {
    alert(error.message);
    return;
  }
}

// 删除预定义尺寸
async function deletePredefinedSize(width, height) {
  try {
    predefinedSizes = predefinedSizes.filter(s => 
      s.width !== width || s.height !== height
    );
    await chrome.storage.sync.set({ predefinedSizes });
    renderPredefinedSizes();
  } catch (error) {
    console.error(chrome.i18n.getMessage('deletePredefinedError'), error);
  }
}

// 删除最近使用尺寸
async function deleteRecentSize(width, height) {
  try {
    const { recentSizes = [] } = await chrome.storage.sync.get(['recentSizes']);
    const newRecentSizes = recentSizes.filter(s => 
      s.width !== width || s.height !== height
    );
    await chrome.storage.sync.set({ recentSizes: newRecentSizes });
    renderRecentSizes(newRecentSizes);
  } catch (error) {
    console.error(chrome.i18n.getMessage('deleteRecentError'), error);
  }
}

// createSizeItem 函数可以删除，因为它没有被使用 

// 修改位置按钮的点击事件处理
document.querySelectorAll('.position-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const position = btn.dataset.position;
    // 保存位置设置
    await chrome.storage.sync.set({ windowPosition: position });
    
    // 更新按钮样式
    document.querySelectorAll('.position-btn').forEach(b => {
      b.classList.remove('active');
    });
    btn.classList.add('active');
    
    // 立即应用到当前窗口
    await setWindowPosition(position);
  });
});

// 在页面加载时设置当前选中的位置
document.addEventListener('DOMContentLoaded', async () => {
  const { windowPosition } = await chrome.storage.sync.get(['windowPosition']);
  if (windowPosition) {
    const btn = document.querySelector(`[data-position="${windowPosition}"]`);
    if (btn) {
      btn.classList.add('active');
    }
  }
});