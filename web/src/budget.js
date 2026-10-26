// FR-089 AC-524・AC-525・AC-527: 生成 AI を使う 1 回の会議の予算（既定 10,000 円。PARAM-101）。
// - ［設定］画面に表示し、0 以上の整数だけ受け付けてブラウザへ保存する（不正値は理由を示して直前の値を保つ）。
// - 保存するのは予算の数値だけ。キー・トークンは保存しない（NFR-SEC-006）。
// - 使用額（推定）は会議ごとのメモリ上の値。データの初期化（FR-018）・新しいセッションの開始でゼロに戻り、予算は保たれる。
//   （使用額の推定・予算到達時の停止 = AC-526 は Q-035 の回答待ちで、ここでは扱わない）
import { readJson, writeJson } from './persist.js';

export const BUDGET_KEY = 'grp.budget';
export const BUDGET_DEFAULT_YEN = 10000; // PARAM-101
export const isValidBudget = (v) => Number.isSafeInteger(v) && v >= 0;

const STRINGS = {
  ja: {
    'budget.label': '会議の予算', 'budget.unit': '円', 'budget.text': '{n} 円（使用額 {u} 円）',
    'budget.changed': '1 回の会議の予算を変更しました', 'budget.invalid': '1 回の会議の予算は 0 以上の整数（円）で入力してください。直前の値を保っています',
  },
  en: {
    'budget.label': 'Budget', 'budget.unit': 'JPY', 'budget.text': '{n} JPY (used {u} JPY)',
    'budget.changed': 'Changed the budget per meeting', 'budget.invalid': 'Enter the budget per meeting as an integer of 0 or more (JPY). The previous value is kept',
  },
};

export function budgetModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;
  ctx.i18n.addStrings(STRINGS);

  let yen = BUDGET_DEFAULT_YEN;
  { const raw = readJson(ctx.storage, BUDGET_KEY); if (raw && isValidBudget(raw.budgetYen)) yen = raw.budgetYen; }
  let used = 0;
  let draft = null;

  const text = () => t('budget.text').replace('{n}', String(yen)).replace('{u}', String(used));
  api.getBudget = () => ({ yen, default: BUDGET_DEFAULT_YEN, usedYen: used });
  api.getBudgetUsage = () => ({ yen: used });
  // 使用額の加算（生成 AI の呼び出し側が使う。負・非数は無視）
  api.addBudgetUsage = (amount) => { if (Number.isFinite(amount) && amount > 0) { used += amount; ctx.emit('change', api); } return used; };
  const resetUsage = () => { if (used !== 0) { used = 0; ctx.emit('change', api); } };

  let msgKey = null;
  const say = (key, msg) => { msgKey = key; ctx.change((s) => { s.message = { key, text: msg }; }); };
  ctx.on('lang', () => { if (msgKey && state.message?.key === msgKey) ctx.change((s) => { s.message.text = t(msgKey) + (msgKey === 'budget.changed' ? `: ${text()}` : ''); }); });

  api.setBudget = (value) => {
    const n = typeof value === 'string' ? (value.trim() !== '' ? Number(value) : NaN) : value;
    if (!isValidBudget(n)) { draft = null; say('budget.invalid', t('budget.invalid')); return { ok: false, reason: 'invalid' }; }
    draft = null;
    if (n !== yen) { yen = n; writeJson(ctx.storage, BUDGET_KEY, { budgetYen: yen }); }
    say('budget.changed', `${t('budget.changed')}: ${text()}`);
    return { ok: true };
  };

  // 新しいセッションの開始（準備中・停止からの開始）と、データの初期化で使用額をゼロに戻す（予算は保つ）
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

  // ---- ［設定］画面の項目 ----
  const FIELD_ID = 'budget.yen';
  const baseDialog = api.getSettingsDialog;
  const field = () => ({
    id: FIELD_ID, label: t('budget.label'), value: yen, text: text(), min: 0, step: 1,
    role: 'spinbutton', focusable: true, input: { type: 'number', value: draft ?? String(yen), inputmode: 'numeric' }, unit: t('budget.unit'),
  });
  api.getSettingsDialog = () => { const d = baseDialog(); return d ? { ...d, fields: [...d.fields, field()] } : null; };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: FIELD_ID, visible: true }] }; };
  const baseDraft = api.setSettingsFieldDraft;
  api.setSettingsFieldDraft = (id, txt) => {
    if (id !== FIELD_ID) return baseDraft ? baseDraft(id, txt) : { ok: false, reason: 'not_found' };
    draft = String(txt ?? ''); ctx.emit('change', api); return { ok: true };
  };
  ctx.on('change', () => { if (!baseDialog()) draft = null; });
}
