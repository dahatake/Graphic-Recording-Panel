import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createApp } from '../../web/src/app.js';
import { GROUPS, PRIMARY, labelKey, tooltipId } from '../../web/src/commandbar.js';
import { MIN_H, WORK_AREA_MIN_PCT, defaultLayout, ops } from '../../web/src/layout.js';

const ui = fs.readFileSync(new URL('../../web/src/ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../web/styles/app.css', import.meta.url), 'utf8');

function runUIFunction(name, scope) {
  const match = ui.match(new RegExp(`  function ${name}\\(\\) \\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(match, `Missing UI function: ${name}`);
  return vm.runInNewContext(`(function () {${match[1]}\n})`, scope)();
}

function element(tag) {
  return {
    tag, children: [], dataset: {}, attributes: {}, listeners: {},
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
  };
}

test('UI toolbar builds all command groups and translated labels without interrupting initialization', async () => {
  const app = await createApp({ storage: { getItem: () => null, setItem() {} } });
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const toolbar = element('nav');
    let tooltipSyncs = 0;
    runUIFunction('buildToolbar', {
      toolbar, app, GROUPS, PRIMARY, labelKey, tooltipId,
      doc: { createElement: element },
      icon: (_, command) => ({ tag: 'svg', command }),
      keyLabel: () => 'Alt+Shift+R',
      syncTooltip: () => tooltipSyncs++,
    });
    assert.equal(toolbar.children.length, GROUPS.length + 1);
    let buttonCount = 0;
    const barGroups = Object.fromEntries(app.getCommandBar().groups.map((g) => [g.id, g.commands]));
    GROUPS.forEach(([groupLabel, baseCommands, groupId], i) => {
      const commands = groupId === 'drawStyle' ? barGroups.drawStyle : baseCommands; // FR-077: 画風グループは登録簿から
      assert.ok(groupId !== 'drawStyle' || commands.length >= 13);
      const group = toolbar.children[i];
      assert.equal(group.children[0].textContent, app.t(groupLabel));
      assert.equal(group.children.length, commands.length + 1);
      commands.forEach((command, j) => {
        const [button, tooltip] = group.children[j + 1].children;
        assert.equal(button.dataset.command, command);
        const label = groupId === 'drawStyle' ? app.getDrawStyles().find((s) => `drawStyle.set:${s.id}` === command).label : app.t(labelKey(command));
        assert.equal(button.children[1].textContent, label);
        assert.notEqual(button.children[1].textContent, labelKey(command));
        assert.equal(button.attributes['aria-describedby'], tooltip.id);
        assert.equal(tooltip.attributes.role, 'tooltip');
        assert.equal(typeof button.listeners.click, 'function');
        if (groupId === 'drawStyle') assert.equal(button.attributes['aria-pressed'], String(command === 'drawStyle.set:handwritten'), 'FR-077: 通常のボタン + aria-pressed');
        buttonCount++;
      });
    });
    assert.equal(buttonCount, GROUPS.flatMap(([, commands]) => commands).length + barGroups.drawStyle.length);
    assert.equal(toolbar.children.at(-1).dataset.role, 'panel-show');
    assert.equal(tooltipSyncs, 1);
  }
});

test('UI work area fits below the controls in a short desktop window, and is at least 55% of the window height (AC-641, PARAM-156)', () => {
  for (const viewport of [
    { width: 1307, height: 768, top: 162.2 },
    { width: 1280, height: 480, top: 162.2 },
    { width: 800, height: 600, top: 300 },
    { width: 800, height: 600, top: 277.2 },
    { width: 1280, height: 967, top: 162.2 },
    { width: 1024, height: 768, top: 600 },
  ]) {
    const layout = defaultLayout();
    runUIFunction('measureWorkArea', {
      MIN_H, WORK_AREA_MIN_PCT,
      doc: { defaultView: { innerHeight: viewport.height } },
      workspace: {
        clientWidth: viewport.width,
        getBoundingClientRect: () => ({ top: viewport.top }),
      },
      app: {
        getLayoutMode: () => 'floating',
        setWorkArea: (w, h) => ops.workArea(layout, w, h),
      },
    });
    const fit = Math.floor(viewport.height - viewport.top - 16);
    const floor = Math.ceil(viewport.height * 0.55);
    assert.equal(layout.workArea.h, Math.max(fit, floor, MIN_H));
    assert.ok(layout.workArea.h >= viewport.height * 0.55);
    for (const panel of Object.values(layout.panels)) {
      assert.equal(panel.visible, true);
      if (fit >= floor) assert.ok(viewport.top + panel.y + panel.h <= viewport.height); // 上部が高いときは、ページを縦にスクロールする
    }
  }
});

test('UI work area preserves the layout minimum and leaves mobile stacking unchanged', () => {
  let size;
  const scope = {
    MIN_H, WORK_AREA_MIN_PCT,
    doc: { defaultView: { innerHeight: 200 } },
    workspace: { clientWidth: 1280, getBoundingClientRect: () => ({ top: 160 }) },
    app: { getLayoutMode: () => 'floating', setWorkArea: (w, h) => { size = { w, h }; } },
  };
  runUIFunction('measureWorkArea', scope);
  assert.deepEqual(size, { w: 1280, h: MIN_H });
  scope.app.getLayoutMode = () => 'stacked';
  scope.app.setWorkArea = () => assert.fail('Mobile layout must remain stacked');
  runUIFunction('measureWorkArea', scope);
});

test('UI remeasures the work area when the header, toolbar or status bar changes height', () => {
  const header = {}, toolbar = {}, statusbar = {};
  const observed = [];
  const layout = defaultLayout();
  let top = 258.2;
  let onResize;
  const scope = {
    MIN_H, toolbar, WORK_AREA_MIN_PCT,
    doc: { defaultView: { innerHeight: 1000, ResizeObserver: class {
      constructor(callback) { onResize = callback; }
      observe(el) { observed.push(el); }
    } } },
    $: (selector) => ({ '.app-header': header, '.statusbar': statusbar })[selector],
    workspace: { clientWidth: 800, getBoundingClientRect: () => ({ top }) },
    app: {
      getLayoutMode: () => 'floating',
      setWorkArea: (w, h) => ops.workArea(layout, w, h),
    },
    measureWorkArea: () => runUIFunction('measureWorkArea', scope),
  };
  const observerSetup = ui.match(/  const ResizeObserver =[\s\S]*?\n  \}/);
  assert.ok(observerSetup);
  vm.runInNewContext(observerSetup[0], scope);
  assert.deepEqual(observed, [header, toolbar, statusbar]);
  onResize();
  const previousHeight = layout.workArea.h;
  top += 19;
  onResize();
  assert.equal(layout.workArea.h, previousHeight - 19);
  for (const panel of Object.values(layout.panels)) assert.ok(top + panel.h <= 1000);
});

test('Fixed desktop layouts do not inherit the free-layout minimum viewport height', () => {
  const rule = css.match(/([^{}]+)\{\s*min-height: 0;\s*\}/);
  assert.ok(rule);
  for (const kind of ['tile', 'focus', 'maximized']) {
    assert.ok(rule[1].includes(`.workspace[data-mode="floating"][data-kind="${kind}"]`));
  }
});
