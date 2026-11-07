// FR-118 バッチモード: ファイル読込（FR-117）の後に、定義済みのグラレコスタイル（FR-119。batchstyles.js）を 1 つ選んで、取込んだ会話を図（[図]）に図式化する。
// 契約: tests/system/CONTRACT-BATCH.md「3.」「4.」。DOM に依存しない（描画は ui.js。見た目は inputmode.js と同じ項目の形）。
//   - 状態: idle（発話 0 件）→ loaded（読込済み）→ running（実行中）→ done（完了）。取込だけでは図を描かない（FR-014 AC-054・AC-686）。
//   - 実行: 図（シーン・要点）を取込んだ発話から作り直し（ルールベース描画。FR-004）、LLM 連携が有効・同意済みなら、全シーンについて中継サーバーへ
//     スタイルの ID・名称（body.styleId・body.styleName）だけを送る（AC-688・AC-690）。指示（Prompt 本文）はサーバーが ID から付与する（AC-695）。
//     無効・未同意・失敗のときは、そのシーンはルールベース描画のまま、選んだスタイルの画風で描く（AC-689。FR-062 (5)）。
//   - 実行中は処理中と進み具合を文字で示し、[取消] ができる。取消すと読込済みに戻り、図は実行前のまま（AC-691）。実行中は重ねて実行しない。
import { createBatchStyleRegistry } from './batchstyles.js';

const SET = 'batchStyle.set:';
const CANCEL = 'batch.cancel';

const STRINGS = {
  ja: {
    'toolbar.batchStyle': 'スタイル（図式化）',
    'msg.batchLoadFile': 'ファイルを読み込んでください',
    'msg.batchRunning': '実行中は別のスタイルを選べません',
    'batch.progress': '処理中: {done} / {total} シーン',
    'batch.done': '完了: {n} シーンを描きました',
    'batch.llmOff': 'LLM 連携を有効にすると、スタイルの指示で AI が図式化します。今はルールベースで描いています',
    'batch.cancelled': '取消しました。図は実行前のままです',
    'batch.cancel': '取消',
    'tooltip.batch.cancel': 'バッチの図式化を取り消し、実行前の図に戻します',
    'cmd.batchStyle.select': 'スタイルを選んで図式化',
    'label.batch.cancel': '取消',
  },
  en: {
    'toolbar.batchStyle': 'Style (draw the file)',
    'msg.batchLoadFile': 'Load a file first',
    'msg.batchRunning': 'You cannot pick another style while it runs',
    'batch.progress': 'Working: {done} / {total} scenes',
    'batch.done': 'Done: drew {n} scenes',
    'batch.llmOff': 'Turn on LLM integration to let AI draw with the style instructions. It is drawn by rules for now',
    'batch.cancelled': 'Cancelled. The diagram is as before the run',
    'batch.cancel': 'Cancel',
    'tooltip.batch.cancel': 'Cancel the batch run and return to the diagram before it',
    'cmd.batchStyle.select': 'Pick a style and draw',
    'label.batch.cancel': 'Cancel',
  },
};

export function batchModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;
  const lang = () => (state.lang === 'en' ? 'en' : 'ja');
  ctx.i18n.addStrings(STRINGS);
  const fmt = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), t(key));

  const drawStyleIds = (api.getDrawStyles?.() ?? []).map((s) => s.id);
  const registry = createBatchStyleRegistry({ drawStyleIds });
  // コマンドの検索用の名称（cmd.batchStyle.set:<id>）は、登録簿の名称から表示言語ごとに作る
  ctx.i18n.addStrings({
    ja: Object.fromEntries(registry.list('ja').map((s) => [`cmd.${SET}${s.id}`, `${STRINGS.ja['cmd.batchStyle.select']}: ${s.label}`])),
    en: Object.fromEntries(registry.list('en').map((s) => [`cmd.${SET}${s.id}`, `${STRINGS.en['cmd.batchStyle.select']}: ${s.label}`])),
  });

  // ---- 状態 ----
  let phase = 'idle'; // 保存する値は running・done だけ（idle・loaded は発話の件数から導く）
  let total = 0; let done = 0; let doneMessage = ''; let drawnCount = 0;
  let utterAtDone = 0; // 完了時点の発話の件数（発話が増えたら完了の表示は外す）
  let selected = null; // 現在の図のスタイルの ID（実行前は null）
  let runId = 0;
  let cancelRun = null;

  const mode = () => api.getInputMode?.().mode ?? 'live';
  const baseState = () => {
    if (phase === 'running') return 'running';
    if (!state.utterances.length) return 'idle';
    if (phase === 'done' && state.utterances.length === utterAtDone) return 'done';
    return 'loaded';
  };
  const llmOn = () => api.getLlmState?.().enabled === true;

  api.getBatchStyles = () => {
    const st = baseState();
    const enabled = mode() === 'batch' && (st === 'loaded' || st === 'done');
    const reason = !enabled ? (st === 'idle' ? t('msg.batchLoadFile') : st === 'running' ? t('msg.batchRunning') : null) : null;
    return registry.list(lang()).map((s) => {
      const on = selected === s.id && st !== 'idle';
      return { ...s, pressed: on, selectedMark: on ? 'check' : null, enabled, disabledReason: reason };
    });
  };
  api.getBatchState = () => {
    const st = baseState();
    const percent = total ? Math.round((done / total) * 100) : 0;
    const progressText = st === 'running' ? fmt('batch.progress', { done, total }) : '';
    return {
      state: st, visible: mode() === 'batch', total: st === 'idle' ? 0 : total, done, percent: st === 'running' || st === 'done' ? percent : 0,
      progressText, cancelEnabled: st === 'running', message: st === 'running' ? progressText : st === 'done' ? doneMessage : st === 'idle' ? t('msg.batchLoadFile') : '',
    };
  };

  const finish = () => { cancelRun = null; };

  // 実行（コマンド batchStyle.set:<id> と同じ）。Promise は完了・取消・失敗で解決する
  api.runBatch = async (styleId) => {
    if (typeof styleId !== 'string' || !registry.has(styleId)) return { ok: false, reason: 'invalid' };
    if (mode() !== 'batch') return { ok: false, reason: 'not_batch' };
    const st = baseState();
    if (st === 'running') { ctx.change(() => ctx.setMessage('msg.batchRunning')); return { ok: false, reason: 'running' }; }
    if (st === 'idle') { ctx.change(() => ctx.setMessage('msg.batchLoadFile')); return { ok: false, reason: 'no_input' }; }
    const style = registry.list(lang()).find((s) => s.id === styleId);
    const my = ++runId;
    const prevStyle = api.getDrawStyle?.(); const prevSelected = selected; const prevPhase = phase; const prevDone = { doneMessage, drawnCount, utterAtDone };
    // 開始（操作の直後に処理中を示す。PARAM-014）: 画風をそのスタイルのものにし、取込んだ発話から図を作り直す
    phase = 'running'; selected = styleId; done = 0; total = 0;
    api.setDrawStyle?.(style.drawStyle);
    const prevLevel = api.getDetailLevel?.();
    if (prevLevel === 'major') api.setDetailLevel?.('detail'); // 全シーンを図に描く（大項目だけの表示ではシーンが現れない）
    const oldIds = state.scenes.map((s) => s.id);
    const restore = ctx.rebuildScenes();
    const scenes = state.scenes.map((s) => ({ id: s.id }));
    total = scenes.length;
    let cancelled = false;
    const cancelled$ = new Promise((resolve) => { cancelRun = () => { cancelled = true; resolve('cancelled'); }; });
    ctx.change(() => {});
    await Promise.resolve();
    // LLM 連携（有効・同意済み）: 全シーンについて、スタイルの ID・名称だけを送る。失敗したシーンはルールベース描画のまま
    let llmUsed = false;
    if (llmOn() && typeof api.extractSceneWithStyle === 'function') {
      llmUsed = true;
      const work = (async () => {
        for (const sc of scenes) {
          if (cancelled || my !== runId) return;
          await api.extractSceneWithStyle(sc.id, { id: style.id, name: style.label });
          if (cancelled || my !== runId) return;
          done += 1; ctx.change(() => {});
        }
      })();
      await Promise.race([work.catch(() => {}), cancelled$]);
    }
    if (cancelled || my !== runId) {
      // 取消: 読込済みに戻り、図は実行前のまま（発話は残る）
      api.clearLlmDrawn?.(scenes.map((s) => s.id));
      phase = prevPhase === 'running' ? 'idle' : prevPhase; selected = prevSelected;
      doneMessage = prevDone.doneMessage; drawnCount = prevDone.drawnCount; utterAtDone = prevDone.utterAtDone;
      restore();
      if (prevStyle) api.setDrawStyle?.(prevStyle);
      if (prevLevel && api.getDetailLevel?.() !== prevLevel) api.setDetailLevel?.(prevLevel);
      finish(); total = 0; done = 0;
      ctx.change(() => {});
      return { ok: true, drawn: 0, cancelled: true };
    }
    done = total; drawnCount = state.scenes.length;
    api.clearLlmDrawn?.(oldIds); // 置き換えた図のシーンの抽出結果は捨てる
    phase = 'done'; utterAtDone = state.utterances.length;
    doneMessage = fmt('batch.done', { n: drawnCount }) + (llmUsed ? '' : `。${t('batch.llmOff')}`);
    finish();
    ctx.change(() => {});
    ctx.emit('batch:done', { styleId, drawn: drawnCount });
    return { ok: true, drawn: drawnCount };
  };
  api.cancelBatch = () => {
    if (baseState() !== 'running' || typeof cancelRun !== 'function') return { ok: false, reason: 'not_running' };
    cancelRun();
    return { ok: true };
  };

  for (const s of registry.list('ja')) ctx.registerCommand(`${SET}${s.id}`, () => api.runBatch(s.id));
  ctx.registerCommand(CANCEL, () => api.cancelBatch());
  ctx.registerKey({ key: ':', ctrl: true, alt: true, shift: true, command: CANCEL }); // 実行中の取消（NFR-A11Y-001。Ctrl+Alt+Shift の英数字・F キー・主な記号は使用済みのため「:」。名称 cmd.batch.cancel は基本辞書 i18n.js）

  // コマンドの検索: 「スタイルを選んで図式化: <名前>」（基本の検索は cmd.* の名称で見つける）
  // ---- コマンドバー: バッチモードのときだけスタイルのグループ（commandbar.js の GROUPS）を出す。現在のスタイルだけ pressed。実行できないときは無効の理由 ----
  const baseBar = api.getCommandBar;
  api.getCommandBar = () => {
    const bar = baseBar();
    const styles = api.getBatchStyles();
    const by = new Map(styles.map((s) => [`${SET}${s.id}`, s]));
    return {
      ...bar,
      items: bar.items.map((it) => {
        const s = by.get(it.command);
        if (!s) return it;
        return { ...it, description: s.description, descriptionVisible: true, pressed: s.pressed, selectedMark: s.selectedMark, enabled: s.enabled, disabledReason: s.disabledReason };
      }),
    };
  };
}
