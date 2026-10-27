import { coalesceFrame } from './frame.js';
// FR-005 / FR-006 / FR-007 の画面部分（ブラウザ専用）。mountUI の後に呼ぶ。
// ・手修正フォーム（アウトラインのパネルの下）  ・保存ボタンの無効化と理由の表示（シーン 0 件: AC-046）
export function mountEditUI(app, doc = document) {
  const panel = doc.querySelector('.panel[data-panel="outline"]');
  let form = null;

  function build() {
    form = doc.createElement('form');
    form.className = 'edit-form'; form.setAttribute('role', 'group');
    form.innerHTML = '<h3 data-k="title"></h3>'
      + '<label>[<span data-k="target"></span>] <select data-f="point"></select></label>'
      + '<label>[<span data-k="text"></span>] <input type="text" data-f="text" autocomplete="off"></label>'
      + '<div class="edit-actions"></div>';
    const acts = form.querySelector('.edit-actions');
    const mk = (key, fn) => {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm'; b.dataset.edit = key;
      b.addEventListener('click', () => fn(form.querySelector('[data-f="point"]').value, form.querySelector('[data-f="text"]')));
      acts.append(b);
    };
    const find = (pid) => app.getState().scenes.find((s) => s.points.some((p) => p.id === pid));
    mk('save', (pid, inp) => { if (pid && app.editPoint(pid, inp.value).ok) inp.value = ''; });
    mk('delete', (pid) => { if (pid) app.deletePoint(pid); });
    mk('add', (pid, inp) => {
      const sc = find(pid) ?? app.getState().scenes.find((s) => s.id === app.getState().selectedSceneId) ?? app.getState().scenes.at(-1);
      if (sc && app.addPoint(sc.id, inp.value).ok) inp.value = '';
    });
    mk('merge', (pid) => { const sc = find(pid); if (sc) app.mergeScenes(sc.id); });
    mk('split', (pid) => { const sc = find(pid); if (sc) app.splitScene(sc.id, pid); });
    panel.append(form);
    buildTopicForm();
  }

  // FR-025 AC-136: トピックの題名の編集・シーンの移動（ドラッグなし。キーボードのコマンド topic.* でも行える）
  let tform = null;
  function buildTopicForm() {
    tform = doc.createElement('form');
    tform.className = 'edit-form topic-form'; tform.setAttribute('role', 'group');
    tform.innerHTML = '<h3 data-k="title"></h3>'
      + '<label>[<span data-k="target"></span>] <select data-f="topic"></select></label>'
      + '<label>[<span data-k="text"></span>] <input type="text" data-f="title" autocomplete="off"></label>'
      + '<div class="edit-actions"></div>';
    const acts = tform.querySelector('.edit-actions');
    const topic = () => tform.querySelector('[data-f="topic"]').value;
    const mk = (key, fn) => { const b = doc.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm'; b.dataset.topicEdit = key; b.addEventListener('click', fn); acts.append(b); };
    mk('rename', () => { const inp = tform.querySelector('[data-f="title"]'); if (topic() && app.renameTopic(topic(), inp.value).ok) inp.value = ''; });
    mk('moveHere', () => { const sid = app.getState().selectedSceneId; if (sid && topic()) app.moveSceneToTopic(sid, topic()); });
    mk('moveNew', () => { const sid = app.getState().selectedSceneId; if (sid) app.moveSceneToTopic(sid, null); });
    panel.append(tform);
  }

  // NFR-PERF-003 AC-538: データの版数が前回と同じなら、要点・トピックの選択肢を作り直さない。
  // 版数が変わっても、選択肢の中身（ID と表示の文字列）が同じなら DOM に触れない（選択だけの変更で 5000 件を作り直さない）
  let syncedVer;
  const fillOptions = (sel, items) => {
    const sig = items.map(([v, l]) => `${v}\u0001${l}`).join('\u0002');
    if (sel._sig === sig) return;
    sel._sig = sig;
    const cur = sel.value;
    sel.textContent = '';
    for (const [v, l] of items) { const o = doc.createElement('option'); o.value = v; o.textContent = l; sel.append(o); }
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  };
  function sync() {
    if (!panel) return;
    if (!form) build();
    const ver = app.getRenderVersion?.();
    if (ver !== undefined && ver === syncedVer) return;
    syncedVer = ver;
    const st = { scenes: app.getScenesView?.() ?? app.getState().scenes };
    form.setAttribute('aria-label', app.t('edit.title'));
    for (const el of form.querySelectorAll('[data-k]')) el.textContent = app.t(`edit.${el.dataset.k}`);
    for (const b of form.querySelectorAll('[data-edit]')) b.textContent = app.t(`edit.${b.dataset.edit}`);
    const sel = form.querySelector('[data-f="point"]');
    const items = [];
    st.scenes.forEach((sc, i) => { for (const p of sc.points) items.push([p.id, `${app.t('edit.scene')} ${i + 1}: ${p.text}`]); });
    fillOptions(sel, items);
    form.hidden = !st.scenes.length;
    if (tform) {
      tform.setAttribute('aria-label', app.t('topic.edit.title'));
      for (const el of tform.querySelectorAll('[data-k]')) el.textContent = app.t(`topic.edit.${el.dataset.k}`);
      for (const b of tform.querySelectorAll('[data-topic-edit]')) b.textContent = app.t(`topic.edit.${b.dataset.topicEdit}`);
      fillOptions(tform.querySelector('[data-f="topic"]'), app.getTopics().map((tp) => [tp.id, tp.title]));
      tform.hidden = !st.scenes.length;
    }

    // 保存ボタン: シーン 0 件では無効にして、理由を見える文字で示す
    const save = app.getSaveState();
    const btns = [...doc.querySelectorAll('[data-command^="save."]')];
    for (const b of btns) { b.disabled = !save.enabled; const lab = b.querySelector('.btn-label')?.textContent ?? ''; b.title = save.reason ? `${lab}: ${save.reason}` : lab; }
    const group = doc.querySelector('.statusbar');
    if (group) {
      let note = group.querySelector('.save-reason');
      if (!save.enabled) {
        if (!note) { note = doc.createElement('small'); note.className = 'save-reason'; note.setAttribute('role', 'status'); group.append(note); }
        note.textContent = save.reason;
      } else note?.remove();
    }
  }

  app.subscribe(coalesceFrame(sync, doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView), doc.defaultView?.cancelAnimationFrame?.bind(doc.defaultView)));
  sync();
}
