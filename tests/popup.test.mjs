import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const popupSource = fs.readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');
const translations = JSON.parse(fs.readFileSync(new URL('../src/_locales/zh_CN/messages.json', import.meta.url), 'utf8'));

class Element {
  children = [];
  dataset = {};
  hidden = false;
  disabled = false;
  attributes = {};
  classList = { toggle() {} };
  _textContent = '';
  set textContent(value) { this._textContent = String(value); this.children = []; }
  get textContent() { return this._textContent + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._textContent = ''; this.children = [...children]; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener() {}
}

function translated(key, substitutions = []) {
  const entry = translations[key];
  if (!entry) return '';
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  return entry.message.replace(/\$([A-Z0-9_]+)\$/g, (_, name) => {
    const content = entry.placeholders?.[name.toLowerCase()]?.content;
    return content ? String(values[Number(content.slice(1)) - 1] ?? '') : '';
  });
}

const bounds = { left: 0, top: 30, width: 1920, height: 1050 };
const normalWindow = { id: 7, state: 'normal', left: 360, top: 30, width: 1200, height: 1050 };

function resizeResult(overrides = {}) {
  return {
    requested: { width: 1200, height: 1090 },
    actual: { width: 1200, height: 1050 },
    bounds,
    oversized: true,
    mismatch: true,
    positionFailed: false,
    ...overrides
  };
}

function createPopup(options = {}) {
  const elements = new Map();
  const controls = [new Element(), new Element()];
  const requests = [];
  const storageWrites = [];
  let metrics = options.metrics || { success: true, window: normalWindow, bounds, result: null };
  const document = {
    addEventListener() {},
    createElement: () => new Element(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    querySelectorAll: () => controls
  };
  const chrome = {
    i18n: { getMessage: translated },
    runtime: {
      sendMessage(request, callback) {
        requests.push(structuredClone(request));
        if (options.onRequest) options.onRequest(request, callback);
        else callback(request.action === 'resizeWindow' && options.resizeResponse ? options.resizeResponse : metrics);
      }
    },
    windows: {
      async getCurrent() { return { id: 7 }; },
      update() { assert.fail('Popup must let the background worker complete window changes'); }
    },
    storage: {
      sync: {
        async get() { return { recentSizes: options.recentSizes || [] }; },
        async set(values) { storageWrites.push(values); }
      }
    }
  };
  const context = vm.createContext({ chrome, document, console, setTimeout, clearTimeout });
  vm.runInContext(popupSource, context, { filename: 'popup.js' });
  return {
    requests, storageWrites, controls,
    element: id => document.getElementById(id),
    run: source => vm.runInContext(source, context),
    setMetrics(value) { metrics = value; }
  };
}

test('shows current dimensions and distinct oversize and system-mismatch warnings with the requested size', () => {
  const popup = createPopup();
  popup.run(`displayWindowMetrics(${JSON.stringify({ window: normalWindow, bounds })}); displayResizeResult(${JSON.stringify(resizeResult())});`);
  assert.equal(popup.element('actual-window-size').textContent, '1200 × 1050');
  assert.equal(popup.element('screen-available-size').textContent, '1920 × 1050');
  assert.equal(popup.element('resize-feedback').hidden, false);
  assert.equal(popup.element('resize-feedback').dataset.tone, 'warning');
  assert.match(popup.element('resize-feedback').title, /1200 × 1090/);
  const text = popup.element('resize-messages').textContent;
  assert.match(text, /超出可用区域/);
  assert.match(text, /请求 1200 × 1090/);
  assert.match(text, /实际 1200 × 1050/);
});

test('an unavailable screen has an explicit unknown state instead of a guessed primary-screen size', () => {
  const popup = createPopup();
  popup.run(`displayWindowMetrics(${JSON.stringify({ window: normalWindow, bounds: null })}); displayResizeResult(${JSON.stringify(resizeResult({ bounds: null, oversized: false, mismatch: false }))});`);
  assert.equal(popup.element('screen-available-size').textContent, '无法读取');
  assert.match(popup.element('resize-messages').textContent, /无法读取当前屏幕可用区域/);
  assert.equal(popup.element('resize-feedback').dataset.tone, 'warning');
  assert.doesNotMatch(popup.element('resize-messages').textContent, /实际窗口尺寸与请求一致/);
});

test('a size still changing at the deadline shows a warning instead of confirming completion', () => {
  const popup = createPopup();
  popup.run(`displayResizeResult(${JSON.stringify(resizeResult({ oversized: false, mismatch: false, unsettled: true }))});`);
  assert.equal(popup.element('resize-feedback').dataset.tone, 'warning');
  assert.match(popup.element('resize-messages').textContent, /仍在变化/);
  assert.doesNotMatch(popup.element('resize-messages').textContent, /实际窗口尺寸与请求一致/);
});

test('reopening shows a persisted result, while later manual size changes clear stale resize feedback', async () => {
  const popup = createPopup({ metrics: { success: true, window: normalWindow, bounds, result: resizeResult() } });
  await popup.run('refreshWindowMetrics()');
  assert.equal(popup.requests[0].windowId, 7);
  assert.match(popup.element('resize-messages').textContent, /请求 1200 × 1090/);
  popup.setMetrics({ success: true, window: { ...normalWindow, width: 1000 }, bounds, result: resizeResult() });
  await popup.run('refreshWindowMetrics()');
  assert.equal(popup.element('actual-window-size').textContent, '1000 × 1050');
  assert.equal(popup.element('resize-feedback').hidden, true);
});

test('moving an unchanged window to a larger monitor clears warnings measured on the previous screen', async () => {
  const popup = createPopup({ metrics: { success: true, window: normalWindow, bounds, result: resizeResult() } });
  await popup.run('refreshWindowMetrics()');
  assert.match(popup.element('resize-messages').textContent, /超出可用区域/);
  popup.setMetrics({
    success: true,
    window: normalWindow,
    bounds: { left: 1920, top: 0, width: 2560, height: 1400 },
    result: resizeResult()
  });
  await popup.run('refreshWindowMetrics()');
  assert.equal(popup.element('actual-window-size').textContent, '1200 × 1050');
  assert.equal(popup.element('screen-available-size').textContent, '2560 × 1400');
  assert.equal(popup.element('resize-feedback').hidden, true);
});

test('a resize failure is visible and the popup does not add the failed request to recent sizes', async () => {
  const failure = {
    success: false,
    error: 'Window manager rejected resize',
    window: normalWindow,
    bounds,
    result: resizeResult({ error: 'Window manager rejected resize' })
  };
  const popup = createPopup({ resizeResponse: failure });
  await popup.run('resizeWindow(1200, 1090)');
  assert.equal(popup.requests[0].action, 'resizeWindow');
  assert.equal(popup.requests[0].windowId, 7);
  assert.equal(popup.element('resize-feedback').dataset.tone, 'error');
  assert.match(popup.element('resize-messages').textContent, /Window manager rejected resize/);
  assert.equal(popup.storageWrites.length, 0);
});

test('double clicks submit one background operation and disable window controls until it completes', async () => {
  let finishResize;
  const popup = createPopup({
    onRequest(request, callback) {
      if (request.action === 'resizeWindow') finishResize = callback;
      else callback({ success: true, window: normalWindow, bounds, result: resizeResult() });
    }
  });
  const first = popup.run('resizeWindow(1200, 1090)');
  for (let tick = 0; tick < 10; tick++) await Promise.resolve();
  await popup.run('resizeWindow(1300, 900)');
  assert.equal(popup.requests.filter(request => request.action === 'resizeWindow').length, 1);
  assert.ok(popup.controls.every(control => control.disabled));
  finishResize({ success: true, window: normalWindow, bounds, result: resizeResult() });
  await first;
  assert.ok(popup.controls.every(control => !control.disabled));
});
