// FR-012 の土台: 保存キー grp.session / grp.layout / grp.theme（保存はすべて注入された storage だけを通す）。
// 壊れた保存内容は無視して null / 既定を返す（起動を妨げない）。

export const SESSION_KEY = 'grp.session';
export const THEME_KEY = 'grp.theme';
export const THEMES = ['light', 'dark'];

export function readJson(storage, key) {
  try {
    const text = storage.getItem(key);
    return text == null ? null : JSON.parse(text);
  } catch { return null; }
}

export function writeJson(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function remove(storage, key) {
  try { storage.removeItem(key); } catch { /* 保存先が使えなくても動作は続ける */ }
}

const isStr = (v) => typeof v === 'string';

// 保存されたセッションの検証。形が合わなければ null（空の状態で起動）。
export function parseSession(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.utterances) || !Array.isArray(raw.scenes)) return null;
  const okU = raw.utterances.every((u) => u && isStr(u.id) && isStr(u.text) && typeof u.receivedAt === 'number');
  const okS = raw.scenes.every((s) => s && isStr(s.id) && isStr(s.heading) && Array.isArray(s.points)
    && s.points.every((p) => p && isStr(p.id) && isStr(p.text))
    && Array.isArray(s.relations) && (s.status === 'in_progress' || s.status === 'confirmed'));
  if (!okU || !okS) return null;
  return {
    utterances: raw.utterances.map((u) => ({ id: u.id, text: u.text, receivedAt: u.receivedAt })),
    scenes: raw.scenes.map((s) => ({
      id: s.id, heading: s.heading, status: s.status,
      points: s.points.map((p) => ({ id: p.id, text: p.text })),
      relations: s.relations.map((r) => ({ from: r.from, to: r.to })),
    })),
    selectedSceneId: isStr(raw.selectedSceneId) ? raw.selectedSceneId : null,
    seq: Number.isInteger(raw.seq) && raw.seq >= 0 ? raw.seq : 0,
  };
}
