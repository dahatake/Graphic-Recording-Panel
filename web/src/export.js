import { paintRpgCanvas } from './rpgmap.js';
import { buildLook } from './presetdiagram.js';
import { presetOf, fontFamilyOf, LEGACY_FONT_FAMILY } from './stylepresets.js';
// FR-006（PNG・SVG 保存）/ FR-007（PDF 保存）。外部通信なし・依存なし（PDF は自前で生成する）。
// 保存は「表示中のビュー」ではなく常に 2D の図の内容（全シーンの見出しと要点）を出力する。3D 表示中はその旨を表示する（AC-014）。
// シーンが 0 件のときは保存できず、理由を表示する（AC-046）。

const MARGIN = 24;
const PALETTE = ['#1346a8', '#0b5d2a', '#8a3c00', '#6b2a8f', '#9b1c1c', '#0b6070'];

// ---- FR-075・FR-077 AC-419: 保存（PNG・PDF）に画風プリセットの見た目（紙面の質感・配色・見出しの飾り・吹き出し・線・書体の系統）を反映する ----
// 定義は契約の getDrawStyleSpec(id) の形で受け取り、配色の役割は画面の図と同じ buildLook（presetdiagram.js。AC-410 のコントラストを満たす）から決める。
// 画風プリセット（preset:true）だけに効かせ、既存の 4 つ（手書き調・アニメ調・シンプル・RPG風）は null（従来の出力のまま。AC-147・AC-227）。
// 強制カラー（AC-456）は画面の表示だけの変換で、保存には使わない（常に風の配色）。紙面の質感はアプリが描く線分で、外部の素材は使わない（AC-407）。
export const PAPERS = ['plain', 'grid', 'ruled', 'chalkboard', 'whiteboard', 'kraft'];
const hex6 = (v) => (v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v).toLowerCase();
// 2 色の混色（t=0 で a、1 で b）。透明度を使わずに PNG と PDF で同じ色にする
const mix = (a, b, t) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex6(a).slice(i, i + 2), 16) * (1 - t) + parseInt(hex6(b).slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`;
export function exportLook(spec) {
  if (!spec || typeof spec !== 'object' || spec.preset !== true) return null;
  const pr = presetOf(spec);
  if (!pr) return null;
  const L = buildLook(spec);
  const fills = L.stickyFills ?? [L.frameFill];
  return {
    background: hex6(L.bg), text: hex6(L.ink), frame: hex6(L.frame), band: hex6(L.band), bandText: hex6(L.bandText),
    marker: hex6(L.marker), headSticky: hex6(L.headSticky), headStickyText: hex6(L.textOn(L.headSticky)),
    pointFills: fills.map(hex6), pointTexts: fills.map((f) => hex6(L.textOn(f))), pointStroke: (f) => hex6(L.outlineOf(f)),
    texture: hex6(L.texture), accent: hex6(pr.palette.accent[0]),
    lineWidth: Math.round(pr.stroke.width * 10) / 10, headingDecoration: pr.headingDecoration, balloon: pr.balloon,
    headWeight: L.headWeight, weight: L.weight, paper: PAPERS.includes(pr.paper) ? pr.paper : 'plain', fontFamily: fontFamilyOf(pr.font),
  };
}
const rnd = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }; // 決定的な擬似乱数（毎回同じ質感）
// 紙面の質感の線分 [{x1,y1,x2,y2,width,color}]（左上原点。PNG・PDF で共通。PDF は上下を反転して描く）
export function paperTexture(look, w, h) {
  const out = [];
  if (!look) return out;
  const bg = look.background; const faint = mix(bg, look.texture, 0.35);
  const L = (x1, y1, x2, y2, width = 1, color = faint) => out.push({ x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), width, color });
  const frame = (inset, width, color) => { L(inset, inset, w - inset, inset, width, color); L(w - inset, inset, w - inset, h - inset, width, color); L(w - inset, h - inset, inset, h - inset, width, color); L(inset, h - inset, inset, inset, width, color); };
  if (look.paper === 'grid') { for (let y = 24; y < h; y += 24) L(0, y, w, y); for (let x = 24; x < w; x += 24) L(x, 0, x, h); }
  else if (look.paper === 'ruled') { for (let y = 48; y < h; y += 28) L(0, y, w, y); L(40, 0, 40, h, 1, mix(bg, look.accent, 0.6)); } // 横罫と左の余白線
  else if (look.paper === 'chalkboard') { // 黒板: チョークの粉のかすれと木の枠
    const n = Math.max(12, Math.round((w * h) / 12000));
    for (let i = 0; i < n; i++) { const x = rnd(i) * w; const y = rnd(i + 101) * h; const len = 20 + rnd(i + 202) * 60; const a = (rnd(i + 303) - 0.5) * 0.6; L(x, y, x + len * Math.cos(a), y + len * Math.sin(a), 2, mix(bg, look.text, 0.16)); }
    frame(3, 6, mix(bg, '#8b5a2b', 0.75));
  } else if (look.paper === 'kraft') { // クラフト紙: 短い繊維
    const n = Math.max(40, Math.round((w * h) / 2500));
    for (let i = 0; i < n; i++) { const x = rnd(i + 7) * w; const y = rnd(i + 409) * h; const len = 4 + rnd(i + 811) * 8; const a = rnd(i + 613) * Math.PI; L(x, y, x + len * Math.cos(a), y + len * Math.sin(a), 1, mix(bg, look.text, 0.15)); }
  } else if (look.paper === 'whiteboard') { // ホワイトボード: 枠・下のトレイ・映り込み
    frame(2, 4, mix(bg, look.text, 0.35));
    L(8, h - 10, w - 8, h - 10, 3, mix(bg, look.text, 0.25));
    L(w * 0.55, 8, w * 0.75, h * 0.35, 10, mix(bg, look.text, 0.05)); L(w * 0.62, 8, w * 0.82, h * 0.35, 4, mix(bg, look.text, 0.05));
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
export function stampName(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ---- PDF（自前の最小の生成器） ----
const A4 = { w: 595, h: 842, margin: 50 };
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
// UTF-16BE の 16 進。bmpOnly のとき BMP 外の文字は表示用から除く（ActualText には全部入れる）。
export function utf16Hex(s, bmpOnly = false) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c > 0xffff) { if (bmpOnly) continue; const v = c - 0x10000; out += hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff)); } else out += hex4(c);
  }
  return out;
}
const cw = (ch, fs) => (ch.codePointAt(0) >= 0x2e80 ? fs : fs * 0.5);
export function wrapLines(text, fs, width) {
  const lines = []; let cur = ''; let w = 0;
  for (const ch of String(text)) {
    const x = cw(ch, fs);
    if (w + x > width && cur) { lines.push(cur); cur = ''; w = 0; }
    cur += ch; w += x;
  }
  lines.push(cur);
  return lines;
}

const rgb = (v) => [1, 3, 5].map((i) => (parseInt(hex6(v).slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
export function buildPdf(scenes, { title = '', arrange = null, parts = null, look = null } = {}) {
  const FS_H = 15; const FS_P = 11; const LH_H = 22; const LH_P = 16;
  const width = A4.w - A4.margin * 2;
  // FR-077 AC-419: 描画スタイルの紙面（背景色・方眼・罫線）を各ページの最初に描く
  const paper = () => {
    if (!look) return [];
    let g = `q ${rgb(look.background)} rg 0 0 ${A4.w} ${A4.h} re f\n`;
    for (const t of paperTexture(look, A4.w, A4.h)) g += `${rgb(t.color)} RG ${t.width} w ${t.x1} ${A4.h - t.y1} m ${t.x2} ${A4.h - t.y2} l S\n`;
    return [`${g}Q\n`];
  };
  const pages = [paper()];
  let y = A4.h - A4.margin; let page = 0;
  const need = (h) => { if (y - h < A4.margin) { pages.push(paper()); page++; y = A4.h - A4.margin; } };
  // 見出し・要点の飾り（look があるときだけ）。i はシーンの番号（付箋の色の巡回）
  const deco = (kind, i, x, top, w, h) => {
    if (!look || (kind !== 'heading' && kind !== 'point')) return '';
    let g = 'q ';
    if (kind === 'heading') {
      const d = look.headingDecoration;
      if (d === 'band') g += `${rgb(look.band)} rg ${x - 4} ${top - h} ${w + 8} ${h} re f\n`;
      else if (d === 'marker') g += `${rgb(look.marker)} rg ${x - 2} ${top - h} ${w + 4} ${Math.max(4, h * 0.35)} re f\n`;
      else if (d === 'sticky') g += `${rgb(look.headSticky)} rg ${rgb(look.pointStroke(look.headSticky))} RG ${look.lineWidth / 2} w ${x - 4} ${top - h} ${w + 8} ${h} re B\n`;
    } else {
      const f = look.pointFills[i % look.pointFills.length];
      g += `${rgb(f)} rg ${rgb(look.pointStroke(f))} RG ${look.lineWidth / 2} w ${x - 6} ${top - h} ${w + 8} ${h} re B\n`;
    }
    return `${g}Q\n`;
  };
  const inkOf = (kind, i) => {
    if (kind === 'heading' && look.headingDecoration === 'band') return `${rgb(look.bandText)} rg `;
    if (kind === 'heading' && look.headingDecoration === 'sticky') return `${rgb(look.headStickyText)} rg `;
    if (kind === 'point') return `${rgb(look.pointTexts[i % look.pointTexts.length])} rg `;
    return `${rgb(look.text)} rg `;
  };
  // 内容ストリームの 1 ブロック: 全文を ActualText にして、表示は折り返した行ごとに Tj。
  const block = (text, fs, lh, indent, kind = null, i = 0) => {
    const lines = wrapLines(text, fs, width - indent);
    need(lines.length * lh + 4);
    let s = deco(kind, i, A4.margin + indent, y + 2, width - indent, lines.length * lh + 2);
    s += `/Span <</ActualText <FEFF${utf16Hex(text)}>>> BDC\nBT ${look ? inkOf(kind, i) : ''}/F1 ${fs} Tf ${lh} TL ${A4.margin + indent} ${y - fs} Td\n`;
    lines.forEach((l, i) => { s += `${i ? 'T* ' : ''}<${utf16Hex(l, true)}> Tj\n`; });
    s += 'ET\nEMC\n';
    pages[page].push(s);
    y -= lines.length * lh + 4;
  };
  if (title) block(title, 12, 18, 0, look ? 'title' : null);
  if (arrange) {
    // FR-016 AC-089: 整理の表示。軸の名前・区分の見出しと、区分（未分類を含む）ごとのオブジェクトを出力する。
    const g = arrange.geometry;
    block(`${arrange.axisLabels.vertical}: ${arrange.axes.vertical.name}（${arrange.axes.vertical.sections.map((s) => s.label).join(' / ')} / ${arrange.unclassified.label}）`, FS_P, LH_P, 0);
    block(`${arrange.axisLabels.horizontal}: ${arrange.axes.horizontal.name}（${arrange.axes.horizontal.sections.map((s) => s.label).join(' / ')} / ${arrange.unclassified.label}）`, FS_P, LH_P, 0);
    const byId = new Map(scenes.flatMap((s) => [[s.id, s.heading], ...s.points.map((p) => [p.id, p.text])]));
    for (const r of g.rows) {
      for (const c of g.cols) {
        const here = g.items.filter((it) => it.y >= r.y && it.y < r.y + r.h && it.x >= c.x && it.x < c.x + c.w);
        if (!here.length) continue;
        block(`${r.label} × ${c.label}`, FS_H, LH_H, 0);
        for (const it of here) block(byId.get(it.id) ?? it.text, FS_P, LH_P, 16);
      }
    }
  } else {
    scenes.forEach((sc, i) => {
      y -= i ? 10 : 0;
      block(sc.heading, FS_H, LH_H, 0, 'heading', i);
      for (const p of sc.points) block(p.text, FS_P, LH_P, 16, 'point', i);
    });
  }
  // FR-063 AC-321: LLM が対応づけた絵（物の名前）を、PDF にも文字で含める
  if (parts?.length) {
    y -= 10;
    block(parts.map((p) => p.label).join(' / '), FS_P, LH_P, 0);
  }

  const objs = []; // 1 起点の番号 → 本文
  const add = (body) => { objs.push(body); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  add(''); // 2（後で Pages を入れる）
  add('<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [4 0 R] >>'); // 3
  add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 5 0 R /DW 1000 >>'); // 4
  add('<< /Type /FontDescriptor /FontName /HeiseiKakuGo-W5 /Flags 4 /FontBBox [-92 -250 1010 922] /ItalicAngle 0 /Ascent 752 /Descent -271 /CapHeight 737 /StemV 114 >>'); // 5
  const kids = [];
  for (const parts of pages) {
    const stream = parts.join('');
    const c = add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    const p = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${c} 0 R >>`);
    kids.push(`${p} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((b, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (ch) => ch.charCodeAt(0) & 0xff); // 全体が ASCII
}

// FR-063 AC-321: LLM が抽出し同梱部品へ対応づけた絵（items = [{ svg, label }]）の帯。PNG の末尾に部品ごとに drawImage する。
const BAND_CELL = 64;
async function loadPartImage(svg, imageFactory) {
  if (imageFactory) return imageFactory(svg);
  const Img = globalThis.Image;
  if (!Img) return { svg, width: 48, height: 48 };
  return new Promise((res) => {
    const im = new Img();
    im.onload = () => res(im); im.onerror = () => res({ svg, width: 48, height: 48 });
    im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
async function partsBand(items, width, imageFactory) {
  if (!items?.length) return { h: 0, draw: () => {} };
  const per = Math.max(1, Math.floor((width - MARGIN * 2) / BAND_CELL));
  const rows = Math.ceil(items.length / per);
  const imgs = [];
  for (const it of items) imgs.push(await loadPartImage(it.svg, imageFactory));
  return {
    h: rows * BAND_CELL + MARGIN,
    draw(g, top) {
      g.textBaseline = 'middle';
      items.forEach((it, i) => {
        const x = MARGIN + (i % per) * BAND_CELL; const y = top + Math.floor(i / per) * BAND_CELL;
        g.drawImage(imgs[i], x, y, 48, 48);
        g.fillStyle = '#15191f'; g.font = `11px ${LEGACY_FONT_FAMILY}`;
        g.fillText(String(it.label).slice(0, 8), x, y + 54);
      });
    },
  };
}

// ---- PNG（canvasFactory に全シーンの見出しと要点を描く） ----
export async function renderPng(scenes, canvasFactory, { title = '', arrange = null, parts = null, imageFactory = null, look = null } = {}) {
  if (arrange) return renderArrangedPng(scenes, arrange, canvasFactory, parts, imageFactory);
  if (look) return renderStyledPng(scenes, canvasFactory, look, parts, imageFactory);
  const FS_H = 18; const FS_P = 15; const ROW_H = 30; const HEAD_H = 40; const GAP = 22;
  const font = (px, bold) => `${bold ? '700 ' : ''}${px}px ${LEGACY_FONT_FAMILY}`;
  const probe = canvasFactory(8, 8).getContext('2d');
  const measure = (s, px, bold) => { probe.font = font(px, bold); return probe.measureText(s).width; };
  let w = 320;
  for (const sc of scenes) {
    w = Math.max(w, measure(sc.heading, FS_H, true) + 40, ...sc.points.map((p) => measure(p.text, FS_P, false) + 56));
  }
  w = Math.ceil(w + MARGIN * 2);
  const band = await partsBand(parts, w, imageFactory);
  const baseH = Math.ceil(MARGIN * 2 + scenes.reduce((a, sc) => a + HEAD_H + sc.points.length * ROW_H + GAP, 0));
  const h = baseH + band.h;
  const canvas = canvasFactory(w, h);
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  let y = MARGIN;
  scenes.forEach((sc, i) => {
    const color = PALETTE[i % PALETTE.length];
    g.fillStyle = color; g.fillRect(MARGIN, y, w - MARGIN * 2, HEAD_H - 4);
    g.fillStyle = '#ffffff'; g.font = font(FS_H, true); g.textBaseline = 'middle';
    g.fillText(sc.heading, MARGIN + 14, y + (HEAD_H - 4) / 2);
    y += HEAD_H;
    for (const p of sc.points) {
      g.strokeStyle = color; g.lineWidth = 2; g.strokeRect(MARGIN + 18, y + 2, w - MARGIN * 2 - 18, ROW_H - 6);
      g.fillStyle = '#15191f'; g.font = font(FS_P, false);
      g.fillText(p.text, MARGIN + 30, y + (ROW_H - 2) / 2);
      y += ROW_H;
    }
    y += GAP;
  });
  band.draw(g, baseH - MARGIN);
  void title;
  return canvas.toBytes();
}

// FR-075・FR-077 AC-419: 画風プリセットの見た目で描く PNG（紙面と質感・配色・見出しの飾り・吹き出し・線の太さ・書体の系統）。文字は fillText で全部描く
async function renderStyledPng(scenes, canvasFactory, look, parts, imageFactory) {
  const FS_H = 18; const FS_P = 15; const ROW_H = 34; const HEAD_H = 44; const GAP = 22;
  const font = (px, weight) => `${weight ? `${weight} ` : ''}${px}px ${look.fontFamily}`;
  const probe = canvasFactory(8, 8).getContext('2d');
  const measure = (s, px, wt) => { probe.font = font(px, wt); return probe.measureText(s).width; };
  let w = 320;
  for (const sc of scenes) w = Math.max(w, measure(sc.heading, FS_H, look.headWeight) + 40, ...sc.points.map((p) => measure(p.text, FS_P, look.weight) + 64));
  w = Math.ceil(w + MARGIN * 2);
  const band = await partsBand(parts, w, imageFactory);
  const baseH = Math.ceil(MARGIN * 2 + scenes.reduce((a, sc) => a + HEAD_H + sc.points.length * ROW_H + GAP, 0));
  const h = baseH + band.h;
  const canvas = canvasFactory(w, h);
  const g = canvas.getContext('2d');
  g.fillStyle = look.background; g.fillRect(0, 0, w, h);
  for (const t of paperTexture(look, w, h)) { g.strokeStyle = t.color; g.lineWidth = t.width; g.beginPath(); g.moveTo(t.x1, t.y1); g.lineTo(t.x2, t.y2); g.stroke(); } // 紙面の質感
  const round = (x, y, rw, rh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + rw, y, x + rw, y + rh, r); g.arcTo(x + rw, y + rh, x, y + rh, r); g.arcTo(x, y + rh, x, y, r); g.arcTo(x, y, x + rw, y, r); g.closePath(); };
  let y = MARGIN;
  scenes.forEach((sc, i) => {
    const hw = w - MARGIN * 2; const hh = HEAD_H - 6;
    let ink = look.text;
    if (look.headingDecoration === 'band') { g.fillStyle = look.band; g.fillRect(MARGIN, y, hw, hh); ink = look.bandText; }
    else if (look.headingDecoration === 'sticky') { g.fillStyle = look.headSticky; g.fillRect(MARGIN, y, hw, hh); g.strokeStyle = look.pointStroke(look.headSticky); g.lineWidth = look.lineWidth; g.strokeRect(MARGIN, y, hw, hh); ink = look.headStickyText; }
    else if (look.headingDecoration === 'marker') { g.fillStyle = look.marker; g.fillRect(MARGIN + 8, y + hh * 0.6, Math.min(hw - 8, measure(sc.heading, FS_H, look.headWeight) + 12), hh * 0.35); }
    g.fillStyle = ink; g.font = font(FS_H, look.headWeight); g.textBaseline = 'middle';
    g.fillText(sc.heading, MARGIN + 14, y + hh / 2);
    y += HEAD_H;
    const fill = look.pointFills[i % look.pointFills.length];
    for (const p of sc.points) {
      const bx = MARGIN + 18; const by = y + 3; const bw = w - MARGIN * 2 - 18; const bh = ROW_H - 8;
      g.strokeStyle = look.pointStroke(fill); g.lineWidth = look.lineWidth; g.fillStyle = fill;
      if (look.balloon === 'sticky') { g.fillRect(bx, by, bw, bh); g.strokeRect(bx, by, bw, bh); }
      else { round(bx, by, bw, bh, look.balloon === 'cloud' ? bh / 2 : 8); g.fill(); g.stroke(); }
      g.fillStyle = look.pointTexts[i % look.pointTexts.length]; g.font = font(FS_P, look.weight);
      g.fillText(p.text, bx + 12, by + bh / 2);
      y += ROW_H;
    }
    y += GAP;
  });
  band.draw(g, baseH - MARGIN);
  return canvas.toBytes();
}

// FR-016 AC-089: 整理の表示の PNG（軸の名前・区分の見出し・未分類の領域・各オブジェクトを、整理の配置どおりに描く）
async function renderArrangedPng(scenes, model, canvasFactory, parts = null, imageFactory = null) {
  const g = model.geometry;
  const font = (px, bold) => `${bold ? '700 ' : ''}${px}px ${LEGACY_FONT_FAMILY}`;
  const band = await partsBand(parts, g.width, imageFactory);
  const canvas = canvasFactory(g.width, g.height + band.h);
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, g.width, g.height + band.h);
  band.draw(c, g.height);
  c.textBaseline = 'middle';
  const ink = '#15191f';
  for (const r of g.rows) {
    c.fillStyle = r.id ? '#f7f9fc' : '#fff7ed'; c.fillRect(g.margin, r.y, g.width - g.margin * 2, r.h);
    c.strokeStyle = '#8a94a6'; c.lineWidth = 1; c.strokeRect(g.margin, r.y, g.width - g.margin * 2, r.h);
    c.fillStyle = ink; c.font = font(14, true); c.fillText(r.label, g.margin + 8, r.y + 20);
  }
  for (const col of g.cols) {
    c.strokeStyle = '#8a94a6'; c.lineWidth = 1; c.strokeRect(col.x, g.top, col.w, g.height - g.margin - g.top);
    c.fillStyle = ink; c.font = font(14, true); c.fillText(col.label, col.x + 10, g.top - 14);
  }
  c.fillStyle = ink; c.font = font(18, true);
  c.fillText(`${model.axisLabels.horizontal}: ${model.axes.horizontal.name}`, g.margin, g.margin + 14);
  c.fillText(`${model.axisLabels.vertical}: ${model.axes.vertical.name}`, g.margin, g.margin + 38);
  const idx = new Map(scenes.map((s, i) => [s.id, i]));
  const pts = new Map(scenes.flatMap((s) => s.points.map((p) => [p.id, p])));
  for (const it of g.items) {
    if (it.kind === 'topic') {
      c.fillStyle = ink; c.fillRect(it.x, it.y, it.w, it.h);
      c.fillStyle = '#ffffff'; c.font = font(16, true); c.fillText(it.text, it.x + 10, it.y + it.h / 2);
    } else if (it.kind === 'scene') {
      c.fillStyle = PALETTE[idx.get(it.id) % PALETTE.length]; c.fillRect(it.x, it.y, it.w, it.h);
      c.fillStyle = '#ffffff'; c.font = font(16, true); c.fillText(scenes[idx.get(it.id)].heading, it.x + 10, it.y + it.h / 2);
    } else {
      c.strokeStyle = ink; c.lineWidth = 2; c.strokeRect(it.x, it.y, it.w, it.h);
      c.fillStyle = ink; c.font = font(14, false); c.fillText(pts.get(it.id).text, it.x + 10, it.y + it.h / 2);
    }
  }
  return canvas.toBytes();
}

// ---- 実ブラウザの既定（注入がないとき） ----
function browserCanvasFactory() {
  const doc = globalThis.document;
  if (!doc) return null;
  return (w, h) => {
    const c = doc.createElement('canvas'); c.width = w; c.height = h;
    c.toBytes = () => new Promise((res, rej) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error('toBlob'))), 'image/png'));
    return c;
  };
}
export function browserDownload({ filename, mime, data }) {
  const doc = globalThis.document;
  if (!doc) return;
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = doc.createElement('a'); a.href = url; a.download = filename;
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportModule(ctx) {
  ctx.i18n.addStrings({
    ja: {
      'msg.saveNone': '保存できる図がありません（シーンが 0 件です）。記録して発話を入力してください',
      'msg.save3d': '3D 表示中のため、2D の図を保存しました',
      'msg.saved': '保存しました',
      'msg.saveFailed': '保存に失敗しました',
    },
    en: {
      'msg.saveNone': 'Nothing to save: there are no scenes. Record and enter an utterance first',
      'msg.save3d': 'The 2D diagram was saved because the 3D view is shown',
      'msg.saved': 'Saved',
      'msg.saveFailed': 'Saving failed',
    },
  });
  const download = ctx.options.download ?? browserDownload;
  // 保存の可否（UI が無効化と理由の表示に使う）
  ctx.api.getSaveState = () => (ctx.state.scenes.length ? { enabled: true, reason: null } : { enabled: false, reason: ctx.t('msg.saveNone') });
  async function run(ext, mime, make) {
    if (!ctx.state.scenes.length) { ctx.change(() => ctx.setMessage('msg.saveNone')); return { ok: false, reason: 'no_scenes' }; }
    try {
      const data = await make();
      download({ filename: `graphic-recording-${stampName(ctx.now())}.${ext}`, mime, data });
    } catch {
      ctx.change(() => ctx.setMessage('msg.saveFailed'));
      return { ok: false, reason: 'failed' };
    }
    ctx.change((s) => ctx.setMessage(s.viewMode === '3d' ? 'msg.save3d' : 'msg.saved'));
    return { ok: true };
  }
  const scenes = () => ctx.state.scenes;
  // 整理の表示を選んでいるときは、その配置（軸・区分・未分類を含む）で出力する（AC-089）
  const arranged = () => (ctx.state.displayMode === 'arrange' && ctx.api.getArrangement ? ctx.api.getArrangement() : null);
  // 保存する SVG は風の配色で出す（強制カラーのシステム色への変換は画面の表示だけ。AC-456 の指摘）
  ctx.registerCommand('save.svg', () => run('svg', 'image/svg+xml', () => (ctx.api.renderSvgForSave ?? ctx.api.renderSvg)()));
  const drawn = () => ctx.api.getLlmDrawItems?.() ?? null; // FR-063
  // FR-077 AC-419: 現在の描画スタイル（上部・［設定］で選んだもの）の見た目で保存する
  const look = () => exportLook(ctx.api.getDrawStyleSpec?.(ctx.api.getDrawStyle?.()) ?? null);
  ctx.registerCommand('save.pdf', () => run('pdf', 'application/pdf', () => buildPdf(scenes(), { title: ctx.t('app.title'), arrange: arranged(), parts: drawn(), look: look() })));
  ctx.registerCommand('save.png', () => run('png', 'image/png', async () => {
    const factory = ctx.options.canvasFactory ?? browserCanvasFactory();
    if (!factory) throw new Error('no canvas');
    return renderPng(scenes(), factory, { arrange: arranged(), rpg: ctx.api.getRpgMap?.() ?? null, parts: drawn(), imageFactory: ctx.options.imageFactory ?? null, look: look() });
  }));
}
