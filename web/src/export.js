// FR-006（PNG・SVG 保存）/ FR-007（PDF 保存）。外部通信なし・依存なし（PDF は自前で生成する）。
// 保存は「表示中のビュー」ではなく常に 2D の図の内容（全シーンの見出しと要点）を出力する。3D 表示中はその旨を表示する（AC-014）。
// シーンが 0 件のときは保存できず、理由を表示する（AC-046）。

const MARGIN = 24;
const PALETTE = ['#1346a8', '#0b5d2a', '#8a3c00', '#6b2a8f', '#9b1c1c', '#0b6070'];

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

export function buildPdf(scenes, { title = '', arrange = null } = {}) {
  const FS_H = 15; const FS_P = 11; const LH_H = 22; const LH_P = 16;
  const width = A4.w - A4.margin * 2;
  const pages = [[]];
  let y = A4.h - A4.margin; let page = 0;
  const need = (h) => { if (y - h < A4.margin) { pages.push([]); page++; y = A4.h - A4.margin; } };
  // 内容ストリームの 1 ブロック: 全文を ActualText にして、表示は折り返した行ごとに Tj。
  const block = (text, fs, lh, indent) => {
    const lines = wrapLines(text, fs, width - indent);
    need(lines.length * lh + 4);
    let s = `/Span <</ActualText <FEFF${utf16Hex(text)}>>> BDC\nBT /F1 ${fs} Tf ${lh} TL ${A4.margin + indent} ${y - fs} Td\n`;
    lines.forEach((l, i) => { s += `${i ? 'T* ' : ''}<${utf16Hex(l, true)}> Tj\n`; });
    s += 'ET\nEMC\n';
    pages[page].push(s);
    y -= lines.length * lh + 4;
  };
  if (title) block(title, 12, 18, 0);
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
      block(sc.heading, FS_H, LH_H, 0);
      for (const p of sc.points) block(p.text, FS_P, LH_P, 16);
    });
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

// ---- PNG（canvasFactory に全シーンの見出しと要点を描く） ----
export async function renderPng(scenes, canvasFactory, { title = '', arrange = null } = {}) {
  if (arrange) return renderArrangedPng(scenes, arrange, canvasFactory);
  const FS_H = 18; const FS_P = 15; const ROW_H = 30; const HEAD_H = 40; const GAP = 22;
  const font = (px, bold) => `${bold ? '700 ' : ''}${px}px system-ui, 'Hiragino Sans', 'Yu Gothic UI', Meiryo, sans-serif`;
  const probe = canvasFactory(8, 8).getContext('2d');
  const measure = (s, px, bold) => { probe.font = font(px, bold); return probe.measureText(s).width; };
  let w = 320;
  for (const sc of scenes) {
    w = Math.max(w, measure(sc.heading, FS_H, true) + 40, ...sc.points.map((p) => measure(p.text, FS_P, false) + 56));
  }
  w = Math.ceil(w + MARGIN * 2);
  const h = Math.ceil(MARGIN * 2 + scenes.reduce((a, sc) => a + HEAD_H + sc.points.length * ROW_H + GAP, 0));
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
  void title;
  return canvas.toBytes();
}

// FR-016 AC-089: 整理の表示の PNG（軸の名前・区分の見出し・未分類の領域・各オブジェクトを、整理の配置どおりに描く）
async function renderArrangedPng(scenes, model, canvasFactory) {
  const g = model.geometry;
  const font = (px, bold) => `${bold ? '700 ' : ''}${px}px system-ui, 'Hiragino Sans', 'Yu Gothic UI', Meiryo, sans-serif`;
  const canvas = canvasFactory(g.width, g.height);
  const c = canvas.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, g.width, g.height);
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
  ctx.registerCommand('save.svg', () => run('svg', 'image/svg+xml', () => ctx.api.renderSvg()));
  ctx.registerCommand('save.pdf', () => run('pdf', 'application/pdf', () => buildPdf(scenes(), { title: ctx.t('app.title'), arrange: arranged() })));
  ctx.registerCommand('save.png', () => run('png', 'image/png', async () => {
    const factory = ctx.options.canvasFactory ?? browserCanvasFactory();
    if (!factory) throw new Error('no canvas');
    return renderPng(scenes(), factory, { arrange: arranged() });
  }));
}
