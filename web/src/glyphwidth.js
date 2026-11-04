// 共通部品「字幅の見積もり」（FR-076 AC-670・NFR-UX-012 AC-466）。DOM に依存しない決定的な見積もり（AC-412）。
// 図の文字の幅を、書体の系統（stylepresets.js の FONT_STACKS のキー）ごとに見積もる。
// - 手書き風の系統（handwriting）: 並びのどの書体で描かれても枠からはみ出さないよう、並びにある書体の字幅の最大で見積もる。
//   欧文（U+0020〜U+007E）は文字ごとの送り幅の最大値（em）。実測: 書体のファイルの hmtx（fontTools 4.68。2026-11-05）で、
//   Segoe Print（標準・太字）・Ink Free・Arial Rounded MT Bold・Yomogi・Zen Kurenaido・Kaisei Decol（標準・太字）・
//   Yu Gothic UI（Bold・Semibold・Semilight）の各文字の最大を 0.01 em 単位に切り上げた値。
//   日本語の文字（U+2E80 以上）は 3 書体と Yu Gothic UI のすべてで 1 em 以下（Zen Kurenaido の一部の約物は 0.943 em）なので 1 em。
//   それ以外の記号（…・→・▶ など）も 1 em。太字の書体がない書体（Yomogi・Zen Kurenaido）は端末が太字を合成して字の形が
//   送り幅より外へ広がるので、1 行の終わりに SYNTH_BOLD_EM（em）を足す。
// - それ以外の系統: 従来の見積もり（日本語 1 em・それ以外 0.56 em。diagram.js の textWidth と同じ）を変えない。
export const HAND_ASCII_EM = [
  0.5, 0.5, 0.5, 0.8, 0.7, 0.99, 0.93, 0.5, 0.5, 0.5, 0.52, 0.95, 0.5, 0.65, 0.5, 0.58, // 空白 ! " # $ % & ' ( ) * + , - . /
  0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, // 0〜9
  0.5, 0.5, 0.78, 0.75, 0.78, 0.58, 1, // : ; < = > ? @
  0.78, 0.74, 0.75, 0.83, 0.69, 0.61, 0.8, 0.84, 0.67, 0.6, 0.75, 0.67, 0.95, 0.81, 0.82, 0.71, 0.82, 0.73, 0.67, 0.71, 0.78, 0.76, 1.02, 0.77, 0.7, 0.79, // A〜Z
  0.5, 0.64, 0.5, 0.7, 0.56, 0.5, // [ \ ] ^ _ `
  0.6, 0.63, 0.6, 0.67, 0.6, 0.5, 0.63, 0.64, 0.5, 0.5, 0.6, 0.5, 1.03, 0.67, 0.62, 0.65, 0.63, 0.51, 0.55, 0.5, 0.63, 0.58, 0.89, 0.58, 0.6, 0.53, // a〜z
  0.5, 0.6, 0.5, 0.78, // { | } ~
];
export const SYNTH_BOLD_EM = 0.08;
const LEGACY_LATIN_EM = 0.56;
const isWide = (cp) => cp >= 0x2e80;

// 1 文字の送り幅（px）。kind は書体の系統（'handwriting'・'roundGothic'・'gothic'。未指定は従来の見積もり）
export function glyphWidth(ch, size, kind) {
  const cp = String(ch).codePointAt(0) ?? 0x20;
  if (isWide(cp)) return size;
  if (kind !== 'handwriting') return size * LEGACY_LATIN_EM;
  return size * (cp >= 0x20 && cp <= 0x7e ? HAND_ASCII_EM[cp - 0x20] : 1);
}
// 1 行の文字の幅（px）。手書き風の系統は合成の太字の広がりを足す
export function textWidthOf(s, size, kind) {
  const chars = [...String(s ?? '')];
  if (!chars.length) return 0;
  const w = chars.reduce((n, ch) => n + glyphWidth(ch, size, kind), 0);
  return kind === 'handwriting' ? w + size * SYNTH_BOLD_EM : w;
}
// 幅 maxW に収まるように、文字の単位で末尾を「…」に置き換えて切る（収まるときはそのまま）
export function fitTextWidth(s, maxW, size, kind) {
  const str = String(s ?? '');
  if (textWidthOf(str, size, kind) <= maxW) return str;
  const chars = [...str];
  while (chars.length && textWidthOf(`${chars.join('')}…`, size, kind) > maxW) chars.pop();
  return chars.length ? `${chars.join('').replace(/\s+$/, '')}…` : '';
}
// 幅 w で文字の単位に折り返す（最大 max 行。超える分は最後の行の末尾を「…」にする）
export function wrapTextWidth(text, w, size, kind, max = Infinity) {
  const lines = []; let cur = '';
  for (const ch of [...String(text ?? '')]) {
    if (cur && textWidthOf(cur + ch, size, kind) > w) { lines.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    lines.length = max;
    // 手書き風の系統は「…」を足しても幅に収まるように切る。それ以外は従来どおり末尾の 1 文字を「…」にする
    lines[max - 1] = kind === 'handwriting' ? fitTextWidth(`${lines[max - 1]}…`, w, size, kind) : `${lines[max - 1].slice(0, -1)}…`;
  }
  return lines;
}
