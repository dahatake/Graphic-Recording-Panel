// FR-096 AC-562: PNG のテキストのメタデータ（iTXt チャンク・UTF-8）を、既存の PNG のバイト列に差し込む。外部ライブラリは使わない。
let TABLE = null;
function crc32(bytes) {
  if (!TABLE) { TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLE[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const u32 = (n) => Uint8Array.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const ascii = (s) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);

// iTXt: keyword(Latin-1) 0 圧縮フラグ(0) 圧縮方式(0) 言語タグ 0 翻訳キーワード 0 テキスト(UTF-8)
export function itxtChunk(keyword, text) {
  const enc = new TextEncoder();
  const body = [ascii(keyword), Uint8Array.of(0, 0, 0, 0, 0), enc.encode(String(text))];
  const data = new Uint8Array(body.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const b of body) { data.set(b, o); o += b.length; }
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(ascii('iTXt'), 0); typeAndData.set(data, 4);
  const out = new Uint8Array(4 + typeAndData.length + 4);
  out.set(u32(data.length), 0); out.set(typeAndData, 4); out.set(u32(crc32(typeAndData)), 4 + typeAndData.length);
  return out;
}

// entries: [[keyword, text], ...]。PNG の署名がなければ、またはチャンクの並びが読めなければ、そのまま返す。最初の IDAT（なければ IEND）の前へ入れる。
export function addPngText(bytes, entries) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 16 || sig.some((v, i) => b[i] !== v)) return b;
  let pos = 8; let at = -1;
  while (pos + 8 <= b.length) {
    const size = ((b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]) >>> 0;
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    if (type === 'IDAT' || type === 'IEND') { at = pos; break; }
    pos += 12 + size;
  }
  if (at < 0) return b;
  const chunks = entries.filter(([, t]) => String(t ?? '') !== '').map(([k, t]) => itxtChunk(k, t));
  const extra = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(b.length + extra);
  out.set(b.subarray(0, at), 0);
  let o = at; for (const c of chunks) { out.set(c, o); o += c.length; }
  out.set(b.subarray(at), o);
  return out;
}

// テスト・検証用: iTXt チャンクを読み出す
export function readPngText(bytes) {
  const b = new Uint8Array(bytes); const out = {}; let pos = 8;
  while (pos + 8 <= b.length) {
    const size = ((b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]) >>> 0;
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    if (type === 'iTXt') {
      const d = b.subarray(pos + 8, pos + 8 + size); const z = d.indexOf(0);
      const kw = String.fromCharCode(...d.subarray(0, z));
      let p = z + 3; p = d.indexOf(0, p) + 1; p = d.indexOf(0, p) + 1;
      out[kw] = new TextDecoder().decode(d.subarray(p));
    }
    if (type === 'IEND') break;
    pos += 12 + size;
  }
  return out;
}
