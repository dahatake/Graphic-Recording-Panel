// FR-022 AC-671: .vtt の取込の方法（一括・再生取込）と速さの選択肢、再生取込の一時停止・再開・中止のボタン（画面の DOM だけ）。
// 取り込んだ発話が並ぶ入力パネル（認識文字列）の中、入力欄の下に置く（進み具合は状態バーの取込の状態 #import-status に出る）。
// 判定・保存・進行は app（vttplay.js）が行う。
// select と button だけで作るので、Tab と矢印キー・Enter／Space（キーボードだけ）で操作できる。状態は文字で示す（色だけに頼らない）。
export function mountVttPlayUI(app, doc = globalThis.document) {
  if (!doc || !app.getImportMethod) return null;
  const anchor = doc.getElementById('speech-actions') ?? doc.getElementById('draft-form');
  const host = doc.createElement('div');
  host.className = 'import-mode'; host.id = 'import-mode'; host.setAttribute('role', 'group');
  const mkSelect = (id) => { const s = doc.createElement('select'); s.id = id; return s; };
  const mkLabel = (forId) => { const l = doc.createElement('label'); l.htmlFor = forId; return l; };
  const methodLabel = mkLabel('import-method'); const method = mkSelect('import-method');
  const speedLabel = mkLabel('import-speed'); const speed = mkSelect('import-speed');
  const mkBtn = (action) => { const b = doc.createElement('button'); b.type = 'button'; b.className = 'btn btn-subtle btn-sm'; b.dataset.action = action; return b; };
  const pause = mkBtn('vttplay-pause'); const resume = mkBtn('vttplay-resume'); const cancel = mkBtn('vttplay-cancel');
  host.append(methodLabel, method, speedLabel, speed, pause, resume, cancel);
  if (anchor?.parentElement) anchor.after(host); else doc.body.append(host);

  method.addEventListener('change', () => app.setImportMethod({ method: method.value }));
  speed.addEventListener('change', () => app.setImportMethod({ speed: Number(speed.value) }));
  // 押したボタンが隠れてもフォーカスを失わないよう、入れ替わったボタンへ移す
  pause.addEventListener('click', () => { if (app.pauseVttPlayback().ok) resume.focus(); });
  resume.addEventListener('click', () => { if (app.resumeVttPlayback().ok) pause.focus(); });
  cancel.addEventListener('click', () => { if (app.cancelVttPlayback().ok) method.focus(); });

  const fillOptions = (sel, opts, value) => {
    const sig = opts.map((o) => `${o.value}:${o.label}`).join('|');
    if (sel.dataset.sig !== sig) {
      sel.replaceChildren(...opts.map((o) => { const op = doc.createElement('option'); op.value = String(o.value); op.textContent = o.label; return op; }));
      sel.dataset.sig = sig;
    }
    if (sel.value !== String(value)) sel.value = String(value);
  };
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const render = () => {
    const m = app.getImportMethod();
    const p = app.getVttPlayback();
    setText(methodLabel, m.label); setText(speedLabel, m.speedLabel);
    host.setAttribute('aria-label', p.labels.group);
    fillOptions(method, m.methods, m.method);
    fillOptions(speed, m.speeds, m.speed);
    const showSpeed = m.method === 'playback';
    speed.hidden = !showSpeed; speedLabel.hidden = !showSpeed;
    setText(pause, p.labels.pause); setText(resume, p.labels.resume); setText(cancel, p.labels.cancel);
    pause.hidden = !p.canPause; resume.hidden = !p.canResume; cancel.hidden = !p.canCancel;
  };
  render();
  app.subscribe(render);
  return host;
}
