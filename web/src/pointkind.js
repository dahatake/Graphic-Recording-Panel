// FR-091 AC-577: 進行の段階（発散・分類・評価・決定）と、種類の語に当てはまらない要点の種類。純関数。
// 種類の語に当てはまる要点は段階によらず従来どおり（classifyPointRule）。当てはまらない要点（AC-427 では「補足」）だけ、
// 追加した時点の段階で決める: 発散 = アイデア、分類 = 補足、評価 = 課題、決定 = 補足（印「決定の段階」。「結論」にしない。AC-231）。
// どの要点もちょうど 1 つの種類に分類される。
import { classifyPointRule } from './diagram.js';

export const PHASES = ['diverge', 'classify', 'evaluate', 'decide'];
export const DEFAULT_PHASE = 'diverge';
export const PHASE_KIND = Object.freeze({ diverge: 'idea', classify: 'note', evaluate: 'issue', decide: 'note' });
export const isPhase = (p) => PHASES.includes(p);

// text: 要点の文。opts.phase: 段階（省略・不正は種類の既定の補足）
export function classifyKind(text, { phase } = {}) {
  const rule = classifyPointRule(text);
  if (rule) return rule;
  return PHASE_KIND[phase] ?? 'note';
}
// 「決定の段階」の印を付けるか（種類の語に当てはまらない要点を、段階が決定のときに追加した場合）
export const hasDecisionMark = (text, { phase } = {}) => phase === 'decide' && classifyPointRule(text) == null;
