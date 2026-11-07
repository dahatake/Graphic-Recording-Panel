// バッチモード・入力モードの System Test の共通部品（契約: tests/system/CONTRACT-BATCH.md）。
// 期待値は受入基準（FR-117・FR-118・FR-119・AC-054・AC-523）だけから決める。中継サーバー（LLM）はモックで、実 Foundry は呼ばない。
import assert from 'node:assert/strict';
import { newApp } from './helpers.js';

export const CJK_RE = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;
// 全角 1・半角 0.5 の重み（PARAM-011 は 6、PARAM-170 は 40）
export const weight = (s) => [...String(s)].reduce((n, ch) => n + (CJK_RE.test(ch) ? 1 : 0.5), 0);
export const P = { LABEL_MAX: 6 /* PARAM-011 */, DESC_MAX: 40 /* PARAM-170 */, SINGLE_SEC: 3 /* PARAM-158 */, BUSY_SEC: 1 /* PARAM-014 */, LLM_TIMEOUT_SEC: 30 /* PARAM-069 */, MAX_FILE_BYTES: 1 * 1024 * 1024 /* PARAM-003 */, NARROW: 640 /* PARAM-006 */, CONTRAST: 4.5 /* PARAM-007 */, TRANSITION_MS: 300 /* PARAM-162 */ };

export const toFile = (name, text, type) => ({ name, type: type ?? (name.endsWith('.vtt') ? 'text/vtt' : 'text/plain'), size: Buffer.byteLength(text), text });
export const MEETING_LINES = ['予算の見直しが必要です', 'コストが高くて困った', '来月のリリース計画を決める', '担当者の割り当てを確認する', '顧客への説明資料を準備する', '次回の会議は金曜日に開く'];
export const TXT = toFile('meeting.txt', `${MEETING_LINES.join('\n')}\n`);
const cue = (i, body) => `00:00:${String(i * 2 + 1).padStart(2, '0')}.000 --> 00:00:${String(i * 2 + 2).padStart(2, '0')}.000\n<v 話者${i % 2}>${body}</v>\n`;
export const VTT = toFile('meeting.vtt', `WEBVTT\n\n${MEETING_LINES.map((l, i) => cue(i, l)).join('\n')}`);

// 取込上限サイズ（PARAM-003＝1 MB）ちょうどの .txt（1 行 1 発話。最後の行を ASCII で埋めてバイト数を合わせる）
export function maxSizeTxt() {
  const line = '議題の論点を確認して担当を決める\n';
  const n = Math.floor(P.MAX_FILE_BYTES / Buffer.byteLength(line)) - 1;
  let text = line.repeat(n);
  text += 'x'.repeat(P.MAX_FILE_BYTES - Buffer.byteLength(text));
  assert.equal(Buffer.byteLength(text), P.MAX_FILE_BYTES);
  return toFile('max.txt', text);
}

const CONFIGURED = { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' };
// 中継サーバーのモック。mode: 'ok'|'fail'|'defer'（release() まで応答を保留）|'manual'（要求ごとに respond() で応答。届いた順）。応答は FR-063 の形式。
// onExtract(req): /api/llm/extract の要求が端末から出た時点（応答の前）に同期で呼ぶ（AC-692 の観測点）。
export function makeRelay({ mode = 'ok', answer, onExtract } = {}) {
  const log = [];
  const state = { mode };
  const pending = [];
  let release; const gate = new Promise((r) => { release = r; });
  const relay = async (req) => {
    log.push({ path: req.path, body: req.body });
    if (req.path.startsWith('/api/llm/status')) return { status: 200, body: CONFIGURED };
    if (req.path === '/api/llm/extract') {
      if (onExtract) onExtract(req);
      if (state.mode === 'manual') return new Promise((res) => pending.push({ req, res }));
      if (state.mode === 'defer') await gate;
      if (state.mode === 'fail') return { status: 500, body: { error: 'mock' } };
      return { status: 200, body: typeof answer === 'function' ? answer(req) : (answer ?? { objects: [], people: [], emotions: [], metaphors: [] }) };
    }
    return { status: 404, body: {} };
  };
  const llmReqs = () => log.filter((r) => r.path.startsWith('/api/llm/') && !r.path.startsWith('/api/llm/status'));
  // manual: 未応答の要求（届いた順）。respond(outcome) は最も古い未応答の要求に応答する。outcome: { status, body }
  const open = () => pending.filter((p) => !p.done);
  const respond = (outcome) => { const p = open()[0]; assert.ok(p, '応答する未応答の要求がある'); p.done = true; p.res(outcome); return p.req; };
  // 応答しないまま「打ち切られた」扱いにする（アプリ側の PARAM-069 のタイムアウトを試すとき）。後から late(outcome) で遅れて応答できる。
  const abandon = () => { const p = open()[0]; assert.ok(p, '打ち切る未応答の要求がある'); p.done = true; return p; };
  // 未応答の要求が n 件になるまで（実時間で ms まで）待つ。固定の待ちではなく条件で待つ。
  const waitOpen = async (n = 1, ms = 5000) => {
    const t0 = Date.now();
    while (open().length < n) {
      if (Date.now() - t0 > ms) return false;
      await new Promise((r) => setTimeout(r, 1));
    }
    return true;
  };
  return { relay, log, llmReqs, release, state, pending, open, respond, abandon, waitOpen };
}

// 中継サーバーの実プロセス（relay-util.js の startRelay）へ、画面の options.relay を同一オリジンの HTTP 要求でつなぐ。
// 端末→中継の要求（method・path・body）はすべて log に残す（AC-688 (a) の境界の観測点）。
export function bridgeRelay(relayProc, rawRequest) {
  const log = [];
  const relay = async ({ method = 'GET', path: p, body }) => {
    log.push({ method, path: p, body });
    const headers = { host: `127.0.0.1:${relayProc.port}`, origin: relayProc.origin };
    let data = null;
    if (body !== undefined) { data = typeof body === 'string' ? body : JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const r = await rawRequest(relayProc.port, { method, path: p, headers, body: data, timeout: 60000 });
    let parsed = r.text;
    try { parsed = JSON.parse(r.text); } catch { /* 文字列のまま */ }
    return { status: r.status, body: parsed };
  };
  const llmReqs = () => log.filter((r) => r.path.startsWith('/api/llm/') && !r.path.startsWith('/api/llm/status'));
  return { relay, log, llmReqs };
}

// シーンの開始時刻を PARAM より十分に離した .vtt（各キューが別のシーンになる。複数要求のバッチ実行に使う）
export function sceneSplitVtt(n = 3, gapSec = 300) {
  const ts = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000`;
  const body = Array.from({ length: n }, (_, i) => `${ts(i * gapSec + 1)} --> ${ts(i * gapSec + 3)}\n<v 話者${i % 2}>${MEETING_LINES[i % MEETING_LINES.length]}</v>\n`).join('\n');
  return toFile('scenes.vtt', `WEBVTT\n\n${body}`);
}

export async function bootApp(relayHelper, over = {}) {
  const o = { ...over, options: { ...(over.options || {}), ...(relayHelper ? { relay: relayHelper.relay } : {}) } };
  return newApp(o);
}
export async function enableLlm(app) {
  const r = await app.requestLlmEnable();
  assert.equal(r.ok, true, '設定済みなら同意の表示へ進む');
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmState().enabled, true, '同意後は有効');
}
export const batchStyleItems = (app) => app.getCommandBar().items.filter((i) => i.group === 'batchStyle');
export const modeItems = (app) => app.getCommandBar().items.filter((i) => i.group === 'inputMode');
export const snapshot = (app) => JSON.stringify({ scenes: app.getState().scenes, svg: app.renderSvg(), refresh: app.getLiveRefresh().count });
export const finals = (app) => app.getTranscript().finals.map((f) => f.text);
