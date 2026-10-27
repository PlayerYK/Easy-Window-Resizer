const WINDOW_POLL_INTERVAL_MS = 100;
const WINDOW_QUIET_PERIOD_MS = 300;
const WINDOW_MIN_SETTLE_MS = 400;
const WINDOW_SETTLE_TIMEOUT_MS = 2400;
const MAX_WINDOW_DIMENSION = 2147483647;
const POSITION_TOLERANCE_PX = 2;
const WINDOW_POSITIONS = new Set(['topLeft', 'topRight', 'center', 'bottomLeft', 'bottomRight']);
const windowOperations = new Map();
let recentSizesOperation = Promise.resolve();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['predefinedSizes', 'recentSizes', 'windowPosition'], (result) => {
    if (!result.predefinedSizes) {
      chrome.storage.sync.set({
        predefinedSizes: [
          { width: 1920, height: 1080, name: '1920x1080' },
          { width: 1366, height: 768, name: '1366x768' },
          { width: 1280, height: 720, name: '1280x720' },
          { width: 1280, height: 760, name: '1280x760' }
        ]
      });
    }
    if (!result.recentSizes) {
      chrome.storage.sync.set({ recentSizes: [] });
    }
    if (!result.windowPosition) {
      chrome.storage.sync.set({ windowPosition: 'center' });
    }
  });
});

function resultStorageKey(windowId) {
  return `windowResizeResult:${windowId}`;
}

function errorMessage(error) {
  return error?.message || String(error);
}

function isDimension(value, minimum = 1) {
  return Number.isInteger(value) && value >= minimum && value <= MAX_WINDOW_DIMENSION;
}

function getActualSize(win) {
  return win && isDimension(win.width) && isDimension(win.height)
    ? { width: win.width, height: win.height }
    : null;
}

function windowIntersectsBounds(win, bounds) {
  return win.left < bounds.left + bounds.width
    && win.left + win.width > bounds.left
    && win.top < bounds.top + bounds.height
    && win.top + win.height > bounds.top;
}

function positionMatches(win, position) {
  // A window manager may round or slightly adjust a requested coordinate.
  return Math.abs(win.left - position.left) <= POSITION_TOLERANCE_PX
    && Math.abs(win.top - position.top) <= POSITION_TOLERANCE_PX;
}

function normalizeScreenBounds(bounds, win) {
  if (!bounds
    || !Number.isInteger(bounds.left)
    || !Number.isInteger(bounds.top)
    || !isDimension(bounds.width)
    || !isDimension(bounds.height)) {
    return null;
  }

  // Never use another display as a fallback if the reported area does not
  // intersect the target window. Negative display coordinates are valid.
  if (win && !windowIntersectsBounds(win, bounds)) return null;

  return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
}

async function getCurrentScreenBounds(windowId, win) {
  try {
    const tabs = await chrome.tabs.query({ active: true, windowId });
    const tabId = tabs?.[0]?.id;
    if (!Number.isInteger(tabId)) return null;

    const [injectionResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        left: window.screen.availLeft,
        top: window.screen.availTop,
        width: window.screen.availWidth,
        height: window.screen.availHeight
      })
    });
    return normalizeScreenBounds(injectionResult?.result, win);
  } catch (error) {
    // Restricted pages and missing temporary access only prevent reading the
    // work area; they must not prevent resizing or verifying the actual size.
    console.warn('Unable to read the current screen work area:', error);
    return null;
  }
}

async function readResizeResult(windowId) {
  try {
    const key = resultStorageKey(windowId);
    const stored = await chrome.storage.session.get(key);
    return stored[key] || null;
  } catch (error) {
    console.warn('Unable to read the last resize result:', error);
    return null;
  }
}

async function saveResizeResult(windowId, result) {
  try {
    await chrome.storage.session.set({ [resultStorageKey(windowId)]: result });
  } catch (error) {
    console.warn('Unable to save the resize result:', error);
  }
}

async function getWindowMetrics(windowId) {
  const win = await chrome.windows.get(windowId);
  const [bounds, result] = await Promise.all([
    getCurrentScreenBounds(windowId, win),
    readResizeResult(windowId)
  ]);
  return { success: true, window: win, bounds, result };
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function windowGeometryKey(win) {
  return [win.state, win.left, win.top, win.width, win.height].join(':');
}

// X11/Wayland window managers can commit a resize after windows.update has
// resolved. Wait for a quiet period, and allow an unmatched request the full
// deadline before reporting the system's actual result.
async function waitForStableWindow(windowId, { state, size, position } = {}) {
  const startedAt = Date.now();
  let unchangedSince = startedAt;
  let previousGeometry = null;

  while (true) {
    const win = await chrome.windows.get(windowId);
    const now = Date.now();
    const geometry = windowGeometryKey(win);
    if (geometry !== previousGeometry) {
      previousGeometry = geometry;
      unchangedSince = now;
    }
    const matches = (!state || win.state === state)
      && (!size || (win.width === size.width && win.height === size.height))
      && (!position || positionMatches(win, position));
    if ((matches
      && now - startedAt >= WINDOW_MIN_SETTLE_MS
      && now - unchangedSince >= WINDOW_QUIET_PERIOD_MS)
      || now - startedAt >= WINDOW_SETTLE_TIMEOUT_MS) {
      return {
        window: win,
        settled: now - startedAt >= WINDOW_MIN_SETTLE_MS
          && now - unchangedSince >= WINDOW_QUIET_PERIOD_MS
      };
    }
    await delay(WINDOW_POLL_INTERVAL_MS);
  }
}

async function restoreNormalWindow(windowId, win) {
  if (win.state !== 'normal') {
    await chrome.windows.update(windowId, { state: 'normal' });
    const restored = await waitForStableWindow(windowId, { state: 'normal' });
    win = restored.window;
    if (win.state !== 'normal' || !restored.settled) {
      throw new Error('The window could not be restored to a stable normal state.');
    }
  }
  return win;
}

function getPositionCoordinates(win, bounds, position) {
  let left = bounds.left;
  let top = bounds.top;
  if (position === 'topRight' || position === 'bottomRight') {
    left += Math.max(0, bounds.width - win.width);
  } else if (position === 'center') {
    left += Math.max(0, (bounds.width - win.width) / 2);
  }
  if (position === 'bottomLeft' || position === 'bottomRight') {
    top += Math.max(0, bounds.height - win.height);
  } else if (position === 'center') {
    top += Math.max(0, (bounds.height - win.height) / 2);
  }
  return { left: Math.round(left), top: Math.round(top) };
}

async function moveWindow(windowId, win, bounds, position) {
  const coordinates = getPositionCoordinates(win, bounds, position);
  await chrome.windows.update(windowId, coordinates);
  const moved = await waitForStableWindow(windowId, {
    state: 'normal', size: getActualSize(win), position: coordinates
  });
  return { ...moved, positioned: positionMatches(moved.window, coordinates) };
}

async function returnToTargetScreen(windowId, win, bounds, position) {
  if (!bounds || windowIntersectsBounds(win, bounds)) return win;

  // Restoring can bring back saved bounds on another display. Move back before
  // applying the requested size, so that display's limits do not affect it.
  const coordinates = getPositionCoordinates(win, bounds,
    WINDOW_POSITIONS.has(position) ? position : 'topLeft');
  await chrome.windows.update(windowId, coordinates);
  const moved = await waitForStableWindow(windowId, { state: 'normal', position: coordinates });
  if (!moved.settled || moved.window.state !== 'normal'
    || !windowIntersectsBounds(moved.window, bounds)) {
    throw new Error('The restored window could not be moved back to the target screen.');
  }
  return moved.window;
}

function recordRecentActualSize(actual) {
  // Serialize the shared history as well as per-window operations, so resizes
  // on two different displays do not overwrite one another's recent entries.
  const operation = recentSizesOperation.catch(() => {}).then(async () => {
    const { recentSizes = [] } = await chrome.storage.sync.get(['recentSizes']);
    const validSizes = Array.isArray(recentSizes) ? recentSizes.filter(size => (
      isDimension(size?.width, 100) && isDimension(size?.height, 100)
    )) : [];
    await chrome.storage.sync.set({
      recentSizes: [actual, ...validSizes.filter(size => (
        size.width !== actual.width || size.height !== actual.height
      ))].slice(0, 5)
    });
  });
  recentSizesOperation = operation;
  return operation.catch(error => {
    console.warn('Unable to save the actual size to recent sizes:', error);
  });
}

async function getWindowSafely(windowId) {
  try {
    return await chrome.windows.get(windowId);
  } catch {
    return null;
  }
}

async function resizeWindow(windowId, width, height) {
  if (!isDimension(width, 100) || !isDimension(height, 100)) {
    throw new Error('Please enter valid whole-number dimensions of at least 100.');
  }

  let win = await chrome.windows.get(windowId);
  // Capture the target display before restoring or resizing can move the
  // window to a different display. These coordinates are already logical px.
  const bounds = await getCurrentScreenBounds(windowId, win);
  const requested = { width, height };
  const result = {
    requested,
    actual: getActualSize(win),
    bounds,
    oversized: Boolean(bounds && (width > bounds.width || height > bounds.height)),
    mismatch: false,
    positionFailed: false,
    unsettled: false
  };
  let sizeApplied = false;
  let failure = null;

  try {
    const { windowPosition } = await chrome.storage.sync.get(['windowPosition']);
    win = await restoreNormalWindow(windowId, win);
    win = await returnToTargetScreen(windowId, win, bounds, windowPosition);
    await chrome.windows.update(windowId, requested);
    sizeApplied = true;
    const resized = await waitForStableWindow(windowId, { state: 'normal', size: requested });
    win = resized.window;
    result.unsettled = !resized.settled;

    if (bounds && WINDOW_POSITIONS.has(windowPosition)) {
      try {
        const positioned = await moveWindow(windowId, win, bounds, windowPosition);
        win = positioned.window;
        result.unsettled = !positioned.settled;
        if (!positioned.positioned) {
          throw new Error('The window manager did not apply the requested position.');
        }
      } catch (error) {
        result.positionFailed = true;
        result.positionError = errorMessage(error);
        win = await chrome.windows.get(windowId);
      }
    }
    if (win.state !== 'normal') {
      throw new Error('The window did not stay in its normal state.');
    }
  } catch (error) {
    failure = errorMessage(error);
    result.error = failure;
    win = await getWindowSafely(windowId);
  }

  result.actual = getActualSize(win);
  result.mismatch = Boolean(result.actual && (
    result.actual.width !== width || result.actual.height !== height
  ));
  if (sizeApplied && result.actual) {
    await recordRecentActualSize(result.actual);
  }
  await saveResizeResult(windowId, result);
  return { success: !failure, window: win, bounds, result, ...(failure ? { error: failure } : {}) };
}

async function setWindowPosition(windowId, position) {
  if (!WINDOW_POSITIONS.has(position)) {
    throw new Error('Invalid window position.');
  }
  let win = await chrome.windows.get(windowId);
  const bounds = await getCurrentScreenBounds(windowId, win);
  if (!bounds) {
    return {
      success: false,
      error: 'The current screen work area is unavailable. Open a regular webpage and try again.',
      window: win,
      bounds: null,
      result: null
    };
  }
  try {
    win = await restoreNormalWindow(windowId, win);
    const positioned = await moveWindow(windowId, win, bounds, position);
    win = positioned.window;
    if (!positioned.settled || !positioned.positioned || win.state !== 'normal') {
      throw new Error('The window position did not settle.');
    }
    await chrome.storage.sync.set({ windowPosition: position });
    return { success: true, window: win, bounds, result: await readResizeResult(windowId) };
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
      window: await getWindowSafely(windowId),
      bounds,
      result: null
    };
  }
}

function runWindowOperation(windowId, operation) {
  const previous = windowOperations.get(windowId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  windowOperations.set(windowId, current);
  const cleanup = () => {
    if (windowOperations.get(windowId) === current) windowOperations.delete(windowId);
  };
  current.then(cleanup, cleanup);
  return current;
}

async function handleWindowRequest(request) {
  let windowId = request.windowId;
  if (windowId === undefined || windowId === null) {
    windowId = (await chrome.windows.getCurrent()).id;
  }
  if (!Number.isInteger(windowId) || windowId < 0) {
    throw new Error('Invalid window ID.');
  }
  if (request.action === 'getWindowMetrics') {
    // A popup reopened during an in-flight resize must see the completed result.
    await windowOperations.get(windowId)?.catch(() => {});
    return getWindowMetrics(windowId);
  }
  return runWindowOperation(windowId, () => request.action === 'resizeWindow'
    ? resizeWindow(windowId, request.width, request.height)
    : setWindowPosition(windowId, request.position));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!['getWindowMetrics', 'resizeWindow', 'setWindowPosition'].includes(request?.action)) return;
  handleWindowRequest(request).then(sendResponse, error => sendResponse({
    success: false,
    error: errorMessage(error),
    window: null,
    bounds: null,
    result: null
  }));
  return true;
});

chrome.windows.onRemoved.addListener(windowId => {
  chrome.storage.session.remove(resultStorageKey(windowId)).catch(error => {
    console.warn('Unable to remove the closed window resize result:', error);
  });
});
