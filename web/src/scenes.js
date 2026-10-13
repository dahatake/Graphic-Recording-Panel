// 発話 → シーン・要点の最小の組立（純粋関数）。FR-003 の本格的な抽出は後続の項目がこのモジュールを拡張する。
// 取り決め（CONTRACT）: 40 文字以下の発話は、トリム済みの文字列がちょうど 1 件の要点になる。
// 1 シーンに要点が 2 件以上あれば関係線が 1 件以上。

export const POINT_MAX = 40;
export const HEADING_MAX = 24;

// 長い文は読点で区切って POINT_MAX 以内の塊にする（語句はそのまま。決定的）。
function chunk(sentence) {
  const chars = [...sentence];
  if (chars.length <= POINT_MAX) return [sentence];
  const clauses = sentence.split(/(?<=[、，,])/u).filter(Boolean);
  const out = []; let cur = '';
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const c of clauses) {
    if ([...c].length > POINT_MAX) { flush(); const cs = [...c]; for (let i = 0; i < cs.length; i += POINT_MAX) out.push(cs.slice(i, i + POINT_MAX).join('').trim()); continue; }
    if ([...(cur + c)].length > POINT_MAX) flush();
    cur += c;
  }
  flush();
  return out.filter(Boolean);
}

export function extractPoints(text) {
  const t = String(text).trim();
  if (!t) return [];
  if ([...t].length <= POINT_MAX && !/\n/.test(t)) return [t];
  const parts = t.split(/(?<=[。．.!?！？])\s*|\s*\n\s*/u).map((s) => s.trim()).filter(Boolean);
  return parts.flatMap(chunk);
}

export function makeHeading(text) {
  const chars = [...String(text).trim()];
  return chars.length <= HEADING_MAX ? chars.join('') : `${chars.slice(0, HEADING_MAX).join('')}…`;
}

export function appendPoints(scene, texts, nextId) {
  for (const text of texts) {
    const prev = scene.points[scene.points.length - 1];
    const pt = { id: nextId('p'), text };
    scene.points.push(pt);
    if (prev) scene.relations.push({ from: prev.id, to: pt.id });
  }
}

export function newScene(firstUtterance, nextId) {
  const scene = { id: nextId('s'), heading: makeHeading(firstUtterance), points: [], relations: [], status: 'in_progress' };
  appendPoints(scene, extractPoints(firstUtterance), nextId);
  return scene;
}
