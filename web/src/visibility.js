// FR-104 AC-603〜606: 公開範囲（社内・参加者のみ・公開。PARAM-140）と機密の印、機密の要点を除いた保存。
// - 公開範囲は PNG・SVG・PDF・Markdown・HTML の出力に文字で載る（meeting.js の getMeetingOutput・図の説明が api.getVisibilityLines を使う）。外部へは送らない。
// - 機密の印は要点の confidential（true のときだけ持つ）。図・ポップアップ・テキスト一覧に、文字「機密」と錠の記号で示す（色だけにしない）。
// - 保存の操作で「機密の要点を除く」を選ぶと、保存（ダウンロード 5 形式）の作成の間だけ、シーン・発話・議事項目から機密の要点を除いた写しを状態に差し替える。
//   これで本文・図・図の説明・「要確認」の節・件数 n・m・k・議事項目が同じ入力から作られ、「機密の除外が優先」になる（AC-606）。画面・セッションの保存・プレゼンテーションは差し替えない。
import { escapeHtml } from './outline.js';

export const VISIBILITY_IDS = ['internal', 'participants', 'public']; // PARAM-140
export const DEFAULT_VISIBILITY = 'participants'; // PARAM-140 の既定
const LABELS = {
  ja: { internal: '社内', participants: '参加者のみ', public: '公開' },
  en: { internal: 'Internal', participants: 'Participants only', public: 'Public' },
};
const WORDS = {
  ja: { visibility: '公開範囲', excluded: (n) => `機密の要点を除外: ${n} 件`, confidential: '機密', hidden: '(機密のため伏せた見出し)' },
  en: { visibility: 'Visibility', excluded: (n) => `Confidential points excluded: ${n}`, confidential: 'Confidential', hidden: '(Heading hidden: confidential)' },
};
const SAVE_COMMANDS = ['save.png', 'save.svg', 'save.pdf', 'save.markdown', 'save.html'];

export const visibilityLabel = (id, lang = 'ja') => (LABELS[lang === 'en' ? 'en' : 'ja'][id] ?? '');
export const visibilityLine = (id, lang = 'ja') => `${WORDS[lang === 'en' ? 'en' : 'ja'].visibility}: ${visibilityLabel(id, lang)}`;
export const excludedLine = (n, lang = 'ja') => WORDS[lang === 'en' ? 'en' : 'ja'].excluded(n);

// 機密の要点の数
export const countConfidential = (scenes) => (scenes ?? []).reduce((n, s) => n + (s.points ?? []).filter((p) => p.confidential === true).length, 0);

// 機密の要点（と、それを端に持つ関係）を除いたシーンの写し。元は変えない（AC-606）。
// 見出しは最初の発話から作るため、機密の要点の文字を含む（または機密の要点が見出しの一部になっている）見出しは、伏せた見出しに置き換える。
export function withoutConfidential(scenes, lang = 'ja') {
  return (scenes ?? []).map((s) => {
    const secrets = (s.points ?? []).filter((p) => p.confidential === true).map((p) => String(p.text ?? ''));
    const points = (s.points ?? []).filter((p) => p.confidential !== true);
    const keep = new Set(points.map((p) => p.id));
    const core = String(s.heading ?? '').replace(/…$/, '');
    const leaks = secrets.some((t) => t && core && (t.includes(core) || core.includes(t)));
    return { ...s, ...(leaks ? { heading: WORDS[lang === 'en' ? 'en' : 'ja'].hidden } : {}), points, relations: (s.relations ?? []).filter((r) => keep.has(r.from) && keep.has(r.to)) };
  });
}

export function visibilityModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'visibility.label': '公開範囲', 'visibility.exclude': '保存で機密の要点を除く', 'visibility.group': '公開範囲と機密',
      'msg.confidentialOn': '要点に機密の印を付けました', 'msg.confidentialOff': '要点の機密の印を外しました', 'msg.confidentialNone': '機密の印を付ける要点を選んでください',
      'cmd.point.confidential': '選択した要点の機密の印を付け外し', 'confidential.mark': '機密', 'confidential.set': '機密にする', 'confidential.unset': '機密を外す',
    },
    en: {
      'visibility.label': 'Visibility', 'visibility.exclude': 'Exclude confidential points when saving', 'visibility.group': 'Visibility and confidentiality',
      'msg.confidentialOn': 'The point was marked confidential', 'msg.confidentialOff': 'The confidential mark was removed', 'msg.confidentialNone': 'Select a point to mark as confidential',
      'cmd.point.confidential': 'Toggle the confidential mark of the selected point', 'confidential.mark': 'Confidential', 'confidential.set': 'Mark confidential', 'confidential.unset': 'Remove the mark',
    },
  });
  let level = DEFAULT_VISIBILITY;
  let excludeChoice = null; // null: 既定（公開範囲が「公開」のとき除く）に従う。利用者が選ぶと true/false
  let selectedPointId = null;
  let exporting = null; // 保存の作成中: { n }
  const lang = () => state.lang;

  const shouldExclude = () => (excludeChoice == null ? level === 'public' : excludeChoice);
  const findPoint = (id) => { for (const s of state.scenes) { const p = s.points.find((q) => q.id === id); if (p) return p; } return null; };

  // ---- 公開範囲（AC-603） ----
  api.getVisibility = () => level;
  api.getVisibilityInfo = () => ({
    level, label: visibilityLabel(level, lang()),
    options: VISIBILITY_IDS.map((id) => ({ id, label: visibilityLabel(id, lang()), current: id === level })),
  });
  api.setVisibility = (id) => {
    if (!VISIBILITY_IDS.includes(id)) return { ok: false, reason: 'invalid' };
    if (id !== level) ctx.change(() => { level = id; });
    return { ok: true, level };
  };
  // 保存の操作の選択（AC-606）。null で既定（公開範囲が「公開」のとき除く）に戻す
  api.getExcludeConfidential = () => shouldExclude();
  api.setExcludeConfidential = (on) => {
    if (on !== null && typeof on !== 'boolean') return { ok: false, reason: 'invalid' };
    ctx.change(() => { excludeChoice = on; });
    return { ok: true, exclude: shouldExclude() };
  };
  api.getConfidentialCount = () => countConfidential(state.scenes);
  api.getVisibilityForm = () => ({
    group: ctx.t('visibility.group'), label: ctx.t('visibility.label'), excludeLabel: ctx.t('visibility.exclude'),
    value: level, options: VISIBILITY_IDS.map((id) => ({ value: id, label: visibilityLabel(id, lang()) })), exclude: shouldExclude(),
  });
  // 出力が載せる行（AC-604・AC-606）。保存の作成中で「除く」のときだけ、除外した件数の行も載る
  api.getVisibilityLines = () => ({ visibilityLine: visibilityLine(level, lang()), ...(exporting ? { excludedLine: excludedLine(exporting.n, lang()) } : {}) });

  // ---- 機密の印（AC-605） ----
  api.selectPoint = api.selectPoint ?? ((id) => {
    if (!findPoint(id)) return { ok: false, reason: 'not_found' };
    selectedPointId = id;
    ctx.emit('change', api);
    return { ok: true };
  });
  api.getSelectedPointId = () => (selectedPointId && findPoint(selectedPointId) ? selectedPointId : null);
  api.setPointConfidential = (pointId, on) => {
    const p = findPoint(pointId);
    if (!p) { ctx.change(() => ctx.setMessage('msg.confidentialNone')); return { ok: false, reason: 'not_found' }; }
    const next = typeof on === 'boolean' ? on : p.confidential !== true;
    ctx.change(() => { if (next) p.confidential = true; else delete p.confidential; ctx.setMessage(next ? 'msg.confidentialOn' : 'msg.confidentialOff'); });
    return { ok: true, confidential: next };
  };
  ctx.registerCommand('point.confidential', () => {
    const id = api.getSelectedPointId?.() ?? api.getHighlight?.()?.pointId ?? null;
    if (!id) { ctx.change(() => ctx.setMessage('msg.confidentialNone')); return { ok: false, reason: 'no_selection' }; }
    return api.setPointConfidential(id);
  });
  ctx.registerKey({ key: ';', ctrl: true, alt: true, shift: true, command: 'point.confidential' });

  // 表示: 文字「機密」＋錠の記号（テキスト一覧・ポップアップ。図は getReviewMark の経由）。選択中の要点には付け外しのボタンを添える
  const baseExtra = api.getPointExtraHtml;
  api.getPointExtraHtml = (p) => {
    const base = baseExtra ? baseExtra(p) : '';
    const conf = p.confidential === true;
    if (!conf && selectedPointId !== p.id) return base; // 多くの要点は何も足さない（NFR-PERF-003: 要点ごとの探索をしない）
    let out = base;
    if (conf) out += ` <span class="badge badge-confidential" data-confidential="1"><span aria-hidden="true">🔒</span> ${escapeHtml(ctx.t('confidential.mark'))}</span>`;
    if (selectedPointId === p.id) out += ` <button type="button" class="btn btn-small" data-conf-toggle="${escapeHtml(p.id)}" aria-pressed="${conf}">${escapeHtml(ctx.t(conf ? 'confidential.unset' : 'confidential.set'))}</button>`;
    return out;
  };
  // 機密の要点の id の集合（データの版数ごとに 1 回だけ作る）
  let confMemo = { ver: -2, ids: new Set() };
  const confIds = () => {
    const v = ctx.getDataVersion();
    if (v != null && confMemo.ver === v) return confMemo.ids;
    const ids = new Set();
    for (const s of state.scenes) for (const p of s.points) if (p.confidential === true) ids.add(p.id);
    confMemo = { ver: v ?? -2, ids };
    return ids;
  };
  const baseMark = api.getReviewMark;
  api.getReviewMark = (refIds) => {
    const base = baseMark ? baseMark(refIds) : null;
    const ids = confIds();
    if (!ids.size || !(refIds ?? []).some((id) => ids.has(id))) return base;
    return { needsReview: false, reasons: [], label: '', ...(base ?? {}), confidential: true, confidentialLabel: ctx.t('confidential.mark') };
  };
  const baseInfo = api.getPointInfo;
  api.getPointInfo = (id) => {
    const info = baseInfo ? baseInfo(id) : null;
    return info && confIds().has(id) ? { ...info, confidential: true } : info;
  };

  // ---- 保存（AC-606）: 保存の作成の間だけ、機密を除いた写しを状態に差し替える ----
  // ctx.change の中で行う（データの版数のキャッシュを使わない・終了時に版数を進めて、作成中の結果をキャッシュに残さない）
  function withExclusion(fn) {
    if (!shouldExclude()) return fn();
    const n = countConfidential(state.scenes);
    const keep = { scenes: state.scenes, utterances: state.utterances, minutes: state.minutes };
    const secret = new Set(state.scenes.flatMap((s) => s.points).filter((p) => p.confidential === true && p.uid).map((p) => p.uid));
    let out;
    ctx.change(() => {
      exporting = { n };
      state.scenes = withoutConfidential(keep.scenes, lang());
      if (secret.size) state.utterances = keep.utterances.filter((u) => !secret.has(u.id));
      if (keep.minutes && Array.isArray(keep.minutes.items)) state.minutes = { ...keep.minutes, items: keep.minutes.items.filter((i) => !secret.has(i.sourceUtteranceId)) };
      try { out = fn(); } finally {
        state.scenes = keep.scenes; state.utterances = keep.utterances; if (keep.minutes) state.minutes = keep.minutes;
        exporting = null;
      }
    });
    return out;
  }
  for (const name of SAVE_COMMANDS) {
    const base = api.commands[name];
    if (typeof base === 'function') ctx.registerCommand(name, (...a) => withExclusion(() => base(...a)));
  }

  ctx.registerPersist('visibility', {
    export: () => (level !== DEFAULT_VISIBILITY || excludeChoice != null ? { level, ...(excludeChoice != null ? { exclude: excludeChoice } : {}) } : undefined),
    import: (v) => {
      const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      level = VISIBILITY_IDS.includes(o.level) ? o.level : DEFAULT_VISIBILITY;
      excludeChoice = typeof o.exclude === 'boolean' ? o.exclude : null;
    },
    reset: () => { level = DEFAULT_VISIBILITY; excludeChoice = null; selectedPointId = null; },
  });
}
