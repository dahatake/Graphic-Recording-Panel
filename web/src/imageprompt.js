// FR-078 画像生成 AI 向けのプロンプトのコピー（契約: tests/system/CONTRACT-FR077-078.md「画像生成プロンプトのコピー」）。DOM に依存しない。
// 文章の構成: 目的・配色・文字・イラスト・雰囲気・構成・内容（依頼に添付の Prompt と同じ形。文面はこのアプリ独自）。
//   配色〜雰囲気 = 選んでいる描画スタイルの画風の記述（drawstyles.js・stylepresets.js の description）
//   構成 = 現在のレイアウト型（FR-027）の名称と説明 ／ 内容 = トピック・シーンの見出し・要点（テキスト一覧と同じ順序。手修正後の文字）
// 文章は外部へ送らず、保存もしない（クリップボードへ書くだけ。書けないときは画面に表示して手でコピーしてもらう）。
// Q-027 A（AC-470〜474）: コピーの操作はまず注意（モーダルのダイアログ）を開き、注意で「コピー」を選んだときだけ書き込む。
//   注意の中で、内容の部分に簡易マスキング（NFR-PRIV-003 と同じ対象・伏せ字。api.applyLlmMask）を適用するかを選べる。
//   伏せ字の選択は注意を開くたびに簡易マスキングの設定（getLlmMasking）から始まり、設定は変えず、保存もしない。
import { LAYOUT_TYPE_META } from './layouttypes.js';
import { matchKey } from './keymap.js';

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
    // コピーの前の注意（AC-470・471）
    'prompt.notice.label': '画像生成 AI 向けのプロンプトをコピーする前に',
    'prompt.notice.content': 'コピーする文章には、図の内容（トピック・シーンの見出しと要点）がそのまま入ります。人名・連絡先などの個人情報を含むことがあります。',
    'prompt.notice.external': '文章を貼り付けると、貼り付けた先の外部サービス（画像生成 AI など）にその内容が渡ります。',
    'prompt.notice.local': 'このアプリ自身は、この文章を外部へ送信せず、保存もしません。',
    'prompt.notice.maskLimit': '伏せ字の検出は簡易なもので、個人情報を完全に取り除くことは保証しません。',
    'prompt.notice.mask': '内容の部分に伏せ字を適用する（登録した語・敬称付きの人名・メールアドレス・電話番号）',
    'prompt.notice.copy': 'コピー',
    'prompt.notice.cancel': 'キャンセル',
    'prompt.maskedSuffix': '（内容の部分に伏せ字を適用しました）',
    'prompt.unmaskedSuffix': '（伏せ字は適用していません）',
    'prompt.maskFailed': '伏せ字を適用できなかったため、コピーしていません。伏せ字を適用せずにコピーするか、キャンセルしてください',
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
    'prompt.notice.label': 'Before you copy the prompt for image-generation AI',
    'prompt.notice.content': 'The copied text contains the diagram content (topics, scene headings and points) as is. It may include personal information such as names or contact details.',
    'prompt.notice.external': 'When you paste the text, that content is passed to the external service you paste it into (such as an image-generation AI).',
    'prompt.notice.local': 'This app itself does not send this text anywhere and does not save it.',
    'prompt.notice.maskLimit': 'Masking uses simple detection and does not guarantee complete removal of personal information.',
    'prompt.notice.mask': 'Mask the content part (registered words, names with honorifics, email addresses, phone numbers)',
    'prompt.notice.copy': 'Copy',
    'prompt.notice.cancel': 'Cancel',
    'prompt.maskedSuffix': ' (masking was applied to the content)',
    'prompt.unmaskedSuffix': ' (no masking was applied)',
    'prompt.maskFailed': 'Masking could not be applied, so nothing was copied. Copy without masking, or cancel',
  },
};

const len = (s) => [...s].length;

// 内容（トピック → シーンの見出し → 要点）。シーンの区切りで PARAM-082 以内に切り詰める（途中のシーンの一部だけは入れない）。
// tf: トピックの題名・見出し・要点の文字に適用する変換（伏せ字。AC-472: 切り詰めの前に適用し、文字数は変換後で数える）。
export function buildContent(scenes, topics, t, max = MAX_CONTENT_CHARS, tf = (s) => s) {
  const topicOf = new Map();
  for (const tp of topics ?? []) for (const id of tp.sceneIds ?? []) topicOf.set(id, tp);
  const chunks = [];
  let prevTopic = null;
  for (const s of scenes) {
    const lines = [];
    const tp = topicOf.get(s.id) ?? null;
    if (tp && tp !== prevTopic) lines.push(`${t('prompt.topic')}: ${tf(tp.title)}`);
    prevTopic = tp;
    lines.push(`- ${t('prompt.scene')}: ${tf(s.heading)}`);
    for (const p of s.points) lines.push(`  - ${tf(p.text)}`);
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

  // mask: 内容の部分（トピックの題名・見出し・要点）に簡易マスキングを適用する（AC-471）。適用できないときは例外（AC-472）。
  const maskFn = () => {
    const f = api.applyLlmMask;
    if (typeof f !== 'function') throw new Error('mask unavailable');
    return (s) => { const r = f(s); if (typeof r !== 'string') throw new Error('mask failed'); return r; };
  };
  const build = (mask) => {
    if (!state.scenes.length) return null;
    const styles = styleBodies();
    const comp = composition();
    const content = buildContent(state.scenes, api.getTopics?.() ?? [], t, MAX_CONTENT_CHARS, mask ? maskFn() : undefined);
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
  api.getImagePrompt = (opts = {}) => build(opts?.mask === true);

  api.getPromptFallback = () => (fallback ? { open: true, text: fallback.text, selectable: true, role: 'dialog', label: t('prompt.fallback.label') } : null);
  api.closePromptFallback = () => { if (!fallback) return false; fallback = null; ctx.emit('change', api); return true; };

  const say = (key) => ctx.change(() => ctx.setMessage(key));
  // コピーの結果のメッセージ（読み上げ対象）。伏せ字を適用したかも示す（AC-471）。
  const messageText = (key, masked) => `${t(key)}${t(masked ? 'prompt.maskedSuffix' : 'prompt.unmaskedSuffix')}`;
  const sayCopy = (key, masked) => ctx.change((s) => { ctx.setMessage(key); s.message.masked = masked; s.message.text = messageText(key, masked); });
  // 表示言語を切り替えたら、伏せ字の有無を含むメッセージも訳し直す（app.setLang は key だけから訳すため）
  ctx.on('lang', () => {
    const m = state.message;
    if (m && typeof m.masked === 'boolean' && m.text !== messageText(m.key, m.masked)) ctx.change(() => { m.text = messageText(m.key, m.masked); });
  });

  // ---- フォーカスの位置（AC-473。コマンドバーのボタンは 'command:<command>'、注意の中は 'notice:<id>'） ----
  const NOTICE_FOCUS = ['mask', 'copy', 'cancel']; // 画面の並び順（Tab の巡回順）
  let focus = 'none';
  let notice = null; // { mask:boolean, focus:'mask'|'copy'|'cancel', error:string|null } | null（開いている注意）
  api.getFocus = () => (notice ? `notice:${notice.focus}` : focus);
  api.focusCommand = (command) => {
    if (notice) return { ok: false, reason: 'modal' }; // 注意が開いている間は注意の外へ移さない
    if (!(api.getCommandBar?.().items ?? []).some((i) => i.command === command)) return { ok: false, reason: 'unknown' };
    focus = `command:${command}`;
    return { ok: true };
  };
  // 画面（imageprompt-ui.js）が、コマンドバーの外へフォーカスが移ったことを伝える
  api.noteFocus = (where) => { if (notice) return false; focus = String(where ?? 'none'); return true; };

  // ---- コピーの前の注意（AC-470・471・473） ----
  const STATEMENTS = ['content', 'external', 'local', 'maskLimit'];
  api.getPromptNotice = () => {
    if (!notice) return null;
    const statements = STATEMENTS.map((key) => ({ key, text: t(`prompt.notice.${key}`) }));
    return {
      open: true, role: 'dialog', modal: true, label: t('prompt.notice.label'),
      description: statements.map((s) => s.text).join(' '), statements,
      mask: { role: 'checkbox', label: t('prompt.notice.mask'), checked: notice.mask },
      buttons: [{ id: 'copy', label: t('prompt.notice.copy') }, { id: 'cancel', label: t('prompt.notice.cancel') }],
      focus: notice.focus, error: notice.error ? t(notice.error) : null,
    };
  };
  const notify = () => ctx.emit('change', api);
  const openNotice = () => {
    fallback = null; // 前回の手でコピーする表示は閉じる
    api.closeDrawStylePicker?.(null);
    notice = { mask: api.getLlmMasking?.() !== false, focus: 'mask', error: null }; // 初期値は簡易マスキングの設定（AC-472）
    notify();
  };
  // 閉じると、フォーカスは開く前の位置（focus はそのまま残っている）に戻る
  const closeNotice = () => { notice = null; notify(); };
  api.setPromptNoticeMask = (v) => {
    if (!notice) return false;
    notice.mask = v === true; notice.error = null; // 設定（getLlmMasking）は変えない
    notify();
    return true;
  };
  api.setPromptNoticeFocus = (id) => {
    if (!notice || !NOTICE_FOCUS.includes(id)) return false;
    if (notice.focus !== id) { notice.focus = id; notify(); }
    return true;
  };

  const clipboard = () => ('clipboard' in ctx.options ? ctx.options.clipboard : (globalThis.navigator?.clipboard ?? null));
  const copy = async () => {
    if (!notice) return { ok: false, reason: 'closed' };
    const masked = notice.mask;
    let pr;
    try { pr = build(masked); } catch {
      // AC-472: 伏せ字を適用できなかった。伏せ字のない文章は書き込まず・表示もせず、注意に戻る（読み上げ対象のメッセージで示す）
      notice.error = 'prompt.maskFailed';
      say('prompt.maskFailed');
      return { ok: false, reason: 'mask' };
    }
    if (!pr) { closeNotice(); fallback = null; say('prompt.empty'); return { ok: false, reason: 'empty' }; }
    closeNotice(); // 書き込みを待つ前に閉じる（二重の書き込みを防ぐ）
    const clip = clipboard();
    let ok = false;
    if (clip && typeof clip.writeText === 'function') {
      try { await clip.writeText(pr.text); ok = true; } catch { ok = false; }
    }
    if (!ok) {
      fallback = { text: pr.text }; // 選んだ伏せ字の選択を反映した文章（AC-472）
      sayCopy('prompt.clipboardFailed', masked);
      return { ok: false, reason: 'clipboard' };
    }
    fallback = null;
    sayCopy(pr.truncated ? 'prompt.truncated' : 'prompt.copied', masked);
    return { ok: true, truncated: pr.truncated, masked };
  };
  api.promptNoticeAction = async (id) => {
    if (!notice) return { ok: false, reason: 'closed' };
    if (id === 'copy') return copy();
    if (id === 'cancel') { closeNotice(); return { ok: true }; }
    return { ok: false, reason: 'invalid' };
  };

  // コピーの操作（ボタン・キー・コマンドの検索で共通）。注意を開くだけで、書き込みは注意の「コピー」で行う。外部へは何も送らない。
  ctx.registerCommand('prompt.copy', async () => {
    if (notice) return { ok: true, pending: true };
    if (!state.scenes.length) { fallback = null; say('prompt.empty'); return { ok: false, reason: 'empty' }; } // シーン 0 は注意を開かない
    openNotice(); // 同期で開く（handleKey から呼ばれても、戻った時点で開いている）
    return { ok: true, pending: true };
  });
  // Ctrl+Alt+Shift+C（Copy）。Alt+Shift の 1 文字・数字・F キーは割り当て済みのため Ctrl を加える。
  ctx.registerKey({ key: 'c', ctrl: true, alt: true, shift: true, command: 'prompt.copy' });

  // ---- キー: 注意が開いている間は、Tab・Shift+Tab は注意の中を巡回し、Space・Enter・Esc は注意で使う。ほかのショートカットは働かせない ----
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (!notice) return baseKey(ev);
    const key = String(ev?.key ?? '');
    const mod = !!ev?.ctrlKey || !!ev?.altKey;
    if (!mod && key === 'Escape') { closeNotice(); return 'prompt.notice.cancel'; }
    if (!mod && key === 'Tab') {
      const i = NOTICE_FOCUS.indexOf(notice.focus);
      const n = NOTICE_FOCUS.length;
      notice.focus = NOTICE_FOCUS[(i + (ev.shiftKey ? n - 1 : 1)) % n];
      notify();
      return ev.shiftKey ? 'prompt.notice.prev' : 'prompt.notice.next';
    }
    if (!mod && !ev?.shiftKey && (key === ' ' || key === 'Spacebar' || key === 'Enter')) {
      const f = notice.focus;
      if (f === 'mask') {
        if (key === 'Enter') return 'prompt.notice.none'; // チェックボックスは Enter では切り替えない
        api.setPromptNoticeMask(!notice.mask);
        return 'prompt.notice.mask';
      }
      if (f === 'copy') { void api.promptNoticeAction('copy'); return 'prompt.notice.copy'; }
      closeNotice();
      return 'prompt.notice.cancel';
    }
    return matchKey(api.keymap, ev) ? 'prompt.notice.blocked' : null;
  };
}
