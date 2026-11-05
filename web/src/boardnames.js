// FR-114 AC-668・AC-680: 会議ボード型の人物に添える名前。出どころは (1) 参加者名簿（タイトル欄の近くで手入力。1 行に 1 名）と
// (2) .vtt の cue の話者タグ（<v 名前>。vtt.js の parseVttCues が speaker として返す）の 2 つだけ。音声・要点・LLM の応答から推測しない。
// 名前はブラウザ内（grp.boardNames）にだけ保存し、セッションファイル・grp.session には入れず、データの初期化で消す。
// 「名前を表示しない」（AC-680）は端末ごとの設定（grp.boardNames.hide）で、データの初期化では変わらない。
// 名前の入力・表示・保存で外部への通信はしない。簡易マスキング（AC-359・AC-471）の対象語として llmdraw.js に渡す。
import { readJson, writeJson, remove } from './persist.js';
import { escapeHtml } from './outline.js';

export const NAMES_KEY = 'grp.boardNames';
export const HIDE_KEY = 'grp.boardNames.hide';
export const NAME_MAX = 20; // PARAM-197: 名前 1 件の最大の長さ（文字。超えるときは先頭の 19 文字に「…」。PARAM-165 は名前には使わない）
export const ROSTER_MAX = 20; // PARAM-196: 参加者名簿・話者タグの名前の数の上限（それぞれ先頭から。重複は 1 名と数える）

// 名前の正規化（切り詰める前の全文。伏せ字の辞書にはこれを使う。AC-681 (a)）: 制御文字・連続空白を 1 つの空白に、前後の空白を除く
export function normName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
// 名前の長さの切り詰め（AC-668 (c) と同じ規則）: PARAM-197 文字を超えるときは先頭の PARAM-197−1 文字に「…」を付ける（文字としてだけ扱う）
export function clipName(s) {
  const a = [...normName(s)];
  return a.length <= NAME_MAX ? a.join('') : `${a.slice(0, NAME_MAX - 1).join('')}…`;
}

// 参加者名簿（文字列は 1 行に 1 名、配列は 1 要素 1 名）→ { names: 切り詰めた名前（入力順）, fulls: 同じ並びの切り詰める前の全文, over: 件数の上限で落とした名前があるか }
// 順序（AC-681 (a)(b)）: 長さの切り詰め → 重複の除去（切り詰め後の文字列で判定）→ 件数の上限
export function parseRosterDetail(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/\r\n|\r|\n/);
  const names = []; const fulls = []; let over = false;
  for (const x of list) {
    const f = normName(x); const n = clipName(f);
    if (!n || names.includes(n)) continue;
    if (names.length >= ROSTER_MAX) { over = true; continue; }
    names.push(n); fulls.push(f);
  }
  return { names, fulls, over };
}
export const parseRoster = (v) => parseRosterDetail(v).names;

// AC-668 (b): 参加メンバーの並び（名簿の入力順、続けて名簿にない話者タグの名前を最初に現れた順）
export function memberNames(roster, speakers) {
  const out = [...roster];
  for (const s of speakers) if (s && !out.includes(s)) out.push(s);
  return out;
}

// 発話の文字の指紋（保存した話者タグを、同じ id・同じ文字の発話にだけ結びつける。別のセッションを読み込んで id が重なっても誤って付けない）
export function textHash(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const STR = {
  ja: { roster: '参加者名簿', hide: '名前を隠す', hideTip: '名前を表示しない', members: '参加メンバー', said: '発言', over: `参加者は ${ROSTER_MAX} 名までです` },
  en: { roster: 'Participants', hide: 'Hide names', hideTip: 'Do not show names', members: 'Members', said: 'Speaker', paren: ['(', ')'], over: `Up to ${ROSTER_MAX} participants` },
};

export function boardNamesModule(ctx) {
  const { api, state } = ctx;
  const lang = () => (state.lang === 'en' ? 'en' : 'ja');
  const tx = () => STR[lang()];
  // ---- 保存（ブラウザ内だけ） ----
  let roster = []; let rosterFull = []; let speakers = {}; // speakers: 発話 id → { n: 切り詰めた名前, f: 全文（切り詰めたものと違うときだけ）, h: 文字の指紋 }
  { const raw = readJson(ctx.storage, NAMES_KEY); if (raw && typeof raw === 'object') {
    const d = parseRosterDetail(Array.isArray(raw.roster) ? raw.roster : []); roster = d.names;
    rosterFull = d.names.map((n, i) => { const f = Array.isArray(raw.rosterFull) ? normName(raw.rosterFull[i]) : ''; return f && clipName(f) === n ? f : n; });
    if (raw.speakers && typeof raw.speakers === 'object') for (const [k, v] of Object.entries(raw.speakers)) { const n = clipName(v?.n); if (n && typeof v?.h === 'string') { const f = normName(v?.f); speakers[k] = { n, h: v.h, ...(f && f !== n && clipName(f) === n ? { f } : {}) }; } }
  } }
  let hidden = readJson(ctx.storage, HIDE_KEY) === true;
  const save = () => { if (roster.length || Object.keys(speakers).length) writeJson(ctx.storage, NAMES_KEY, { roster, rosterFull, speakers }); else remove(ctx.storage, NAMES_KEY); };
  // データの初期化（FR-018）で名簿と話者タグの名前を消す。export は常に undefined（grp.session・セッションファイルに含めない）
  ctx.registerPersist?.('boardNames', { export: () => undefined, reset: () => { roster = []; rosterFull = []; speakers = {}; remove(ctx.storage, NAMES_KEY); } });

  const textOf = (u) => (typeof u.rawText === 'string' ? u.rawText : u.text);
  // .vtt の取込（一括・再生取込）が、追加した発話と cue の話者タグを渡す
  // AC-668 (g): 話者タグの名前も PARAM-196 の名数まで（取込の順に先頭から。重複は 1 名。超えた分は保持せず、その発話は名前なし）。長さ → 重複 → 件数の順
  api.recordSpeakers = (utterances, names) => {
    let changed = false;
    const kept = new Set(Object.values(speakers).map((s) => s.n));
    (utterances ?? []).forEach((u, i) => {
      const f = normName(names?.[i]); const n = clipName(f);
      if (!u?.id || !n) return;
      if (!kept.has(n) && kept.size >= ROSTER_MAX) return;
      kept.add(n); speakers[u.id] = { n, h: textHash(textOf(u)), ...(f !== n ? { f } : {}) }; changed = true;
    });
    if (changed) save();
    return changed;
  };
  const speakerOf = (uid) => {
    const s = uid ? speakers[uid] : null; if (!s) return null;
    const u = state.utterances.find((x) => x.id === uid);
    return u && textHash(textOf(u)) === s.h ? s.n : null;
  };
  api.getSpeakerName = (uid) => speakerOf(uid);
  // 名簿の入力（契約: setTitleInfo({ participants })）。文字列（1 行に 1 名）か文字列の配列
  api.getParticipants = () => [...roster];
  api.setParticipants = (v) => {
    if (typeof v !== 'string' && !(Array.isArray(v) && v.every((x) => typeof x === 'string'))) return { ok: false, reason: 'invalid' };
    const d = parseRosterDetail(v); roster = d.names; rosterFull = d.fulls; save(); ctx.change(() => {});
    // AC-681 (b): 上限で落としたときだけ理由を文字で示す（読み上げ対象の status）
    return { ok: true, participants: [...roster], ...(d.over ? { notice: { text: tx().over, role: 'status' } } : {}) };
  };
  const baseSetTitle = api.setTitleInfo;
  // 契約: getTitleInfo().participants は入力した文字列（未入力のときは項目を足さない。タイトル情報の保存・セッションファイルには入れない）
  const baseGetTitle = api.getTitleInfo;
  if (baseGetTitle) api.getTitleInfo = () => (roster.length ? { ...baseGetTitle(), participants: roster.join('\n') } : baseGetTitle());
  if (baseSetTitle) {
    api.setTitleInfo = (info) => {
      if (!info || typeof info !== 'object' || Array.isArray(info) || !('participants' in info)) return baseSetTitle(info);
      const { participants, ...rest } = info;
      const r = api.setParticipants(participants);
      if (!r.ok) return r;
      const base = Object.keys(rest).length ? baseSetTitle(rest) : { ok: true };
      return r.notice && base?.ok ? { ...base, notice: r.notice } : base;
    };
  }
  // AC-680: 名前を表示しない（端末ごと。既定はオフ＝表示する）
  api.getShowNames = () => !hidden;
  api.setShowNames = (v) => { if (typeof v !== 'boolean') return { ok: false, reason: 'invalid' }; hidden = !v; writeJson(ctx.storage, HIDE_KEY, hidden); ctx.change(() => {}); return { ok: true, show: v }; };
  api.getHideNames = () => hidden;
  api.setHideNames = (v) => (typeof v === 'boolean' ? { ok: api.setShowNames(!v).ok, hide: v } : { ok: false, reason: 'invalid' });
  // 名前の全体（表示の切り替えによらない。簡易マスキングの対象語）。図にまだ取り込んでいないライブの発話（held）の話者は含めない（AC-671）
  const allNames = () => memberNames(roster, state.utterances.filter((u) => !u.held).map((u) => speakerOf(u.id)));
  api.getPersonNames = () => memberNames(roster, state.utterances.map((u) => speakerOf(u.id)));
  // 伏せ字の辞書（AC-359・AC-471・AC-681 (a)）: 切り詰める前の全文と切り詰めた形の両方（長い名前から伏せる。画面・書き出しでは伏せず、LLM へ送る前・コピーの前だけに使う）
  api.getPersonMaskWords = () => {
    const out = [...roster, ...rosterFull];
    for (const u of state.utterances) { const s = speakers[u.id]; if (s && speakerOf(u.id)) out.push(s.n, s.f ?? s.n); }
    return [...new Set(out.filter(Boolean))];
  };
  // 会議ボードの配置（board.js）が使う名前。名前を表示しないときは名前のない汎用の人物だけ（人数は同じ。AC-680）。matchWords: AC-665 の担当の列を伏せる照合の語（AC-668 (h)）
  api.getBoardNames = () => (hidden ? { members: allNames(), speakerOf: () => null, anonymous: true, matchWords: api.getPersonMaskWords() } : { members: allNames(), speakerOf });
  // PNG・PDF の保存（export.js）に載せる名前の行。会議ボード型の図に名前が載っている間だけ（AC-668 (d)・AC-680）
  api.getExportNameLines = () => {
    if (hidden || !api.isBoardActive?.()) return [];
    const names = allNames().map(clipName).filter(Boolean);
    return names.length ? [`${tx().members}:`, ...names.map((n) => `・${n}`)] : []; // 名前が折り返しで分かれないよう 1 行に 1 名
  };
  // 名前を伏せる（AC-358・AC-359・FR-078 の決定 2026-11-05）: LLM へ送る文字と画像生成プロンプトでは、簡易マスキングの設定に関わらず常に伏せる。長い名前から
  api.maskPersonNames = (text) => maskNames(text, api.getPersonMaskWords());
  // Markdown の保存（presentexport.js）: テキスト一覧と同じ名前（図に名前が載っている間だけ）。{ membersLine, saidOf: Map(要点 id → 「（発言: 名前）」) } | null
  api.getBoardNameNotes = () => {
    const m = api.isBoardActive?.() && !hidden ? api.getDiagramLayout?.()?.board : null;
    if (!m) return null;
    const c = collectBoardNames(m);
    if (!c.members.length && !c.said.length) return null;
    const t = tx(); const [o, cl] = t.paren ?? ['（', '）'];
    return { membersLine: c.members.length ? `${t.members}: ${c.members.join('、')}` : '', saidOf: new Map(c.said.map(([pid, n]) => [pid, `${o}${t.said}: ${n}${cl}`])) };
  };

  // ---- テキスト一覧（NFR-A11Y-001。AC-668 (d)）: 図に名前が載っている間だけ、同じ名前を文字で ----
  const baseOutline = api.renderOutline;
  if (baseOutline) {
    api.renderOutline = (...a) => {
      const html = baseOutline(...a);
      const m = api.isBoardActive?.() && !hidden ? api.getDiagramLayout?.()?.board : null;
      return m ? boardNamesOutline(html, m, tx()) : html;
    };
  }
  // ---- ［設定］の切り替え（AC-680。契約: board.hideNames・コマンド settings.hideNames・Space で切り替え） ----
  const FIELD_ID = 'board.hideNames';
  let focused = false;
  const baseSetField = api.setSettingsField;
  api.setSettingsField = (id, value) => (id === FIELD_ID ? api.setHideNames(value) : baseSetField ? baseSetField(id, value) : { ok: false, reason: 'not_found' });
  const baseDialog = api.getSettingsDialog;
  const dialogOpen = () => Boolean(baseDialog?.());
  if (baseDialog) api.getSettingsDialog = () => { const d = baseDialog(); return d ? { ...d, fields: [...d.fields, { id: FIELD_ID, label: tx().hide, description: tx().hideTip, value: hidden, role: 'switch', focusable: true }], focusedField: focused ? FIELD_ID : (d.focusedField ?? null) } : d; };
  const baseView = api.getSettingsView;
  if (baseView) api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: FIELD_ID, visible: true }] }; };
  const baseFocus = api.focusSettingsField;
  api.focusSettingsField = (id) => {
    if (id === FIELD_ID) { if (!dialogOpen()) return false; baseFocus?.(null); focused = true; ctx.emit('change', api); return true; }
    focused = false; return baseFocus ? baseFocus(id) : false;
  };
  ctx.on?.('change', () => { if (!dialogOpen()) focused = false; });
  ctx.registerCommand('settings.hideNames', () => { api.commands['settings.open']?.(); api.focusSettingsField(FIELD_ID); });
  ctx.registerKey({ key: 'F7', ctrl: true, shift: true, command: 'settings.hideNames' }); // NFR-A11Y-001: キー割り当て（Ctrl+Shift+F7 は未使用）
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    const k = String(ev?.key);
    if (focused && dialogOpen() && !ev?.ctrlKey && !ev?.altKey && !ev?.shiftKey && (k === ' ' || k === 'Spacebar' || k === 'Enter')) { api.setHideNames(!hidden); return 'settings.hideNames.toggle'; }
    return baseKey(ev);
  };
  api.getBoardNamesLabels = () => ({ roster: tx().roster, hide: tx().hide, hideTip: tx().hideTip });
  // 名簿の入力欄（タイトル欄と同じ場所。FR-036）
  const baseSpec = api.getMeetingFormSpec;
  if (baseSpec) api.getMeetingFormSpec = () => { const s = baseSpec(); return { ...s, fields: [...s.fields, { id: 'participants', label: tx().roster, kind: 'participants' }] }; };
  const baseValues = api.getMeetingFormValues;
  if (baseValues) api.getMeetingFormValues = () => ({ ...baseValues(), participants: roster.join('\n') });
}

// 名前を伏せ字（●●●。簡易マスキングと同じ）に置き換える。長い名前から（短い名前が長い名前の一部を先に伏せないように）
export const NAME_MASK = '●●●';
export function maskNames(text, names, mask = NAME_MASK) {
  let s = String(text ?? '');
  for (const n of [...new Set((names ?? []).map((x) => String(x ?? '').trim()).filter(Boolean))].sort((a, b) => [...b].length - [...a].length)) s = s.split(n).join(mask);
  return s;
}

// 図のモデルから、テキスト一覧・Markdown に載せる名前を集める（参加メンバーの名前の並びと、[ステップの最初の要点 id, 話者の名前]）
export function collectBoardNames(board) {
  const members = []; const said = [];
  for (const s of board?.sections ?? []) {
    for (const el of s.elements ?? []) {
      if (el.part === 'person' && el.member && el.name) members.push(el.name);
      if (el.speaker && el.name && el.firstPointId) said.push([el.firstPointId, el.name]);
    }
  }
  return { members, said };
}

// テキスト一覧への追記: 「参加メンバー: 名前、…」の 1 行と、各ステップの最初の要点の行に「（発言: 名前）」
export function boardNamesOutline(html, board, t) {
  const { members, said } = collectBoardNames(board);
  let out = String(html);
  for (const [pid, name] of said) {
    const at = out.indexOf(`<li data-point-id="${escapeHtml(pid)}"`);
    if (at < 0) continue;
    const end = out.indexOf('</li>', at);
    if (end < 0) continue;
    const [o, c] = t.paren ?? ['（', '）'];
    out = `${out.slice(0, end)} <span class="outline-speaker" data-speaker-of="${escapeHtml(pid)}">${o}${escapeHtml(t.said)}: ${escapeHtml(name)}${c}</span>${out.slice(end)}`;
  }
  // AC-529: 行単位で読んでも「参加メンバー: 名前、…」が 1 行になるよう、改行で前後と区切る（Markdown の行と同じ文字）
  const line = members.length ? `<p class="outline-members" data-board-members>\n${escapeHtml(t.members)}: ${members.map(escapeHtml).join('、')}\n</p>\n` : '';
  return line + out;
}
