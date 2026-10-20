// FR-078 画像生成 AI 向けのプロンプトのコピー（契約: tests/system/CONTRACT-FR077-078.md「画像生成プロンプトのコピー」）。DOM に依存しない。
// 文章の構成: 目的・配色・文字・イラスト・雰囲気・構成・内容（依頼に添付の Prompt と同じ形。文面はこのアプリ独自）。
//   配色〜雰囲気 = 選んでいる描画スタイルの画風の記述（drawstyles.js・stylepresets.js の description）
//   構成 = 現在のレイアウト型（FR-027）の名称と説明 ／ 内容 = トピック・シーンの見出し・要点（テキスト一覧と同じ順序。手修正後の文字）
// 文章は外部へ送らず、保存もしない（クリップボードへ書くだけ。書けないときは画面に表示して手でコピーしてもらう）。
// コピーの前に注意（AC-468）を開き、会議の内容が貼り付け先の外部サービスへ渡ることを示す。簡易マスキング（AC-469）は
// NFR-PRIV-003（AC-359）と同じ規則（llmdraw.js の maskText）で、内容の部分の利用者の文字（トピックの題名・見出し・要点）だけに掛ける。
import { LAYOUT_TYPE_META } from './layouttypes.js';
import { maskText } from './llmdraw.js';

export const MAX_CONTENT_CHARS = 2000; // PARAM-082
export const SECTION_KEYS = ['purpose', 'palette', 'typography', 'illustration', 'mood', 'composition', 'content'];
// 画風の記述の軸（description.{lang}.{color,drawing,font,mood}）→ 文章の節
const AXIS_OF = { palette: 'color', typography: 'font', illustration: 'drawing', mood: 'mood' };

// 構成（レイアウト型）の説明。画像生成 AI に紙面の組み方を伝える文。
const COMPOSITION = {
  timeline: {
    ja: 'シーンを話の順に左上から右下へ Z 字に並べ、矢印で流れをつなぐ',
    en: 'Scenes placed in talk order from the top left to the bottom right in a Z pattern, linked by arrows that show the flow',
  },
  bubble: {
    ja: '要点を 1 つずつ吹き出しに入れ、話し手の声が並ぶように配置する',
    en: 'Each point placed in its own speech balloon, arranged like the voices of the speakers',
  },
  diverge: {
    ja: '中央に主題を置き、そこから放射状に枝を伸ばして話題と要点をつなぐ',
    en: 'The main theme in the center, with branches radiating out to the topics and points',
  },
  zone: {
    ja: '紙面をトピックごとの区画に分け、区画ごとに見出しと要点をまとめる',
    en: 'The page divided into one zone per topic, each zone holding its own heading and points',
  },
  metaphor: {
    ja: '道のりや山などの比喩の背景を描き、話の流れをその道筋に沿って配置する',
    en: 'A metaphor background such as a road or a mountain, with the flow of the talk placed along its path',
  },
};

export const STRINGS = {
  ja: {
    'prompt.head.purpose': '目的', 'prompt.head.palette': '配色', 'prompt.head.typography': '文字', 'prompt.head.illustration': 'イラスト',
    'prompt.head.mood': '雰囲気', 'prompt.head.composition': '構成', 'prompt.head.content': '内容',
    'prompt.purpose': 'この会議・講義の議論を、1 枚の画像で全体が分かるグラフィックレコーディング（議論を絵と文字で描き起こした図解）にしてください。「内容」の見出しと要点は言い換えずに、読める文字で図の中に入れてください。',
    'prompt.compositionLead': '次の配置で紙面を組み立てる。',
    'prompt.topic': 'トピック', 'prompt.scene': 'シーン',
    'prompt.truncatedNote': '※ 内容が長いため、シーンの区切りで切り詰め、残りのシーンは入れていません。',
    'prompt.copied': '画像生成 AI 向けのプロンプトをクリップボードにコピーしました',
    'prompt.truncated': '画像生成 AI 向けのプロンプトをコピーしました。内容が長いため、シーンの区切りで切り詰めました',
    'prompt.empty': 'シーンがないため、プロンプトはコピーしていません。記録か入力で図の内容を作ってください',
    'prompt.clipboardFailed': 'クリップボードに書き込めませんでした。表示した文章を選択して、手でコピーしてください',
    'prompt.fallback.label': '画像生成 AI 向けのプロンプト（手でコピー）',
    'prompt.fallback.hint': '文章はすべて選択してあります。Ctrl+C（Mac は ⌘+C）でコピーしてください。',
    'prompt.fallback.close': '閉じる',
    'label.prompt.copy': 'プロンプト',
    'tooltip.prompt.copy': '図の内容・画風・構成から、画像生成 AI に貼り付けて使うプロンプトの文章をクリップボードにコピーします',
    'prompt.notice.label': 'プロンプトをコピーする前の確認',
    'prompt.notice.text': 'コピーする文章には、会議の内容（トピック・見出し・要点。人名などを含むことがあります）が入ります。画像生成 AI などの外部サービスに貼り付けると、その内容は貼り付け先のサービスへ渡ります。',
    'prompt.notice.mask': '簡易マスキングを適用する',
    'prompt.notice.maskNote': '内容の部分の登録語・敬称付きの人名らしい語・メールアドレス・電話番号を伏せ字にします。検出は簡易で、完全な除去は保証しません。図・テキスト一覧・セッションファイルは変わりません。',
    'prompt.notice.copy': 'コピーする',
    'prompt.notice.cancel': '取りやめる',
  },
  en: {
    'prompt.head.purpose': 'Purpose', 'prompt.head.palette': 'Color palette', 'prompt.head.typography': 'Typography', 'prompt.head.illustration': 'Illustration',
    'prompt.head.mood': 'Mood', 'prompt.head.composition': 'Composition', 'prompt.head.content': 'Content',
    'prompt.purpose': 'Turn the discussion from this meeting or lecture into a single graphic recording image (a visual summary that captures the talk with drawings and words) that shows the whole picture at a glance. Put the headings and points under "Content" into the image as readable text, without rewording them.',
    'prompt.compositionLead': 'Lay out the page as follows.',
    'prompt.topic': 'Topic', 'prompt.scene': 'Scene',
    'prompt.truncatedNote': 'Note: The content was too long, so it was cut at a scene boundary and the remaining scenes are not included.',
    'prompt.copied': 'Copied the prompt for image-generation AI to the clipboard',
    'prompt.truncated': 'Copied the prompt for image-generation AI. The content was too long, so it was cut at a scene boundary',
    'prompt.empty': 'Nothing was copied because there are no scenes. Record or type to build the diagram first',
    'prompt.clipboardFailed': 'Could not write to the clipboard. Select the text shown and copy it by hand',
    'prompt.fallback.label': 'Prompt for image-generation AI (copy by hand)',
    'prompt.fallback.hint': 'All of the text is selected. Press Ctrl+C (Cmd+C on a Mac) to copy it.',
    'prompt.fallback.close': 'Close',
    'label.prompt.copy': 'Copy prompt',
    'tooltip.prompt.copy': 'Copy a prompt built from the diagram content, art style and layout, ready to paste into an image-generation AI',
    'prompt.notice.label': 'Before you copy the prompt',
    'prompt.notice.text': 'The text you copy contains the content of the meeting (topics, headings and points, which may include people\'s names). If you paste it into an image-generation AI or another external service, that content is passed to the service.',
    'prompt.notice.mask': 'Apply simple masking',
    'prompt.notice.maskNote': 'Registered words, name-like words with honorifics, email addresses and phone numbers in the content are replaced with a mask. Detection is simple and does not guarantee complete removal. The diagram, text outline and session file are not changed.',
    'prompt.notice.copy': 'Copy',
    'prompt.notice.cancel': 'Cancel',
  },
};

const len = (s) => [...s].length;

// 内容（トピック → シーンの見出し → 要点）。シーンの区切りで PARAM-082 以内に切り詰める（途中のシーンの一部だけは入れない）。
// fix は利用者の文字（トピックの題名・見出し・要点）に掛ける変換（簡易マスキング）。上限の判定は変換した後の文字で行う（AC-469）。
export function buildContent(scenes, topics, t, max = MAX_CONTENT_CHARS, fix = (s) => s) {
  const topicOf = new Map();
  for (const tp of topics ?? []) for (const id of tp.sceneIds ?? []) topicOf.set(id, tp);
  const chunks = [];
  let prevTopic = null;
  for (const s of scenes) {
    const lines = [];
    const tp = topicOf.get(s.id) ?? null;
    if (tp && tp !== prevTopic) lines.push(`${t('prompt.topic')}: ${fix(tp.title)}`);
    prevTopic = tp;
    lines.push(`- ${t('prompt.scene')}: ${fix(s.heading)}`);
    for (const p of s.points) lines.push(`  - ${fix(p.text)}`);
    chunks.push(lines.join('\n'));
  }
  let body = '';
  let truncated = false;
  for (const c of chunks) {
    const next = body ? `${body}\n${c}` : c;
    if (len(next) > max) { truncated = true; break; }
    body = next;
  }
  return { body, truncated };
}

export function imagePromptModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings(STRINGS);
  const t = ctx.t;
  const lang = () => state.lang;
  let fallback = null; // { text } | null（クリップボードに書けなかったときの手でコピーする表示）

  // 画風の記述（表示言語）。持たない描画スタイル・未知の ID は null。
  api.getDrawStyleDescription = (...a) => {
    const spec = api.getDrawStyleSpec?.(...a);
    const d = spec?.description;
    if (!d || typeof d !== 'object') return null;
    const loc = d[lang()] ?? d.ja ?? Object.values(d)[0];
    if (!loc) return null;
    return { palette: loc.color, drawing: loc.drawing, typography: loc.font, mood: loc.mood };
  };

  const styleBodies = () => {
    const id = api.getDrawStyle?.();
    const desc = api.getDrawStyleDescription(id);
    if (desc) {
      const loc = { color: desc.palette, drawing: desc.drawing, font: desc.typography, mood: desc.mood };
      return Object.fromEntries(Object.entries(AXIS_OF).map(([k, ax]) => [k, loc[ax]]));
    }
    // 画風の記述を持たない（後から登録された）描画スタイル: その名前だけ
    const name = api.getDrawStyles?.().find((s) => s.id === id)?.label ?? String(id ?? '');
    return Object.fromEntries(Object.keys(AXIS_OF).map((k) => [k, name]));
  };

  const composition = () => {
    const ids = api.getLayoutInfo?.().selected ?? [];
    const lines = ids.map((id) => {
      const name = t(`label.layoutType.${id}`);
      const desc = COMPOSITION[id]?.[lang()] ?? LAYOUT_TYPE_META[id]?.[lang()]?.tip ?? '';
      return `- ${name}: ${desc}`;
    });
    return { typeIds: [...ids], body: [t('prompt.compositionLead'), ...lines].join('\n') };
  };

  // 簡易マスキング（AC-469）: NFR-PRIV-003 と同じ規則・同じ登録語。LLM 連携の有効・無効と AC-360 の設定には関係しない。
  const maskFix = () => { const words = api.getLlmMaskWords?.() ?? []; return (s) => maskText(s, words); };

  api.getImagePrompt = (opts) => {
    if (!state.scenes.length) return null;
    const mask = opts?.mask === true;
    const styles = styleBodies();
    const comp = composition();
    const content = buildContent(state.scenes, api.getTopics?.() ?? [], t, MAX_CONTENT_CHARS, mask ? maskFix() : undefined);
    const bodies = { purpose: t('prompt.purpose'), ...styles, composition: comp.body, content: content.body };
    const sections = SECTION_KEYS.map((key) => {
      const s = { key, heading: t(`prompt.head.${key}`), body: bodies[key] };
      if (key === 'composition') s.typeIds = comp.typeIds;
      return s;
    });
    let text = sections.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n');
    if (content.truncated) text += `\n\n${t('prompt.truncatedNote')}`;
    return { text: `${text}\n`, truncated: content.truncated, sections };
  };

  api.getPromptFallback = () => (fallback ? { open: true, text: fallback.text, selectable: true, role: 'dialog', label: t('prompt.fallback.label') } : null);
  api.closePromptFallback = () => { if (!fallback) return false; fallback = null; ctx.emit('change', api); return true; };

  const say = (key) => ctx.change(() => ctx.setMessage(key));
  const notify = () => ctx.emit('change', api);

  // ---- コピー前の注意（AC-468）。状態は app が持ち、画面（imageprompt-ui.js）は描くだけ ----
  // Tab の順序は画面の並び（簡易マスキング → 取りやめ → コピー。imageprompt-ui.js はこの順に置く）と同じにする（WCAG 2.4.3）
  const CONTROL_IDS = ['mask', 'cancel', 'copy'];
  let notice = null; // { mask:boolean, active:'mask'|'copy'|'cancel' } | null
  let focusAfter = null; // 閉じた後のフォーカス: 'button'（コピーの操作のボタン）。開いたことがなければ null
  api.getPromptCopyNotice = () => {
    if (!notice) return { open: false, focus: focusAfter, role: 'alertdialog', modal: true, label: t('prompt.notice.label'), text: t('prompt.notice.text'), live: 'assertive', mask: true, maskNote: t('prompt.notice.maskNote'), controls: controls(true), active: null };
    return { open: true, focus: 'notice', role: 'alertdialog', modal: true, label: t('prompt.notice.label'), text: t('prompt.notice.text'), live: 'assertive', mask: notice.mask, maskNote: t('prompt.notice.maskNote'), controls: controls(notice.mask), active: notice.active };
  };
  const controls = (mask) => [
    { id: 'mask', kind: 'checkbox', label: t('prompt.notice.mask'), checked: mask },
    { id: 'cancel', kind: 'button', label: t('prompt.notice.cancel') },
    { id: 'copy', kind: 'button', label: t('prompt.notice.copy') },
  ];
  const closeNotice = () => { notice = null; focusAfter = 'button'; };
  api.setPromptCopyMask = (v) => {
    if (!notice || typeof v !== 'boolean') return { ok: false };
    notice.mask = v; notify();
    return { ok: true };
  };
  // 画面でフォーカスが移った（クリック・支援技術）ときに、注意の中の現在の操作を合わせる
  api.setPromptCopyActive = (id) => {
    if (!notice || !CONTROL_IDS.includes(id)) return { ok: false };
    if (notice.active !== id) { notice.active = id; notify(); }
    return { ok: true };
  };
  api.cancelPromptCopy = () => {
    if (notice) { closeNotice(); notify(); }
    return { ok: true };
  };

  // 注意の「コピー」: 注意で選んだ簡易マスキングの適用の有無で文章を作り、クリップボードへ書く。外部へは何も送らない。
  api.confirmPromptCopy = async () => {
    if (!notice) return { ok: false, reason: 'notice' };
    const mask = notice.mask;
    closeNotice(); notify();
    const pr = api.getImagePrompt({ mask });
    if (!pr) { fallback = null; say('prompt.empty'); return { ok: false, reason: 'empty' }; }
    const clip = 'clipboard' in ctx.options ? ctx.options.clipboard : (globalThis.navigator?.clipboard ?? null);
    let ok = false;
    if (clip && typeof clip.writeText === 'function') {
      try { await clip.writeText(pr.text); ok = true; } catch { ok = false; }
    }
    if (!ok) {
      fallback = { text: pr.text };
      say('prompt.clipboardFailed');
      return { ok: false, reason: 'clipboard' };
    }
    fallback = null;
    say(pr.truncated ? 'prompt.truncated' : 'prompt.copied');
    return { ok: true, truncated: pr.truncated, masked: mask };
  };

  // コピーの操作（ボタン・キー・コマンドの検索で共通）。シーンがあれば、書き込む前に注意を開く。
  ctx.registerCommand('prompt.copy', async () => {
    if (!state.scenes.length) { fallback = null; say('prompt.empty'); return { ok: false, reason: 'empty' }; }
    if (!notice) {
      // 初期は「適用する」（LLM 連携の有効・無効と AC-360 の設定に関係しない）。最初の操作は簡易マスキングの選択
      notice = { mask: true, active: 'mask' };
      fallback = null;
      notify();
    }
    return { ok: true, pending: 'notice' };
  });
  // Ctrl+Alt+Shift+C（Copy）。Alt+Shift の 1 文字・数字・F キーは割り当て済みのため Ctrl を加える。
  ctx.registerKey({ key: 'c', ctrl: true, alt: true, shift: true, command: 'prompt.copy' });

  // 注意が開いている間のキー（モーダル。注意の外のキー操作は働かせない）
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (!notice) return baseKey(ev);
    const key = String(ev?.key ?? '');
    const plain = !ev.ctrlKey && !ev.altKey;
    if (key === 'Escape' && plain) { api.cancelPromptCopy(); return 'prompt.copy.cancel'; }
    if (key === 'Tab' && plain) {
      const i = CONTROL_IDS.indexOf(notice.active);
      const n = CONTROL_IDS.length;
      notice.active = CONTROL_IDS[(i + (ev.shiftKey ? n - 1 : 1)) % n]; notify();
      return 'prompt.copy.focus';
    }
    if ((key === ' ' || key === 'Spacebar') && plain && notice.active === 'mask') { api.setPromptCopyMask(!notice.mask); return 'prompt.copy.mask'; }
    if (key === 'Enter' && plain) {
      if (notice.active === 'mask') { api.setPromptCopyMask(!notice.mask); return 'prompt.copy.mask'; }
      if (notice.active === 'cancel') { api.cancelPromptCopy(); return 'prompt.copy.cancel'; }
      void api.confirmPromptCopy(); return 'prompt.copy.confirm';
    }
    if ((key === ' ' || key === 'Spacebar') && plain) {
      if (notice.active === 'cancel') { api.cancelPromptCopy(); return 'prompt.copy.cancel'; }
      void api.confirmPromptCopy(); return 'prompt.copy.confirm';
    }
    return null;
  };
}
