// FR-089 AC-524・AC-525・AC-526・AC-527・AC-532・AC-533: 生成 AI を使う 1 回の会議の予算（既定 10,000 円。PARAM-101）と単価。
// - ［設定］画面に予算と単価（入力・出力。既定 400 円・1,600 円／100 万トークン。PARAM-102・103）を表示し、0 以上の整数だけ受け付けてブラウザへ保存する
//   （不正値は理由を示して直前の値を保つ）。
// - 保存するのは予算・単価の数値（grp.budget。キー・トークンは保存しない。NFR-SEC-006）と、使用額（grp.budget.usage。セッションの保存データ。AC-527）。
// - 使用額（推定）は中継の応答の usage（トークン数）× 単価を加算する。usage が無い応答は送受信の文字数から概算し「概算」と表示する。
//   再読込後も保たれ、データの初期化（FR-018）・新しいセッションの開始でゼロに戻り、予算・単価は保たれる。
// - 使用額が予算の 80%（PARAM-105）で警告 budget.near（呼び出しは続く）。
// - 使用額が予算に達したとき（予算 0 円は常に）、/api/llm/*（status を除く）の呼び出しは行わない（図の描画は生成 AI なしで続く）。
//   予算を使用額より大きくする、または新しいセッションを始めるまで再開せず、警告を出し続ける。
import { readJson, writeJson } from './persist.js';

export const BUDGET_KEY = 'grp.budget';
export const BUDGET_DEFAULT_YEN = 10000; // PARAM-101
export const USAGE_KEY = 'grp.budget.usage'; // AC-527: 使用額（セッションの保存データ。予算・単価の grp.budget とは別）
export const WARN_PCT = 80; // PARAM-105
export const PRICE_IN_DEFAULT = 400; // PARAM-102（円／100 万トークン）
export const PRICE_OUT_DEFAULT = 1600; // PARAM-103（円／100 万トークン）
export const isValidBudget = (v) => Number.isSafeInteger(v) && v >= 0;
const toNumber = (value) => (typeof value === 'string' ? (value.trim() !== '' ? Number(value) : NaN) : value);

const STRINGS = {
  ja: {
    'budget.label': '会議の予算', 'budget.unit': '円', 'budget.text': '{n} 円（使用額 {u} 円）',
    'budget.priceIn': '入力単価', 'budget.priceOut': '出力単価', 'budget.priceUnit': '円/100万トークン',
    'budget.priceInText': '入力 {p} 円（100 万トークンあたり）', 'budget.priceOutText': '出力 {p} 円（100 万トークンあたり）',
    'budget.priceChanged': '生成 AI の単価を変更しました', 'budget.priceInvalid': '単価は 0 以上の整数（円／100 万トークン）で入力してください。直前の値を保っています',
    'budget.status': '生成 AI の使用額（推定）: {u} 円／予算 {n} 円',
    'budget.reached': '生成 AI の予算に達したため、呼び出しを止めました。図の描画（生成 AI なし）は続きます。予算を引き上げるか、新しいセッションを始めると再開します',
    'budget.near': '生成 AI の使用額が予算の 80% に達しました。予算に達すると呼び出しを止めます', 'budget.estimated': '（概算）',
    'budget.zero': '予算が 0 円のため、生成 AI は使えません。図の描画（生成 AI なし）は続きます',
    'budget.changed': '1 回の会議の予算を変更しました', 'budget.invalid': '1 回の会議の予算は 0 以上の整数（円）で入力してください。直前の値を保っています',
  },
  en: {
    'budget.label': 'Budget', 'budget.unit': 'JPY', 'budget.text': '{n} JPY (used {u} JPY)',
    'budget.priceIn': 'Price in', 'budget.priceOut': 'Price out', 'budget.priceUnit': 'JPY/1M tokens',
    'budget.priceInText': 'Input {p} JPY (per 1M tokens)', 'budget.priceOutText': 'Output {p} JPY (per 1M tokens)',
    'budget.priceChanged': 'Changed the generative AI prices', 'budget.priceInvalid': 'Enter each price as an integer of 0 or more (JPY per 1M tokens). The previous value is kept',
    'budget.status': 'Generative AI usage (estimate): {u} JPY / budget {n} JPY',
    'budget.reached': 'The generative AI budget was reached, so calls are stopped. Drawing without generative AI continues. Raise the budget or start a new session to resume',
    'budget.near': 'Generative AI usage reached 80% of the budget. Calls stop when the budget is reached', 'budget.estimated': ' (estimated)',
    'budget.zero': 'The budget is 0 JPY, so generative AI is not used. Drawing without generative AI continues',
    'budget.changed': 'Changed the budget per meeting', 'budget.invalid': 'Enter the budget per meeting as an integer of 0 or more (JPY). The previous value is kept',
  },
};

export function budgetModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;
  ctx.i18n.addStrings(STRINGS);

  let yen = BUDGET_DEFAULT_YEN;
  let priceIn = PRICE_IN_DEFAULT;
  let priceOut = PRICE_OUT_DEFAULT;
  {
    const raw = readJson(ctx.storage, BUDGET_KEY);
    if (raw && isValidBudget(raw.budgetYen)) yen = raw.budgetYen;
    if (raw && isValidBudget(raw.priceIn)) priceIn = raw.priceIn;
    if (raw && isValidBudget(raw.priceOut)) priceOut = raw.priceOut;
  }
  // 使用額はセッションの保存データ（grp.session とは別キー。データの初期化・新しい会議でゼロ）に保ち、再読込後も引き継ぐ（AC-527）
  let used = 0;
  let estimated = false; // 使用額に概算（usage の無い応答）を含む
  {
    const raw = readJson(ctx.storage, USAGE_KEY);
    if (raw && Number.isFinite(raw.usedYen) && raw.usedYen > 0) { used = raw.usedYen; estimated = raw.estimated === true; }
  }
  let drafts = {};
  const save = () => writeJson(ctx.storage, BUDGET_KEY, { budgetYen: yen, priceIn, priceOut });
  const saveUsage = () => writeJson(ctx.storage, USAGE_KEY, { usedYen: used, estimated });

  const text = () => t('budget.text').replace('{n}', String(yen)).replace('{u}', String(used));
  api.getBudget = () => ({ yen, default: BUDGET_DEFAULT_YEN, usedYen: used });
  api.getBudgetUsage = () => ({ yen: used });
  api.getPricing = () => ({ inputPer1M: priceIn, outputPer1M: priceOut, default: { inputPer1M: PRICE_IN_DEFAULT, outputPer1M: PRICE_OUT_DEFAULT } });
  // 使用額の加算（生成 AI の呼び出し側が使う。負・非数は無視）
  api.addBudgetUsage = (amount) => { if (Number.isFinite(amount) && amount > 0)   { used += amount; saveUsage(); ctx.emit('change', api); } return used; };
    const resetUsage = () => { if (used !== 0 || estimated) { used = 0; estimated = false; saveUsage(); ctx.emit('change', api); } };

  let msgKey = null;
  const say = (key, msg) => { msgKey = key; ctx.change((s) => { s.message = { key, text: msg }; }); };
  ctx.on('lang', () => { if (msgKey && state.message?.key === msgKey) ctx.change((s) => { s.message.text = t(msgKey) + (msgKey === 'budget.changed' ? `: ${text()}` : ''); }); });

  api.setBudget = (value) => {
    const n = toNumber(value);
    if (!isValidBudget(n)) { delete drafts['budget.yen']; say('budget.invalid', t('budget.invalid')); return { ok: false, reason: 'invalid' }; }
    delete drafts['budget.yen'];
    if (n !== yen) { yen = n; save(); }
    say('budget.changed', `${t('budget.changed')}: ${text()}`);
    ctx.emit('change', api);
    return { ok: true };
  };
  api.setPricing = (p = {}) => {
    const i = toNumber(p.inputPer1M ?? priceIn); const o = toNumber(p.outputPer1M ?? priceOut);
    delete drafts['budget.priceIn']; delete drafts['budget.priceOut'];
    if (!isValidBudget(i) || !isValidBudget(o)) { say('budget.priceInvalid', t('budget.priceInvalid')); return { ok: false, reason: 'invalid' }; }
    if (i !== priceIn || o !== priceOut) { priceIn = i; priceOut = o; save(); }
    say('budget.priceChanged', t('budget.priceChanged'));
    ctx.emit('change', api);
    return { ok: true };
  };

  // ---- 使用額の加算（AC-526）: 中継の応答の usage（入力・出力のトークン数）× 単価 ----
  // usage の無い応答は、送受信の文字数（1 文字 = 1 トークンとして多めに見積もる）から概算し、「概算」を表示する
  const tokens = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  ctx.on('llm:result', (e) => {
    const u = e?.body?.usage;
    if (!u || typeof u !== 'object') {
      let outChars = 0; try { outChars = [...JSON.stringify(e?.body ?? {})].length; } catch { /* 概算できない分は 0 */ }
      estimated = true;
      api.addBudgetUsage((tokens(e?.sentChars) * priceIn + outChars * priceOut) / 1_000_000);
      return;
    }
    api.addBudgetUsage((tokens(u.inputTokens) * priceIn + tokens(u.outputTokens) * priceOut) / 1_000_000);
  });

  // ---- 停止（AC-526・AC-532・AC-533）: 使用額 >= 予算（0 円は常に）なら LLM 向けの要求を出さない ----
  const blocked = () => used >= yen;
  const baseCall = api.llmCall;
  if (baseCall) api.llmCall = (path, body) => (blocked() ? Promise.resolve({ ok: false, reason: 'budget' }) : baseCall(path, body));
  const llmOn = () => api.getLlmState?.().enabled === true;
  api.getBudgetWarning = () => {
    if (!llmOn()) return null;
    if (!blocked()) {
      // 予算の PARAM-105（80%）に達したら警告（呼び出しは止めない）
      if (used * 100 >= yen * WARN_PCT) return { key: 'budget.near', text: t('budget.near') };
      return null;
    }
    const key = yen === 0 ? 'budget.zero' : 'budget.reached';
    return { key, text: t(key) };
  };
  api.getBudgetStatus = () => ({
    text: t('budget.status').replace('{u}', String(Math.round(used * 100) / 100)).replace('{n}', String(yen)) + (estimated ? t('budget.estimated') : ''),
    usedYen: used, budgetYen: yen, estimated,
  });

  // 新しいセッションの開始（準備中・停止からの開始）と、データの初期化で使用額をゼロに戻す（予算・単価は保つ）
  ctx.on('session:start', resetUsage);
  const baseAction = api.dialogAction;
  if (baseAction) {
    api.dialogAction = (action) => {
      const kind = api.getDialog?.()?.kind;
      const r = baseAction(action);
      if (action === 'confirm' && kind === 'reset') resetUsage();
      return r;
    };
  }

  // ---- ［設定］画面の項目（予算・入力単価・出力単価） ----
  const FIELDS = ['budget.yen', 'budget.priceIn', 'budget.priceOut'];
  const baseDialog = api.getSettingsDialog;
  const num = (id, label, value, txt, unit) => ({
    id, label, value, text: txt, min: 0, step: 1,
    role: 'spinbutton', focusable: true, input: { type: 'number', value: drafts[id] ?? String(value), inputmode: 'numeric' }, unit,
  });
  const fields = () => [
    num('budget.yen', t('budget.label'), yen, text(), t('budget.unit')),
    num('budget.priceIn', t('budget.priceIn'), priceIn, t('budget.priceInText').replace('{p}', String(priceIn)), t('budget.priceUnit')),
    num('budget.priceOut', t('budget.priceOut'), priceOut, t('budget.priceOutText').replace('{p}', String(priceOut)), t('budget.priceUnit')),
  ];
  api.getSettingsDialog = () => { const d = baseDialog(); return d ? { ...d, fields: [...d.fields, ...fields()] } : null; };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, ...FIELDS.map((id) => ({ id, visible: true }))] }; };
  const baseDraft = api.setSettingsFieldDraft;
  api.setSettingsFieldDraft = (id, txt) => {
    if (!FIELDS.includes(id)) return baseDraft ? baseDraft(id, txt) : { ok: false, reason: 'not_found' };
    drafts[id] = String(txt ?? ''); ctx.emit('change', api); return { ok: true };
  };
  ctx.on('change', () => { if (!baseDialog()) drafts = {}; });
}
