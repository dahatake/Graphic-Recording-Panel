// NFR-SEC-004 SVG の許可リストによるサニタイズ（アプリ側）。FR-065 の生成 SVG・セッションファイルから読んだ SVG・同梱部品に使う。
// 要素・属性は parts.js の許可リスト（OK_TAGS・OK_ATTRS。isAllowedPartSvg と同じ規則）にあるものだけを残す。
// 許可リストにない要素は子ごと除去し、属性は除去する。解析できない入力・DOCTYPE・コメント・処理命令・複数の根は拒否（null）。
// 同じ規則を server/relay_security.py の sanitize_svg が実装する（中継サーバー側。二重に行う）。
import { OK_TAGS, OK_ATTRS } from './parts.js';

export const MAX_GENERATED_SVG_BYTES = 16384; // PARAM-072
const SVG_NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/'); // 名前空間の識別子（取得先ではない）
const TEXT_TAGS = new Set(['text', 'tspan', 'title']);
const MAX_DEPTH = 32;
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9:_.-]*)((?:\s+[^\s"'=<>/]+(?:\s*=\s*(?:"[^"<]*"|'[^'<]*'))?)*)\s*(\/?)>/y;
const ATTR_RE = /\s+([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"<]*)"|'([^'<]*)'))?/g;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// 禁止の値（デコード後・空白と制御文字を除いて小文字にしてから検査）
const BAD_VALUE = /javascript:|vbscript:|data:|url\(|\u0040import|https?:|\/\/|expression\(|<script|&#/;

// 5 つの名前つき参照だけを復号する。ほかの参照（数値参照を含む）があれば null（回避の余地を残さない）。
function decode(s) {
  let bad = false;
  const out = s.replace(/&([^;&\s]*);?/g, (m, name) => { if (m.endsWith(';') && name in NAMED) return NAMED[name]; bad = true; return m; });
  return bad ? null : out;
}
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
const compact = (s) => s.replace(/[\s\u0000-\u001f\u007f]+/g, '').toLowerCase();

function cleanAttrs(raw, isRoot) {
  const attrs = []; const seen = new Set();
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(raw))) {
    const name = m[1]; const val = m[2] ?? m[3];
    if (!OK_ATTRS.has(name) || seen.has(name) || val === undefined) continue;
    const v = decode(val);
    if (v == null || BAD_VALUE.test(compact(v))) continue;
    if (name === 'xmlns') { if (v !== SVG_NS) continue; if (!isRoot) continue; }
    seen.add(name); attrs.push([name, v]);
  }
  return attrs;
}

// 戻り値: サニタイズ済みの SVG 文字列、または拒否のとき null。options.width/height で根の大きさを指定できる。
export function sanitizeSvg(input, options = {}) {
  if (typeof input !== 'string' || !input.trim()) return null;
  if (/<[!?]/.test(input)) return null;
  const s = input.trim();
  const root = { tag: null, attrs: [], kids: [] };
  const stack = [root]; let skip = 0; let sawRoot = false; let i = 0;
  while (i < s.length) {
    if (s[i] !== '<') {
      let j = s.indexOf('<', i); if (j < 0) j = s.length;
      const text = s.slice(i, j); i = j;
      const top = stack[stack.length - 1];
      if (skip) continue;
      if (!top.tag) { if (text.trim()) return null; continue; }
      if (!TEXT_TAGS.has(top.tag)) continue; // 文字を持てない要素の中の文字は捨てる
      const d = decode(text);
      if (d != null && !BAD_VALUE.test(compact(d))) top.kids.push(d);
      continue;
    }
    TAG_RE.lastIndex = i;
    const m = TAG_RE.exec(s);
    if (!m) return null;
    i = TAG_RE.lastIndex;
    const [, close, tag, rawAttrs, selfClose] = m;
    if (close) {
      if (rawAttrs.trim() || selfClose) return null;
      if (skip) { skip--; continue; }
      const top = stack[stack.length - 1];
      if (!top.tag || top.tag !== tag) return null;
      stack.pop();
      continue;
    }
    if (skip) { if (!selfClose) skip++; continue; }
    const parent = stack[stack.length - 1];
    if (!parent.tag) { if (sawRoot || tag !== 'svg') return null; }
    if (!OK_TAGS.has(tag)) { if (!selfClose) skip++; continue; }
    if (tag === 'svg' && parent.tag) { if (!selfClose) skip++; continue; } // 入れ子の svg は許さない
    if (stack.length > MAX_DEPTH) return null;
    const el = { tag, attrs: cleanAttrs(rawAttrs, !parent.tag), kids: [] };
    parent.kids.push(el);
    if (!parent.tag) sawRoot = true;
    if (!selfClose) stack.push(el);
  }
  if (stack.length !== 1 || skip || !sawRoot) return null;
  const svgEl = root.kids[0];
  const rootAttrs = svgEl.attrs.filter(([n]) => n !== 'xmlns' && !(options.width != null && n === 'width') && !(options.height != null && n === 'height'));
  svgEl.attrs = [['xmlns', SVG_NS], ...rootAttrs, ...(options.width != null ? [['width', String(options.width)]] : []), ...(options.height != null ? [['height', String(options.height)]] : [])];
  const ser = (el) => {
    if (typeof el === 'string') return escText(el);
    const a = el.attrs.map(([n, v]) => ` ${n}="${escAttr(v)}"`).join('');
    return el.kids.length ? `<${el.tag}${a}>${el.kids.map(ser).join('')}</${el.tag}>` : `<${el.tag}${a}/>`;
  };
  return ser(svgEl);
}

export const svgByteLength = (s) => new TextEncoder().encode(String(s)).length;

// 生成 SVG の検査: サニタイズ → 大きさの上限。通らなければ null。
export function acceptGeneratedSvg(input, options = {}) {
  if (typeof input !== 'string' || svgByteLength(input) > MAX_GENERATED_SVG_BYTES) return null;
  const out = sanitizeSvg(input, options);
  return out && svgByteLength(out) <= MAX_GENERATED_SVG_BYTES * 2 ? out : null;
}
