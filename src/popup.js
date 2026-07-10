const CONFIG = {
  MAX_RECENT_SIZES: 5,
  MIN_WINDOW_SIZE: 100,
  DEFAULT_SIZES: [
    { width: 1920, height: 1080, name: '1920x1080' },
    { width: 1366, height: 768, name: '1366x768' },
    { width: 1280, height: 720, name: '1280x720' },
    { width: 1280, height: 760, name: '1280x760' }
  ]
};

let predefinedSizes = [...CONFIG.DEFAULT_SIZES];
let recentSizes = [];
let positionActionInFlight = false;

document.addEventListener('DOMContentLoaded', initializePopup);

async function initializePopup() {
  setupSizeTabs();
  setupCustomSizeControls();
  setupPositionButtons();

  renderPredefinedSizes();
  renderRecentSizes([]);

  try {
    const storage = await chrome.storage.sync.get([
      'recentSizes',
      'predefinedSizes',
      'windowPosition'
    ]);

    if (Array.isArray(storage.predefinedSizes)) {
      predefinedSizes = normalizeSizes(storage.predefinedSizes);
    }

    recentSizes = normalizeSizes(storage.recentSizes || []).slice(0, CONFIG.MAX_RECENT_SIZES);

    renderPredefinedSizes();
    renderRecentSizes(recentSizes);
    setSelectedPosition(storage.windowPosition || null);
  } catch (error) {
    console.error(chrome.i18n.getMessage('initError'), error);
  }
}

function debounce(func, wait) {
  let timeout;

  return function debounced(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function normalizeSizes(sizes) {
  if (!Array.isArray(sizes)) {
    return [];
  }

  return sizes
    .map(size => ({
      width: Number(size?.width),
      height: Number(size?.height),
      name: size?.name
    }))
    .filter(size => (
      Number.isInteger(size.width)
      && Number.isInteger(size.height)
      && size.width >= CONFIG.MIN_WINDOW_SIZE
      && size.height >= CONFIG.MIN_WINDOW_SIZE
    ));
}

function getMessage(key, substitutions, fallback = '') {
  const message = substitutions === undefined
    ? chrome.i18n.getMessage(key)
    : chrome.i18n.getMessage(key, substitutions);
  return message || fallback;
}

function setupSizeTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      activateSizeTab(tab.dataset.tab);
    });

    tab.addEventListener('keydown', event => {
      const currentIndex = tabs.indexOf(tab);
      let nextIndex = null;

      if (event.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = tabs.length - 1;
      }

      if (nextIndex !== null) {
        event.preventDefault();
        activateSizeTab(tabs[nextIndex].dataset.tab, { focus: true });
      }
    });
  });
}

function activateSizeTab(tabName, options = {}) {
  const { focus = false } = options;
  const tabs = [...document.querySelectorAll('[role="tab"]')];

  tabs.forEach(tab => {
    const isActive = tab.dataset.tab === tabName;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));

    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.tabIndex = isActive ? 0 : -1;

    if (panel) {
      panel.hidden = !isActive;
    }

    if (isActive && focus) {
      tab.focus();
    }
  });
}

function renderSizeList(sizes, containerId, isRecent = false) {
  const container = document.getElementById(containerId);
  container.replaceChildren();

  if (sizes.length === 0 && !isRecent) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state size-grid-empty';
    emptyState.textContent = getMessage('noPredefinedSizes', undefined, 'No saved sizes yet.');
    container.append(emptyState);
    return;
  }

  sizes.forEach(size => {
    const formattedSize = getMessage(
      'sizeFormat',
      [size.width, size.height],
      `${size.width} × ${size.height}`
    );
    const resizeLabel = getMessage(
      'resizeWindowTo',
      [size.width, size.height],
      `Resize window to ${formattedSize}`
    );
    const deleteLabel = getMessage(
      isRecent ? 'removeRecentSize' : 'deleteSize',
      [size.width, size.height],
      isRecent ? `Remove ${formattedSize} from recent` : `Delete ${formattedSize}`
    );

    const item = document.createElement('div');
    item.className = 'size-item';

    const sizeButton = document.createElement('button');
    sizeButton.type = 'button';
    sizeButton.className = 'size-button';
    sizeButton.dataset.width = String(size.width);
    sizeButton.dataset.height = String(size.height);
    sizeButton.title = resizeLabel;
    sizeButton.setAttribute('aria-label', resizeLabel);
    sizeButton.textContent = formattedSize;
    sizeButton.addEventListener('click', () => {
      void Promise.allSettled([
        resizeWindow(size.width, size.height),
        addToRecentSizes({ width: size.width, height: size.height })
      ]);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-btn';
    deleteButton.textContent = '×';
    deleteButton.title = deleteLabel;
    deleteButton.setAttribute('aria-label', deleteLabel);
    deleteButton.addEventListener('click', event => {
      event.stopPropagation();

      if (isRecent) {
        void deleteRecentSize(size.width, size.height);
      } else {
        void deletePredefinedSize(size.width, size.height);
      }
    });

    item.append(sizeButton, deleteButton);
    container.append(item);
  });
}

function renderPredefinedSizes() {
  renderSizeList(predefinedSizes, 'predefined-sizes', false);
}

function renderRecentSizes(sizes) {
  recentSizes = normalizeSizes(sizes).slice(0, CONFIG.MAX_RECENT_SIZES);
  renderSizeList(recentSizes, 'recent-sizes', true);

  const emptyState = document.getElementById('recent-empty');
  emptyState.hidden = recentSizes.length > 0;
  document.getElementById('recent-count').textContent = String(recentSizes.length);
}

async function handleAsyncOperation(operation, errorMessageKey) {
  try {
    await operation();
  } catch (error) {
    console.error(chrome.i18n.getMessage(errorMessageKey), error);
  }
}

async function setWindowPosition(position, windowId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      action: 'setWindowPosition',
      position,
      windowId
    }, response => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

async function resizeWindow(width, height) {
  await handleAsyncOperation(async () => {
    const currentWindow = await chrome.windows.getCurrent();
    await chrome.windows.update(currentWindow.id, { width, height });

    const { windowPosition } = await chrome.storage.sync.get(['windowPosition']);
    if (windowPosition) {
      await setWindowPosition(windowPosition, currentWindow.id);
    }
  }, 'resizeError');
}

async function addToRecentSizes(size) {
  try {
    const { recentSizes: storedSizes = [] } = await chrome.storage.sync.get(['recentSizes']);
    const normalizedStoredSizes = normalizeSizes(storedSizes);
    const newRecentSizes = [
      size,
      ...normalizedStoredSizes.filter(storedSize => (
        storedSize.width !== size.width || storedSize.height !== size.height
      ))
    ].slice(0, CONFIG.MAX_RECENT_SIZES);

    await chrome.storage.sync.set({ recentSizes: newRecentSizes });
    renderRecentSizes(newRecentSizes);
  } catch (error) {
    console.error(chrome.i18n.getMessage('addRecentError'), error);
  }
}

function validateSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(chrome.i18n.getMessage('invalidSizeError'));
  }

  if (width < CONFIG.MIN_WINDOW_SIZE || height < CONFIG.MIN_WINDOW_SIZE) {
    throw new Error(chrome.i18n.getMessage('invalidSizeError'));
  }
}

function showCustomSizeError(message = '') {
  const errorElement = document.getElementById('custom-size-error');
  errorElement.textContent = message;
  errorElement.hidden = !message;
}

function setupCustomSizeControls() {
  const widthInput = document.getElementById('width');
  const heightInput = document.getElementById('height');
  const addButton = document.getElementById('add-custom');
  const getCurrentSizeButton = document.getElementById('getCurrentSize');

  addButton.addEventListener('click', () => {
    void addCustomSize();
  });

  [widthInput, heightInput].forEach(input => {
    input.addEventListener('input', () => showCustomSizeError());
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void addCustomSize();
      }
    });
  });

  getCurrentSizeButton.addEventListener('click', debounce(() => {
    void populateCurrentSize();
  }, 300));
}

async function populateCurrentSize() {
  await handleAsyncOperation(async () => {
    const currentWindow = await chrome.windows.getCurrent();
    const newSize = {
      width: currentWindow.width,
      height: currentWindow.height,
      name: `${currentWindow.width}x${currentWindow.height}`
    };

    document.getElementById('width').value = String(currentWindow.width);
    document.getElementById('height').value = String(currentWindow.height);
    showCustomSizeError();
    await addToRecentSizes(newSize);
  }, 'getCurrentSizeError');
}

async function addCustomSize() {
  const widthInput = document.getElementById('width');
  const heightInput = document.getElementById('height');
  const width = Number(widthInput.value);
  const height = Number(heightInput.value);

  try {
    validateSize(width, height);

    const isDuplicate = predefinedSizes.some(size => (
      size.width === width && size.height === height
    ));

    if (isDuplicate) {
      throw new Error(chrome.i18n.getMessage('duplicateSizeError'));
    }

    const newSize = { width, height, name: `${width}x${height}` };
    const newPredefinedSizes = [...predefinedSizes, newSize];

    await chrome.storage.sync.set({ predefinedSizes: newPredefinedSizes });
    predefinedSizes = newPredefinedSizes;
    renderPredefinedSizes();

    widthInput.value = '';
    heightInput.value = '';
    showCustomSizeError();

    document.getElementById('custom-size-panel').open = false;
    activateSizeTab('predefined');

    requestAnimationFrame(() => {
      const newSizeButton = document.querySelector(
        `.size-button[data-width="${width}"][data-height="${height}"]`
      );
      newSizeButton?.focus();
    });
  } catch (error) {
    showCustomSizeError(error.message);
  }
}

async function deletePredefinedSize(width, height) {
  try {
    const newPredefinedSizes = predefinedSizes.filter(size => (
      size.width !== width || size.height !== height
    ));

    await chrome.storage.sync.set({ predefinedSizes: newPredefinedSizes });
    predefinedSizes = newPredefinedSizes;
    renderPredefinedSizes();
  } catch (error) {
    console.error(chrome.i18n.getMessage('deletePredefinedError'), error);
  }
}

async function deleteRecentSize(width, height) {
  try {
    const { recentSizes: storedSizes = [] } = await chrome.storage.sync.get(['recentSizes']);
    const newRecentSizes = normalizeSizes(storedSizes).filter(size => (
      size.width !== width || size.height !== height
    ));

    await chrome.storage.sync.set({ recentSizes: newRecentSizes });
    renderRecentSizes(newRecentSizes);
  } catch (error) {
    console.error(chrome.i18n.getMessage('deleteRecentError'), error);
  }
}

function setupPositionButtons() {
  document.querySelectorAll('.position-btn').forEach(button => {
    button.addEventListener('click', () => {
      void applyWindowPosition(button.dataset.position);
    });
  });
}

function setSelectedPosition(position) {
  document.querySelectorAll('.position-btn').forEach(button => {
    const isSelected = button.dataset.position === position;
    button.classList.toggle('active', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
}

function setPositionButtonsDisabled(disabled) {
  document.querySelectorAll('.position-btn').forEach(button => {
    button.disabled = disabled;
  });
}

async function applyWindowPosition(position) {
  if (positionActionInFlight) {
    return;
  }

  const previousPosition = document.querySelector('.position-btn.active')?.dataset.position || null;
  positionActionInFlight = true;
  setSelectedPosition(position);
  setPositionButtonsDisabled(true);

  try {
    const currentWindow = await chrome.windows.getCurrent();
    await setWindowPosition(position, currentWindow.id);
    await chrome.storage.sync.set({ windowPosition: position });
  } catch (error) {
    setSelectedPosition(previousPosition);
    console.error(chrome.i18n.getMessage('positionError'), error);
  } finally {
    positionActionInFlight = false;
    setPositionButtonsDisabled(false);
  }
}
