import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const backgroundSource = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

// Drive the worker and the simulated window manager on one deterministic clock.
// This keeps asynchronous X11-style transitions in the tests without wall-clock waits.
function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async finish(promise) {
      let complete = false;
      let value;
      let failure;
      Promise.resolve(promise).then(result => {
        value = result;
        complete = true;
      }, error => {
        failure = error;
        complete = true;
      });
      for (let step = 0; step < 2000; step++) {
        // Chrome calls often resolve through several chained promises before
        // the worker schedules its next timer or sends its response.
        for (let tick = 0; tick < 100; tick++) await Promise.resolve();
        if (complete) {
          if (failure) throw failure;
          return value;
        }
        assert.ok(timers.size > 0, 'Worker did not respond or schedule more work');
        now = Math.min(...[...timers.values()].map(timer => timer.at));
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
        for (const [id, timer] of due) {
          if (timers.delete(id)) timer.callback();
        }
      }
      throw new Error('Worker did not settle within the simulated time limit');
    }
  };
}

function event() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    dispatch(...args) { for (const listener of listeners) listener(...args); }
  };
}

function storageArea(initial = {}) {
  const data = structuredClone(initial);
  const writes = [];
  return {
    data,
    writes,
    get(keys, callback) {
      let result;
      if (keys === null || keys === undefined) result = structuredClone(data);
      else if (typeof keys === 'string') result = { [keys]: structuredClone(data[keys]) };
      else if (Array.isArray(keys)) result = Object.fromEntries(keys.map(key => [key, structuredClone(data[key])]));
      else result = Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, structuredClone(data[key] ?? fallback)]));
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    set(values, callback) {
      writes.push(structuredClone(values));
      Object.assign(data, structuredClone(values));
      callback?.();
      return Promise.resolve();
    },
    remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      return Promise.resolve();
    }
  };
}

function createWorker(options = {}) {
  const clock = createClock();
  const windows = new Map((options.windows || [{
    id: 1, state: 'normal', left: 100, top: 100, width: 1000, height: 700
  }]).map(window => [window.id, { ...window }]));
  const updates = [];
  const screenReads = [];
  const errors = [];
  const sync = storageArea({ windowPosition: 'center', recentSizes: [], ...options.sync });
  const session = storageArea(options.session);
  const onBoundsChanged = event();
  const onRemoved = event();
  let messageListener;

  function snapshot(id) {
    if (!windows.has(id)) throw new Error(`No window with id: ${id}`);
    return { ...windows.get(id) };
  }

  function changeWindow(id, patch) {
    Object.assign(windows.get(id), patch);
    onBoundsChanged.dispatch(snapshot(id));
  }

  const chrome = {
    runtime: {
      onInstalled: event(),
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    windows: {
      onBoundsChanged,
      onRemoved,
      async get(id) { return snapshot(id); },
      getCurrent(callback) {
        const result = snapshot(options.currentWindowId || windows.keys().next().value);
        callback?.(result);
        return Promise.resolve(result);
      },
      async update(id, patch) {
        const before = snapshot(id);
        updates.push({ id, patch: { ...patch }, before, at: clock.now() });
        if (patch.state === 'normal' && options.restoreDelay) {
          clock.setTimeout(() => changeWindow(id, { state: 'normal', ...options.restoredBounds }), options.restoreDelay);
        } else if (patch.width !== undefined || patch.height !== undefined) {
          if (options.resizeError) throw new Error(options.resizeError);
          assert.equal(before.state, 'normal', 'Window must finish restoring before the resize request');
          if (options.onResize) options.onResize({ id, patch, changeWindow, clock, before });
          else changeWindow(id, {
            ...patch,
            ...(options.clampHeight ? { height: Math.min(patch.height, options.clampHeight) } : {})
          });
        } else if (patch.left !== undefined || patch.top !== undefined) {
          if (options.positionError) throw new Error(options.positionError);
          if (!options.ignorePosition) changeWindow(id, patch);
        } else changeWindow(id, patch);
        return snapshot(id);
      }
    },
    tabs: {
      async query(query) {
        assert.ok(Number.isInteger(query.windowId), 'Screen lookup must target the selected window');
        return [{ id: query.windowId * 10, windowId: query.windowId }];
      }
    },
    scripting: {
      async executeScript({ target, func }) {
        const windowId = target.tabId / 10;
        screenReads.push(windowId);
        if (options.restricted) throw new Error('Cannot access a chrome:// URL');
        const bounds = options.boundsByWindow?.[windowId] || options.bounds || { left: 0, top: 30, width: 1920, height: 1050 };
        return [{ result: vm.runInNewContext(`(${func.toString()})()`, {
          window: {
            screen: { availLeft: bounds.left, availTop: bounds.top, availWidth: bounds.width, availHeight: bounds.height },
            devicePixelRatio: options.dpr || 1
          }
        }) }];
      }
    },
    storage: { sync, session }
  };

  class ClockDate extends Date { static now() { return clock.now(); } }
  vm.runInNewContext(backgroundSource, {
    chrome,
    console: { warn: (...args) => errors.push(args), error: (...args) => errors.push(args), log() {} },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Date: ClockDate
  }, { filename: 'background.js' });

  return {
    clock, windows, updates, screenReads, errors, sync, session, changeWindow,
    request(action, fields = {}) {
      return new Promise(resolve => {
        const keepChannel = messageListener({ action, windowId: 1, ...fields }, {}, response => resolve(structuredClone(response)));
        assert.equal(keepChannel, true, 'Async responses must keep the message channel open');
      });
    },
    send(action, fields) { return clock.finish(this.request(action, fields)); }
  };
}

test('restores a maximized window and waits for normal state before requesting its size', async () => {
  const worker = createWorker({
    windows: [{ id: 1, state: 'maximized', left: 0, top: 30, width: 1920, height: 1050 }],
    restoreDelay: 180
  });
  const response = await worker.send('resizeWindow', { width: 1200, height: 800 });
  assert.equal(response.success, true);
  assert.deepEqual(worker.updates[0].patch, { state: 'normal' });
  const resize = worker.updates.find(update => update.patch.width !== undefined);
  assert.ok(resize.at >= 180);
  assert.equal(resize.before.state, 'normal');
  assert.equal(response.window.width, 1200);
  assert.equal(response.window.height, 800);
});

test('does not request a new size when the desktop never finishes restoring the window', async () => {
  const worker = createWorker({
    windows: [{ id: 1, state: 'fullscreen', left: 0, top: 0, width: 1920, height: 1080 }],
    restoreDelay: 10000
  });
  const response = await worker.send('resizeWindow', { width: 1200, height: 800 });
  assert.equal(response.success, false);
  assert.ok(response.error);
  assert.equal(worker.updates.filter(update => update.patch.width !== undefined).length, 0);
  assert.deepEqual(worker.sync.data.recentSizes, []);
});

test('restoring onto another monitor returns to the original screen before requesting the new size', async () => {
  const worker = createWorker({
    windows: [{ id: 1, state: 'maximized', left: 0, top: 30, width: 1920, height: 1050 }],
    restoreDelay: 180,
    restoredBounds: { left: 2200, top: 100, width: 1000, height: 700 },
    onResize({ id, patch, changeWindow, before }) {
      assert.ok(before.left < 1920 && before.left + before.width > 0, 'Resize must begin on the original target monitor');
      changeWindow(id, patch);
    }
  });
  const response = await worker.send('resizeWindow', { width: 1200, height: 800 });
  assert.equal(response.success, true);
  assert.equal(response.window.left, 360);
  assert.equal(response.bounds.left, 0);
  assert.deepEqual(worker.screenReads, [1]);
});

test('does not resize on the wrong monitor if the desktop ignores the return-to-screen move', async () => {
  const worker = createWorker({
    windows: [{ id: 1, state: 'maximized', left: 0, top: 30, width: 1920, height: 1050 }],
    restoreDelay: 180,
    restoredBounds: { left: 2200, top: 100, width: 1000, height: 700 },
    ignorePosition: true
  });
  const response = await worker.send('resizeWindow', { width: 1200, height: 800 });
  assert.equal(response.success, false);
  assert.ok(response.error);
  assert.equal(response.window.left, 2200);
  assert.equal(worker.updates.filter(update => update.patch.width !== undefined).length, 0);
  assert.deepEqual(worker.sync.data.recentSizes, []);
});

test('reports an oversize request without silently replacing the requested dimensions', async () => {
  const worker = createWorker();
  const response = await worker.send('resizeWindow', { width: 1200, height: 1090 });
  assert.equal(response.success, true);
  assert.equal(response.result.oversized, true);
  assert.equal(response.result.mismatch, false);
  assert.deepEqual(response.result.requested, { width: 1200, height: 1090 });
  assert.deepEqual(response.result.actual, { width: 1200, height: 1090 });
  assert.equal(response.window.top, 30);
  assert.equal(response.window.top + response.window.height - (response.bounds.top + response.bounds.height), 40);
});

test('reports a system-clamped size and records the actual dimensions in recent sizes', async () => {
  const worker = createWorker({ clampHeight: 1050 });
  const response = await worker.send('resizeWindow', { width: 1200, height: 1090 });
  assert.equal(response.success, true);
  assert.equal(response.result.oversized, true);
  assert.equal(response.result.mismatch, true);
  assert.deepEqual(response.result.actual, { width: 1200, height: 1050 });
  assert.equal(worker.sync.data.recentSizes[0].width, 1200);
  assert.equal(worker.sync.data.recentSizes[0].height, 1050);
});

test('checks the committed size after an asynchronous window-manager correction', async () => {
  const worker = createWorker({
    onResize({ id, patch, changeWindow, clock }) {
      clock.setTimeout(() => changeWindow(id, patch), 140);
      clock.setTimeout(() => changeWindow(id, { height: 1000 }), 360);
    }
  });
  const response = await worker.send('resizeWindow', { width: 1200, height: 1090 });
  assert.equal(response.result.mismatch, true);
  assert.deepEqual(response.result.actual, { width: 1200, height: 1000 });
  assert.equal(response.window.height, 1000);
});

test('reports an unsettled result when the desktop continues changing geometry until the deadline', async () => {
  const worker = createWorker({
    sync: { windowPosition: null },
    onResize({ id, patch, changeWindow, clock }) {
      changeWindow(id, patch);
      for (let step = 1; step <= 26; step++) {
        clock.setTimeout(() => changeWindow(id, { height: 1000 + step % 2 }), step * 100);
      }
    }
  });
  const response = await worker.send('resizeWindow', { width: 1200, height: 1090 });
  assert.equal(response.success, true);
  assert.equal(response.result.unsettled, true);
  assert.equal(response.result.mismatch, true);
  assert.ok(response.result.actual.height === 1000 || response.result.actual.height === 1001);
});

test('uses the current monitor with negative coordinates and does not scale its bounds by DPR', async () => {
  const bounds = { left: -1920, top: -100, width: 1920, height: 1160 };
  const worker = createWorker({
    windows: [{ id: 1, state: 'normal', left: -1800, top: 0, width: 1000, height: 700 }],
    bounds,
    dpr: 2
  });
  const response = await worker.send('resizeWindow', { width: 1200, height: 1090 });
  assert.equal(response.result.oversized, false);
  assert.deepEqual(response.bounds, bounds);
  assert.equal(response.window.left, -1560);
  assert.equal(response.window.top, -65);
  assert.deepEqual(worker.screenReads, [1]);
});

test('a restricted page still resizes while leaving the screen unknown and skipping positioning', async () => {
  const worker = createWorker({ restricted: true });
  const response = await worker.send('resizeWindow', { width: 1200, height: 1090 });
  assert.equal(response.success, true);
  assert.equal(response.bounds, null);
  assert.equal(response.result.bounds, null);
  assert.equal(response.window.width, 1200);
  assert.equal(response.window.height, 1090);
  assert.equal(worker.updates.filter(update => update.patch.left !== undefined).length, 0);
  assert.equal(response.window.left, 100);
});

test('invalid screen geometry is treated as unknown instead of fabricating primary-monitor bounds', async () => {
  const worker = createWorker({ bounds: { left: 0, top: 0, width: 0, height: 1050 } });
  const response = await worker.send('resizeWindow', { width: 1200, height: 800 });
  assert.equal(response.success, true);
  assert.equal(response.bounds, null);
  assert.equal(worker.updates.filter(update => update.patch.left !== undefined).length, 0);
});

test('a rejected size request returns an error and does not add a misleading recent size', async () => {
  const worker = createWorker({ resizeError: 'Window manager rejected resize' });
  const response = await worker.send('resizeWindow', { width: 1200, height: 1090 });
  assert.equal(response.success, false);
  assert.match(response.error, /rejected resize/);
  assert.deepEqual(worker.sync.data.recentSizes, []);
  assert.deepEqual(response.result.requested, { width: 1200, height: 1090 });
  assert.deepEqual(response.result.actual, { width: 1000, height: 700 });
});

test('rejects invalid message dimensions before changing the window', async () => {
  const worker = createWorker();
  for (const dimensions of [
    { width: 0, height: 800 },
    { width: 1200.5, height: 800 },
    { width: Infinity, height: 800 },
    { width: 1200, height: NaN }
  ]) {
    const response = await worker.send('resizeWindow', dimensions);
    assert.equal(response.success, false);
    assert.ok(response.error);
  }
  assert.equal(worker.updates.length, 0);
  assert.deepEqual(worker.sync.data.recentSizes, []);
});

test('a failed position update preserves the completed resize and returns its separate warning', async () => {
  const worker = createWorker({ positionError: 'Position denied by desktop' });
  const response = await worker.send('resizeWindow', { width: 1200, height: 800 });
  assert.equal(response.success, true);
  assert.equal(response.result.positionFailed, true);
  assert.match(response.result.positionError, /Position denied/);
  assert.deepEqual(response.result.actual, { width: 1200, height: 800 });
  assert.equal(worker.sync.data.recentSizes[0].height, 800);
});

test('a silently ignored move is reported as a position warning after a successful resize', async () => {
  const worker = createWorker({ ignorePosition: true });
  const response = await worker.send('resizeWindow', { width: 1200, height: 800 });
  assert.equal(response.success, true);
  assert.equal(response.result.positionFailed, true);
  assert.equal(response.window.left, 100);
  assert.equal(response.window.top, 100);
  assert.deepEqual(response.result.actual, { width: 1200, height: 800 });
});

test('the last result is available to a reopened popup and metrics reads never restore or move the window', async () => {
  const worker = createWorker({ clampHeight: 1050 });
  const resized = await worker.send('resizeWindow', { width: 1200, height: 1090 });
  const stored = worker.session.data['windowResizeResult:1'];
  assert.deepEqual(stored, resized.result);
  worker.changeWindow(1, { state: 'maximized' });
  const updateCount = worker.updates.length;
  const metrics = await worker.send('getWindowMetrics');
  assert.equal(metrics.success, true);
  assert.equal(metrics.window.state, 'maximized');
  assert.deepEqual(metrics.result, resized.result);
  assert.equal(worker.updates.length, updateCount);
});

test('a popup reopened during an in-flight resize reads the completed metrics and persisted result', async () => {
  const worker = createWorker({
    onResize({ id, patch, changeWindow, clock }) {
      clock.setTimeout(() => changeWindow(id, patch), 180);
    }
  });
  const resizing = worker.request('resizeWindow', { width: 1200, height: 800 });
  const reopenedMetrics = worker.request('getWindowMetrics');
  const [resized, metrics] = await worker.clock.finish(Promise.all([resizing, reopenedMetrics]));
  assert.equal(resized.success, true);
  assert.equal(metrics.window.width, 1200);
  assert.equal(metrics.window.height, 800);
  assert.deepEqual(metrics.result, resized.result);
  assert.deepEqual(worker.session.data['windowResizeResult:1'], metrics.result);
});

test('standalone positioning reports the actual API failure', async () => {
  const worker = createWorker({ positionError: 'Position denied by desktop' });
  const response = await worker.send('setWindowPosition', { position: 'topRight' });
  assert.equal(response.success, false);
  assert.match(response.error, /Position denied/);
});

test('operations for the same window do not interleave their size and position updates', async () => {
  const worker = createWorker();
  const first = worker.request('resizeWindow', { width: 1200, height: 800 });
  const second = worker.request('resizeWindow', { width: 1300, height: 850 });
  const responses = await worker.clock.finish(Promise.all([first, second]));
  assert.equal(responses[0].success, true);
  assert.equal(responses[1].success, true);
  assert.equal(responses[0].window.width, 1200);
  assert.equal(responses[1].window.width, 1300);
  const sizeIndices = worker.updates.flatMap((update, index) => update.patch.width === undefined ? [] : [index]);
  assert.equal(sizeIndices.length, 2);
  assert.ok(worker.updates.slice(sizeIndices[0] + 1, sizeIndices[1]).some(update => update.patch.left !== undefined));
});

test('concurrent requests use each selected window and its own monitor', async () => {
  const worker = createWorker({
    windows: [
      { id: 1, state: 'normal', left: 100, top: 100, width: 1000, height: 700 },
      { id: 2, state: 'normal', left: -1800, top: 100, width: 900, height: 650 }
    ],
    boundsByWindow: {
      1: { left: 0, top: 30, width: 1920, height: 1050 },
      2: { left: -1920, top: 0, width: 1920, height: 1200 }
    }
  });
  const requests = [
    worker.request('resizeWindow', { windowId: 1, width: 1200, height: 800 }),
    worker.request('resizeWindow', { windowId: 2, width: 1100, height: 900 })
  ];
  const [first, second] = await worker.clock.finish(Promise.all(requests));
  assert.equal(first.window.id, 1);
  assert.equal(second.window.id, 2);
  assert.equal(first.window.left, 360);
  assert.equal(second.window.left, -1510);
  assert.equal(second.window.top, 150);
  assert.equal(worker.session.data['windowResizeResult:1'].actual.width, 1200);
  assert.equal(worker.session.data['windowResizeResult:2'].actual.width, 1100);
  assert.ok(worker.sync.data.recentSizes.some(size => size.width === 1200 && size.height === 800));
  assert.ok(worker.sync.data.recentSizes.some(size => size.width === 1100 && size.height === 900));
});
