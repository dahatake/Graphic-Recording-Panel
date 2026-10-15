// FR-028 会話の内容からのレイアウト型の自動選択（共通部品「レイアウト型レジストリ」の setAutoLayoutSelector に登録する）。
// DOM・外部通信に依存しない決定的な規則。優先順位: 比喩テンプレート ＞ 区画 ＞ 話者に依存する規則 ＞ 順序の語のタイムライン ＞ 流れのない話の発散。
// 話者に依存する規則（吹き出し・発散・話者 1 人のタイムライン。AC-144）は話者の識別が対象外（Q-006）のため判定しない。
export const MIN_ZONES = 2; // PARAM-016
export const MAX_ZONES = 4; // PARAM-017

// 組み込みの辞書（後から足せる）。日本語は部分一致、英語は語として一致。
export const VISION_WORDS = { ja: ['ビジョン', 'ゴール', '目標', '道のり', 'ロードマップ'], en: ['vision', 'goal', 'roadmap', 'journey'] };
export const ORDER_WORDS = { ja: ['まず', '次に', 'それから', 'その後', '最後に'], en: ['first', 'then', 'next', 'finally'] };

const hasWord = (text, dict) => dict.ja.some((w) => text.includes(w))
  || dict.en.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i').test(text));

// 各トピックのシーンがシーン列の中で連続した 1 つの区間か（ほかのトピックと交互にならない）。
function contiguous(topics, scenes) {
  const index = new Map(scenes.map((s, i) => [s.id, i]));
  return topics.every((tp) => {
    const is = tp.sceneIds.map((id) => index.get(id)).filter((i) => i != null).sort((a, b) => a - b);
    return is.every((v, k) => k === 0 || v === is[k - 1] + 1);
  });
}

// input: { scenes, utterances, topics } → 型 ID の配列（1 つ以上・重複なし。先頭が配置を決める）
export function selectLayoutTypes({ scenes = [], utterances = [], topics = [] } = {}) {
  const text = [
    ...utterances.map((u) => u?.text ?? ''),
    ...scenes.flatMap((s) => s.points.map((p) => p.text)),
  ].join('\n');
  const out = [];
  if (hasWord(text, VISION_WORDS)) out.push('metaphor');
  if (topics.length >= MIN_ZONES && topics.length <= MAX_ZONES && contiguous(topics, scenes)) out.push('zone');
  if (hasWord(text, ORDER_WORDS)) out.push('timeline');
  if (!out.length) out.push('diverge'); // 流れのない話（タイムラインは選ばない。D-05）
  return out;
}

// アプリ組立の拡張（modules）。settingsModule の後に足す。
export function autoLayoutModule(ctx) {
  ctx.api.setAutoLayoutSelector(selectLayoutTypes);
}
