// FR-114 AC-668・AC-680: 会議ボード型の人物に添える名前。出どころは (1) 参加者名簿（タイトル欄の近くで手入力。1 行に 1 名）と
// (2) .vtt の cue の話者タグ（<v 名前>。vtt.js の parseVttCues が speaker として返す）の 2 つだけ。音声・要点・LLM の応答から推測しない。
// 名前はブラウザ内（grp.boardNames）にだけ保存し、セッションファイル・grp.session には入れず、データの初期化で消す。
// 「名前を表示しない」（AC-680）は端末ごとの設定（grp.boardNames.hide）で、データの初期化では変わらない。
// 名前の入力・表示・保存で外部への通信はしない。簡易マスキング（AC-359・AC-471）の対象語として llmdraw.js に渡す。
import { readJson, writeJson, remove } from './persist.js';
import { escapeHtml } from './outline.js';

export const NAMES_KEY = 'grp.boardNames';
export const HIDE_KEY = 'grp.boardNames.hide';
export const NAME_MAX = 24; // PARAM-165: 名前の最大の長さ（文字）
export const ROSTER_MAX = 100; // 名簿の最大の人数（保存の大きさを限る）

// 名前の正規化: 制御文字・連続空白を 1 つの空白に、前後の空白を除き、PARAM-165 文字に切り詰める（文字としてだけ扱う）
export function clipName(s) {
  return [...String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX).join('');
}

// 参加者名簿（文字列は 1 行に 1 名、配列は 1 要素 1 名）→ 名前の配列（入力順、空・重複を除く）
export function parseRoster(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/\r\n|\r|\n/);
  const out = [];
  for (const x of list) { const n = clipName(x); if (n && !out.includes(n)) out.push(n); if (out.length >= ROSTER_MAX) break; }
  return out;
}

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
  ja: { roster: '参加者名簿（1 行に 1 名）', hide: '名前を表示しない', members: '参加メンバー', said: '発言' },
  en: { roster: 'Participants (one per line)', hide: 'Hide names', members: 'Members', said: 'Speaker', paren: ['(', ')'] },
};

export function boardNamesModule(ctx) {
  const { api, state } = ctx;
  const lang = () => (state.lang === 'en' ? 'en' : 'ja');
  const tx = () => STR[lang()];
  // ---- 保存（ブラウザ内だけ） ----
  let roster = []; let speakers = {}; // speakers: 発話 id → { n: 名前, h: 文字の指紋 }
  { const raw = readJson(ctx.storage, NAMES_KEY); if (raw && typeof raw === 'object') { roster = parseRoster(Array.isArray(raw.roster) ? raw.roster : []); if (raw.speakers && typeof raw.speakers === 'object') for (const [k, v] of Object.entries(raw.speakers)) { const n = clipName(v?.n); if (n && typeof v?.h === 'string') speakers[k] = { n, h: v.h }; } } }
  let hidden = readJson(ctx.storage, HIDE_KEY) === true;
  const save = () => { if (roster.length || Object.keys(speakers).length) writeJson(ctx.storage, NAMES_KEY, { roster, speakers }); else remove(ctx.storage, NAMES_KEY); };
  // データの初期化（FR-018）で名簿と話者タグの名前を消す。export は常に undefined（grp.session・セッションファイルに含めない）
  ctx.registerPersist?.('boardNames', { export: () => undefined, reset: () => { roster = []; speakers = {}; remove(ctx.storage, NAMES_KEY); } });

  const textOf = (u) => (typeof u.rawText === 'string' ? u.rawText : u.text);
  // .vtt の取込（一括・再生取込）が、追加した発話と cue の話者タグを渡す
  api.recordSpeakers = (utterances, names) => {
    let changed = false;
    (utterances ?? []).forEach((u, i) => { const n = clipName(names?.[i]); if (u?.id && n) { speakers[u.id] = { n, h: textHash(textOf(u)) }; changed = true; } });
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
    roster = parseRoster(v); save(); ctx.change(() => {});
    return { ok: true, participants: [...roster] };
  };
  const baseSetTitle = api.setTitleInfo;
  if (baseSetTitle) {
    api.setTitleInfo = (info) => {
      if (!info || typeof info !== 'object' || Array.isArray(info) || !('participants' in info)) return baseSetTitle(info);
      const { participants, ...rest } = info;
      const r = api.setParticipants(participants);
      if (!r.ok) return r;
      return Object.keys(rest).length ? baseSetTitle(rest) : { ok: true };
    };
  }
  // AC-680: 名前を表示しない（端末ごと。既定はオフ＝表示する）
  api.getShowNames = () => !hidden;
  api.setShowNames = (v) => { if (typeof v !== 'boolean') return { ok: false, reason: 'invalid' }; hidden = !v; writeJson(ctx.storage, HIDE_KEY, hidden); ctx.change(() => {}); return { ok: true, show: v }; };
  api.getHideNames = () => hidden;
  api.setHideNames = (v) => (typeof v === 'boolean' ? api.setShowNames(!v) : { ok: false, reason: 'invalid' });
  // 名前の全体（表示の切り替えによらない。簡易マスキングの対象語）
  const allNames = () => memberNames(roster, state.utterances.map((u) => speakerOf(u.id)));
  api.getPersonNames = () => allNames();
  // 会議ボードの配置（board.js）が使う名前。名前を表示しないときは null（汎用の人物だけ）
  api.getBoardNames = () => (hidden ? null : { members: allNames(), speakerOf });

  // ---- テキスト一覧（NFR-A11Y-001。AC-668 (d)）: 図に名前が載っている間だけ、同じ名前を文字で ----
  const baseOutline = api.renderOutline;
  if (baseOutline) {
    api.renderOutline = (...a) => {
      const html = baseOutline(...a);
      const m = api.isBoardActive?.() && !hidden ? api.getDiagramLayout?.()?.board : null;
      return m ? boardNamesOutline(html, m, tx()) : html;
    };
  }
  // ---- ［設定］の切り替え（AC-680） ----
  const baseSetField = api.setSettingsField;
  api.setSettingsField = (id, value) => (id === 'names.hide' ? api.setHideNames(value) : baseSetField ? baseSetField(id, value) : { ok: false, reason: 'not_found' });
  const baseDialog = api.getSettingsDialog;
  if (baseDialog) api.getSettingsDialog = () => { const d = baseDialog(); return d ? { ...d, fields: [...d.fields, { id: 'names.hide', label: tx().hide, value: hidden, role: 'switch' }] } : d; };
  const baseView = api.getSettingsView;
  if (baseView) api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: 'names.hide', visible: true }] }; };
  api.getBoardNamesLabels = () => ({ roster: tx().roster, hide: tx().hide });
  // 名簿の入力欄（タイトル欄と同じ場所。FR-036）
  const baseSpec = api.getMeetingFormSpec;
  if (baseSpec) api.getMeetingFormSpec = () => { const s = baseSpec(); return { ...s, fields: [...s.fields, { id: 'participants', label: tx().roster, kind: 'participants' }] }; };
  const baseValues = api.getMeetingFormValues;
  if (baseValues) api.getMeetingFormValues = () => ({ ...baseValues(), participants: roster.join('\n') });
}

// テキスト一覧への追記: 「参加メンバー: 名前、…」の 1 行と、各ステップの最初の要点の行に「（発言: 名前）」
export function boardNamesOutline(html, board, t) {
  const members = []; const said = [];
  for (const s of board.sections ?? []) {
    for (const el of s.elements ?? []) {
      if (el.part === 'person' && el.member && el.name) members.push(el.name);
      if (el.speaker && el.name && el.firstPointId) said.push([el.firstPointId, el.name]);
    }
  }
  let out = String(html);
  for (const [pid, name] of said) {
    const at = out.indexOf(`<li data-point-id="${escapeHtml(pid)}"`);
    if (at < 0) continue;
    const end = out.indexOf('</li>', at);
    if (end < 0) continue;
    const [o, c] = t.paren ?? ['（', '）'];
    out = `${out.slice(0, end)} <span class="outline-speaker" data-speaker-of="${escapeHtml(pid)}">${o}${escapeHtml(t.said)}: ${escapeHtml(name)}${c}</span>${out.slice(end)}`;
  }
  const line = members.length ? `<p class="outline-members" data-board-members>${escapeHtml(t.members)}: ${members.map(escapeHtml).join('、')}</p>` : '';
  return line + out;
}
