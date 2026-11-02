// FR-103（AC-599〜602）: 初回の案内（3 ステップ: マイク・周期・保存）・ヘルプ・練習用のサンプルのセッション。
// 契約: tests/system/CONTRACT-P1.md §2。DOM に依存しない（描画は onboarding-ui.js）。外部へ通信しない（サンプルは同梱）。
// 終えた記録（完了・スキップ）は端末のブラウザ内の設定（grp.onboarding。FR-012）だけに残し、セッションの初期化では消えない。
import { FORMAT, VERSION } from './session.js';

export const ONBOARDING_KEY = 'grp.onboarding';
export const STEP_IDS = ['mic', 'interval', 'save'];

// 練習用のサンプル（日本語・英語）。架空の内容だけで、実在の人物・組織・製品の名前を含まない（AC-602）。
const SAMPLE = {
  ja: {
    name: 'sample-ja.json',
    scenes: [
      ['練習: 集まりの目的', ['今日は練習用の議論です', '図と一覧がどう変わるかを試します', '記録をしなくても操作を確かめられます']],
      ['練習: 案を比べる', ['A 案は準備が早くて手軽です', 'B 案は時間がかかるが効果が大きい', 'まず A 案で試して様子を見ることにします']],
      ['練習: 次の行動', ['来週までに試作を用意します', '担当は仮の「担当者 1」とします', '結果は次の集まりで確認します']],
    ],
  },
  en: {
    name: 'sample-en.json',
    scenes: [
      ['Practice: purpose of the meeting', ['This is a practice discussion', 'Try how the diagram and the list change', 'You can try the controls without recording']],
      ['Practice: comparing options', ['Plan A is quick and easy to prepare', 'Plan B takes longer but has a bigger effect', 'Try Plan A first and watch the result']],
      ['Practice: next actions', ['Prepare a prototype by next week', 'The owner is a placeholder called Owner 1', 'Check the result at the next meeting']],
    ],
  },
};

export function buildSampleFile(lang) {
  const def = SAMPLE[lang === 'en' ? 'en' : 'ja'];
  const utterances = []; const scenes = [];
  let u = 0; let p = 0;
  def.scenes.forEach(([heading, texts], i) => {
    const points = texts.map((text) => {
      u++; p++;
      utterances.push({ id: `u${u}`, text, rawText: text, receivedAt: 1000 * u });
      return { id: `p${p}`, text, uid: `u${u}` };
    });
    scenes.push({ id: `s${i + 1}`, heading, points, relations: [], status: 'confirmed' });
  });
  const text = JSON.stringify({
    format: FORMAT, version: VERSION, utterances, scenes, selectedSceneId: scenes[0].id, seq: 50,
    displayMode: 'timeline', extras: { sample: true },
  });
  return { name: def.name, type: 'application/json', size: text.length, text };
}

export function onboardingModule(ctx) {
  const { api, state, storage } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'onboarding.title': 'はじめに', 'onboarding.help': 'ヘルプ', 'onboarding.progress': 'ステップ {n} / {total}',
      'onboarding.mic.title': '1. マイクを使う', 'onboarding.mic.body': '［記録開始］を押すと、マイクの使用の許可を求められます。許可すると、話した内容が文字になり、図とテキスト一覧に増えていきます。マイクを使わないときは、入力欄に文字を打っても記録できます。',
      'onboarding.interval.title': '2. 図を整える周期', 'onboarding.interval.body': '図の配置は一定の周期で整え直されます。周期は［周期］のボタンで切り替えられ、［設定］から決め方も選べます。',
      'onboarding.save.title': '3. 保存する', 'onboarding.save.body': '記録は、このブラウザの中に自動で保存されます。ほかの端末へ渡すときは［ファイル保存］を使います。図は PNG・SVG・PDF で書き出せます。外部へは送信されません。',
      'onboarding.back': '戻る', 'onboarding.next': '次へ', 'onboarding.finish': '完了', 'onboarding.skip': 'スキップ', 'onboarding.close': '閉じる',
      'onboarding.loadSample': '練習用のサンプルを読み込む', 'onboarding.sampleNote': '記録をしなくても、図とテキスト一覧を試せます。音声入力は使いません。',
      'onboarding.sampleBadge': 'サンプル',
      'label.help.open': 'ヘルプ', 'tooltip.help.open': '初回の案内の 3 ステップを開き、練習用のサンプルも読み込めます',
    },
    en: {
      'onboarding.title': 'Getting started', 'onboarding.help': 'Help', 'onboarding.progress': 'Step {n} of {total}',
      'onboarding.mic.title': '1. Use the microphone', 'onboarding.mic.body': 'Press Record and the browser asks for microphone permission. Once allowed, what you say becomes text and grows in the diagram and the text list. Without a microphone, you can still type into the input box.',
      'onboarding.interval.title': '2. How often the diagram is tidied', 'onboarding.interval.body': 'The diagram layout is rearranged at a regular interval. Switch the interval with the Interval button, and choose how the layout is decided in Settings.',
      'onboarding.save.title': '3. Save your work', 'onboarding.save.body': 'Your record is saved automatically inside this browser. Use Save file to hand it over to another device. The diagram can be exported as PNG, SVG or PDF. Nothing is sent outside.',
      'onboarding.back': 'Back', 'onboarding.next': 'Next', 'onboarding.finish': 'Done', 'onboarding.skip': 'Skip', 'onboarding.close': 'Close',
      'onboarding.loadSample': 'Load the practice sample', 'onboarding.sampleNote': 'Try the diagram and the text list without recording. Voice input is not used.',
      'onboarding.sampleBadge': 'Sample',
      'label.help.open': 'Help', 'tooltip.help.open': 'Open the 3-step guide again and load the practice sample',
    },
  });
  const t = (k) => ctx.i18n.t(k);
  const notify = () => ctx.emit('change', api);

  const done = () => { try { return !!String(storage?.getItem(ONBOARDING_KEY) ?? ''); } catch { return false; } };
  const record = () => { try { storage?.setItem(ONBOARDING_KEY, 'done'); } catch { /* 保存できなくても動作は続ける */ } };

  let step = 0; // 0 = 閉じている、1〜3 = 表示中
  let sample = false;
  const total = STEP_IDS.length;
  if (!done()) step = 1; // 記録がないときだけ起動で開く

  const close = (save) => { if (save) record(); if (step) { step = 0; notify(); } };

  api.getOnboarding = () => {
    if (!step) return null;
    const id = STEP_IDS[step - 1];
    const label = t('onboarding.title');
    return {
      open: true, step, total, id, role: 'dialog', modal: true, label, focused: true, canLoadSample: step === total,
      steps: STEP_IDS.map((sid, i) => ({ id: sid, title: t(`onboarding.${sid}.title`), current: i + 1 === step })),
      title: t(`onboarding.${id}.title`), body: t(`onboarding.${id}.body`),
      progress: t('onboarding.progress').replace('{n}', String(step)).replace('{total}', String(total)),
      buttons: { back: step > 1, next: step === total ? t('onboarding.finish') : t('onboarding.next') },
    };
  };

  const onboarding = {
    next() { if (!step) return { ok: false }; if (step >= total) close(true); else { step++; notify(); } return { ok: true }; },
    back() { if (!step || step <= 1) return { ok: false }; step--; notify(); return { ok: true }; },
    skip() { if (!step) return { ok: false }; close(true); return { ok: true }; },
    loadSample() {
      if (!step || step !== total) return { ok: false, reason: 'not_last_step' };
      void api.loadSessionFile(buildSampleFile(state.lang)); // 既存の議論があれば load-replace の確認（取り消せる）
      if (api.getDialog?.()?.kind === 'load-replace') return { ok: false, pending: true };
      return sample ? { ok: true } : { ok: false, reason: 'failed' };
    },
  };
  api.onboarding = onboarding;

  ctx.registerCommand('onboarding.next', () => onboarding.next());
  ctx.registerCommand('onboarding.back', () => onboarding.back());
  ctx.registerCommand('onboarding.skip', () => onboarding.skip());
  ctx.registerCommand('sample.load', () => onboarding.loadSample());
  ctx.registerCommand('help.open', () => { step = 1; notify(); return { ok: true }; });
  // Alt+Shift+英数字・F キーは使用済み。Ctrl+Alt+Shift の記号（K-05・K-07 の Home/PageDown/PageUp/End/; とは別）
  for (const [key, command] of [['Delete', 'onboarding.back'], ['Insert', 'onboarding.next'], ['\\', 'onboarding.skip'], ["'", 'help.open'], ['`', 'sample.load']]) {
    ctx.registerKey({ key, ctrl: true, alt: true, shift: true, command });
  }

  // 「サンプル」の印（AC-601）。セッションファイルの extras に入り、読込で立ち、データの初期化で消える（AC-602）。
  ctx.registerPersist('sample', {
    export: () => (sample ? true : undefined),
    import: (v) => { sample = v === true; if (sample && step) { step = 0; record(); } },
    reset: () => { sample = false; },
  });
  const baseState = api.getState;
  api.getState = () => ({ ...baseState(), sample });
  const baseUi = api.getUiState;
  if (baseUi) api.getUiState = () => ({ ...baseUi(), sample });
}
