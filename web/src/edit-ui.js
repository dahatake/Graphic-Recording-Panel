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

  function sync() {
    if (!panel) return;
    if (!form) build();
    const st = app.getState();
    form.setAttribute('aria-label', app.t('edit.title'));
    for (const el of form.querySelectorAll('[data-k]')) el.textContent = app.t(`edit.${el.dataset.k}`);
    for (const b of form.querySelectorAll('[data-edit]')) b.textContent = app.t(`edit.${b.dataset.edit}`);
    const sel = form.querySelector('[data-f="point"]');
    const cur = sel.value;
    sel.textContent = '';
    st.scenes.forEach((sc, i) => {
      for (const p of sc.points) {
        const o = doc.createElement('option'); o.value = p.id; o.textContent = `${app.t('edit.scene')} ${i + 1}: ${p.text}`;
        sel.append(o);
      }
    });
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    form.hidden = !st.scenes.length;
    if (tform) {
      tform.setAttribute('aria-label', app.t('topic.edit.title'));
      for (const el of tform.querySelectorAll('[data-k]')) el.textContent = app.t(`topic.edit.${el.dataset.k}`);
      for (const b of tform.querySelectorAll('[data-topic-edit]')) b.textContent = app.t(`topic.edit.${b.dataset.topicEdit}`);
      const ts = tform.querySelector('[data-f="topic"]'); const tcur = ts.value;
      ts.textContent = '';
      for (const tp of app.getTopics()) { const o = doc.createElement('option'); o.value = tp.id; o.textContent = tp.title; ts.append(o); }
      if ([...ts.options].some((o) => o.value === tcur)) ts.value = tcur;
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

  app.subscribe(sync);
  sync();
}
