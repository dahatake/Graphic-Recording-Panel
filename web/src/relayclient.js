// FR-062・FR-082: 同一オリジンの中継サーバー（/api/llm/...・/api/speech/...）へ要求する唯一の入口。外部の URL へは一切要求しない（G-002 の例外条件 (3)）。
// 戻り値は { status, body }。ネットワーク失敗は例外のまま呼び出し側（llm.js）が失敗として扱い、ルールベース描画に戻す。
export async function relayRequest({ method = 'GET', path, body }) {
  if (typeof path !== 'string' || !(path.startsWith('/api/llm/') || path.startsWith('/api/speech/'))) throw new TypeError('relay path must be same-origin /api/llm/ or /api/speech/');
  const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}
