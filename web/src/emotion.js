// FR-004 AC-011: 感情・様子を示す語 → 絵記号。日本語・英語の組み込み辞書（外部通信なし・決定的）。
// 絵記号は SVG の図形で描く（フォント依存の絵文字を使わない）。shape は diagram.js が描き分ける。

export const EMOTIONS = [
  { id: 'confused', shape: 'swirl', ja: ['モヤモヤ', 'もやもや', '混乱', '迷っ', '分からな', 'わからな'], en: ['confused', 'unclear', 'puzzled', 'lost'] },
  { id: 'trouble', shape: 'sweat', ja: ['困った', '困って', '困る', '大変', 'つらい', '辛い'], en: ['trouble', 'struggle', 'difficult', 'stuck'] },
  { id: 'anxious', shape: 'cloud', ja: ['不安', '心配', '怖い', '焦'], en: ['anxious', 'worried', 'afraid', 'nervous'] },
  { id: 'angry', shape: 'bolt', ja: ['腹が立', 'イライラ', 'いらいら', '怒'], en: ['angry', 'annoyed', 'frustrated'] },
  { id: 'happy', shape: 'smile', ja: ['嬉しい', 'うれしい', '楽しい', '楽しみ', '最高', 'ワクワク', 'わくわく'], en: ['happy', 'glad', 'excited', 'delighted'] },
  { id: 'idea', shape: 'bulb', ja: ['ひらめ', '閃', 'アイデア', '思いつ'], en: ['idea', 'insight', 'realized'] },
  { id: 'surprised', shape: 'burst', ja: ['驚', 'びっくり', 'ビックリ'], en: ['surprised', 'amazed', 'shocked'] },
  { id: 'tired', shape: 'drop', ja: ['疲れ', 'しんどい', '眠い'], en: ['tired', 'exhausted', 'sleepy'] },
];

// 文字列から、含まれる感情語を出現順に重複なしで返す。{ id, shape, word }
export function detectEmotions(text) {
  const s = String(text ?? '');
  const lower = s.toLowerCase();
  const hits = [];
  for (const e of EMOTIONS) {
    let best = null;
    for (const w of e.ja) { const i = s.indexOf(w); if (i >= 0 && (!best || i < best.at)) best = { at: i, word: w }; }
    for (const w of e.en) {
      const re = new RegExp(`\\b${w}`, 'i');
      const m = re.exec(lower);
      if (m && (!best || m.index < best.at)) best = { at: m.index, word: s.substr(m.index, w.length) };
    }
    if (best) hits.push({ at: best.at, id: e.id, shape: e.shape, word: best.word });
  }
  return hits.sort((a, b) => a.at - b.at).map(({ id, shape, word }) => ({ id, shape, word }));
}

// シーン全体（見出し・要点）の感情語。同じ感情は 1 つにまとめる。
export function sceneEmotions(scene) {
  const seen = new Map();
  for (const t of [scene.heading, ...scene.points.map((p) => p.text)]) {
    for (const h of detectEmotions(t)) if (!seen.has(h.id)) seen.set(h.id, h);
  }
  return [...seen.values()];
}
