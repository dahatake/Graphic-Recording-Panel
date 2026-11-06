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
// 中継サーバーのモック。mode: 'ok'|'fail'|'defer'（release() まで応答を保留）。応答は FR-063 の形式。
export function makeRelay({ mode = 'ok', answer } = {}) {
  const log = [];
  const state = { mode };
  let release; const gate = new Promise((r) => { release = r; });
  const relay = async (req) => {
    log.push({ path: req.path, body: req.body });
    if (req.path.startsWith('/api/llm/status')) return { status: 200, body: CONFIGURED };
    if (req.path === '/api/llm/extract') {
      if (state.mode === 'defer') await gate;
      if (state.mode === 'fail') return { status: 500, body: { error: 'mock' } };
      return { status: 200, body: typeof answer === 'function' ? answer(req) : (answer ?? { objects: [], people: [], emotions: [], metaphors: [] }) };
    }
    return { status: 404, body: {} };
  };
  const llmReqs = () => log.filter((r) => r.path.startsWith('/api/llm/') && !r.path.startsWith('/api/llm/status'));
  return { relay, log, llmReqs, release, state };
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
export const snapshot = (app) => JSON.stringify({ scenes: app.getState().scenes, svg: app.renderSvg(), outline: app.renderOutline(), refresh: app.getLiveRefresh().count });
export const finals = (app) => app.getTranscript().finals.map((f) => f.text);
