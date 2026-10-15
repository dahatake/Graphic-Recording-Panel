// FR-016 意味のある配置による 2D 整理（契約: tests/system/CONTRACT.md「意味のある配置による 2D 整理」）。
// 縦軸・横軸の区分にオブジェクト（要点・シーン）を割り当てて並べる「整理の表示」と、時系列の表示を切り替える。
// 状態は ctx.state.displayMode / ctx.state.arrange に持ち、セッションの保存（persist.js）で復元される。DOM に依存しない。

export const PRESET_ID = 'logical-physical_workflow';
export const DISPLAY_MODES = ['timeline', 'arrange'];
export const AXES = ['vertical', 'horizontal'];

const MARGIN = 24; const ROWHEAD_W = 150; const HEADER_H = 76; const ITEM_H = 52; const ITEM_PAD = 8; const MIN_COL_W = 240; const MIN_ROW_H = 72;

function tw(s, size) {
  let w = 0;
  for (const ch of String(s)) w += ch.codePointAt(0) >= 0x2e80 ? size : size * 0.56;
  return w;
}

// 既定の組。名前・区分は文言キー（key）で持ち、表示言語に追従する。利用者が編集すると label / name の文字列に置き換わる。
export function presetArrange() {
  const secs = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i + 1}`, key: `arrange.${p}.${i + 1}` }));
  return {
    presetId: PRESET_ID,
    axes: {
      vertical: { nameKey: 'arrange.axis.v.name', sections: secs('v', 4) },
      horizontal: { nameKey: 'arrange.axis.h.name', sections: secs('h', 4) },
    },
    assignments: {},
    idSeq: 100,
  };
}

// 保存された整理の状態の検証（壊れていれば既定）
export function parseArrange(raw) {
  const def = presetArrange();
  if (!raw || typeof raw !== 'object') return def;
  const isStr = (v) => typeof v === 'string' && v.trim() !== '';
  const axis = (a) => {
    if (!a || typeof a !== 'object' || !Array.isArray(a.sections) || a.sections.length < 2) return null;
    if (!(isStr(a.name) || isStr(a.nameKey))) return null;
    const sections = a.sections.map((s) => (s && isStr(s.id) && (isStr(s.label) || isStr(s.key)) ? { id: s.id, ...(isStr(s.label) ? { label: s.label } : { key: s.key }) } : null));
    if (sections.some((s) => !s) || new Set(sections.map((s) => s.id)).size !== sections.length) return null;
    return { ...(isStr(a.name) ? { name: a.name } : { nameKey: a.nameKey }), sections };
  };
  const v = axis(raw.axes?.vertical); const h = axis(raw.axes?.horizontal);
  if (!v || !h) return def;
  const vIds = new Set(v.sections.map((s) => s.id)); const hIds = new Set(h.sections.map((s) => s.id));
  const assignments = {};
  for (const [id, a] of Object.entries(raw.assignments && typeof raw.assignments === 'object' ? raw.assignments : {})) {
    if (!a || typeof a !== 'object') continue;
    const av = vIds.has(a.v) ? a.v : null; const ah = hIds.has(a.h) ? a.h : null;
    if (av || ah) assignments[id] = { v: av, h: ah };
  }
  return {
    presetId: isStr(raw.presetId) ? raw.presetId : PRESET_ID, axes: { vertical: v, horizontal: h }, assignments,
    idSeq: Number.isInteger(raw.idSeq) && raw.idSeq >= 100 ? raw.idSeq : 100,
  };
}

export function arrangeModule(ctx) {
  ctx.i18n.addStrings({
    ja: {
      'arrange.preset.lp_wf': '論理→物理層 × ワークフロー／部署のステップ',
      'arrange.axis.v.name': '論理層→物理層', 'arrange.axis.h.name': 'ワークフロー／部署のステップ',
      'arrange.v.1': '論理層（業務・目的）', 'arrange.v.2': '機能層（画面・処理）', 'arrange.v.3': 'データ層（情報・API）', 'arrange.v.4': '物理層（基盤・機器）',
      'arrange.h.1': 'ステップ1 受付（営業部）', 'arrange.h.2': 'ステップ2 審査（管理部）', 'arrange.h.3': 'ステップ3 実行（運用部）', 'arrange.h.4': 'ステップ4 確認（品質部）',
      'arrange.unclassified': '未分類',
      'arrange.axis.vertical': '縦軸', 'arrange.axis.horizontal': '横軸',
      'arrange.reason': '位置の理由', 'arrange.breakdown': '内訳', 'arrange.countUnit': '件',
      'view.name.timeline': '時系列', 'view.name.arrange': '整理',
      'arrange.outline.heading': '整理の表示',
    },
    en: {
      'arrange.preset.lp_wf': 'Logical→physical layers × workflow / department steps',
      'arrange.axis.v.name': 'Logical → physical layers', 'arrange.axis.h.name': 'Workflow / department steps',
      'arrange.v.1': 'Logical (business goals)', 'arrange.v.2': 'Function (screens, logic)', 'arrange.v.3': 'Data (information, API)', 'arrange.v.4': 'Physical (infrastructure)',
      'arrange.h.1': 'Step 1 Intake (Sales)', 'arrange.h.2': 'Step 2 Review (Admin)', 'arrange.h.3': 'Step 3 Execute (Operations)', 'arrange.h.4': 'Step 4 Check (Quality)',
      'arrange.unclassified': 'Unclassified',
      'arrange.axis.vertical': 'Vertical axis', 'arrange.axis.horizontal': 'Horizontal axis',
      'arrange.reason': 'Why here', 'arrange.breakdown': 'Breakdown', 'arrange.countUnit': ' pt',
      'view.name.timeline': 'Timeline', 'view.name.arrange': 'Arranged',
      'arrange.outline.heading': 'Arranged layout',
    },
  });
  const api = ctx.api;
  const st = ctx.state;
  st.displayMode = DISPLAY_MODES.includes(st.displayMode) ? st.displayMode : 'timeline';
  st.arrange = parseArrange(st.arrange);
  const t = ctx.t;

  const axisName = (a) => a.name ?? t(a.nameKey);
  const secLabel = (s) => s.label ?? t(s.key);
  const unLabel = () => t('arrange.unclassified');
  const objects = () => st.scenes.flatMap((s) => [{ id: s.id, kind: 'scene', text: s.heading }, ...s.points.map((p) => ({ id: p.id, kind: 'point', text: p.text }))]);
  const level = () => api.getDetailLevel?.() ?? 'detail';
  // FR-026 AC-137: 詳細度が「大項目」「中項目」のとき図に描かれる単位（トピック、中項目ではシーンの見出し）
  const unitObjects = () => {
    const lv = level();
    if (lv === 'detail') return [];
    return api.getTopics().flatMap((tp) => [
      { id: tp.id, kind: 'topic', text: tp.title, pointIds: tp.pointIds },
      ...(lv === 'middle' ? tp.sceneIds.map((sid) => { const sc = st.scenes.find((s) => s.id === sid); return { id: sid, kind: 'scene', text: sc.heading, pointIds: sc.points.map((p) => p.id) }; }) : []),
    ]);
  };
  const drawnObjects = () => (level() === 'detail' ? objects() : unitObjects());
  const find = (id) => objects().find((o) => o.id === id) ?? unitObjects().find((o) => o.id === id) ?? null;
  const assignOf = (id) => {
    const a = st.arrange.assignments[id] ?? {};
    const { vertical: V, horizontal: H } = st.arrange.axes;
    return { v: V.sections.some((s) => s.id === a.v) ? a.v : null, h: H.sections.some((s) => s.id === a.h) ? a.h : null };
  };
  // 属する要点の割り当てのうち最も多い区分（同数のときは区分の並び順で先のもの）。内訳は区分の組ごとの件数。
  function unitAssign(pointIds) {
    const { vertical: V, horizontal: H } = st.arrange.axes;
    const as = pointIds.map(assignOf);
    const top = (A, k) => {
      let best = null; let n = 0;
      for (const s of A.sections) { const c = as.filter((a) => a[k] === s.id).length; if (c > n) { best = s.id; n = c; } }
      return best;
    };
    const rows = new Map();
    for (const a of as) { const key = `${a.v}|${a.h}`; rows.set(key, { v: a.v, h: a.h, count: (rows.get(key)?.count ?? 0) + 1 }); }
    const ord = (A, id) => (id ? A.sections.findIndex((s) => s.id === id) : A.sections.length);
    const breakdown = [...rows.values()].sort((x, y) => ord(V, x.v) - ord(V, y.v) || ord(H, x.h) - ord(H, y.h));
    return { v: top(V, 'v'), h: top(H, 'h'), breakdown };
  }
  const isUnit = (o) => o.kind === 'topic' || (o.kind === 'scene' && level() !== 'detail');
  const assignFor = (o) => {
    if (o.kind === 'topic') return unitAssign(o.pointIds);
    if (isUnit(o)) return unitAssign(st.scenes.find((s) => s.id === o.id)?.points.map((p) => p.id) ?? []);
    return assignOf(o.id);
  };

  function describe(id) {
    const o = find(id);
    if (!o) return null;
    const unit = o.kind === 'topic' || (o.kind === 'scene' && level() === 'middle');
    const ua = unit ? assignFor(o.kind === 'topic' ? o : { ...o, kind: 'scene' }) : null;
    const a = ua ?? assignOf(id); const { vertical: V, horizontal: H } = st.arrange.axes;
    const vs = V.sections.find((s) => s.id === a.v); const hs = H.sections.find((s) => s.id === a.h);
    const vertical = vs ? secLabel(vs) : null; const horizontal = hs ? secLabel(hs) : null;
    const part = (axisKey, A, label) => `${t(`arrange.axis.${axisKey}`)}「${axisName(A)}」: ${label ?? unLabel()}`;
    let text = `${t('arrange.reason')}: ${part('vertical', V, vertical)} / ${part('horizontal', H, horizontal)}`;
    if (ua) {
      const lab = (A, v) => { const s = A.sections.find((x) => x.id === v); return s ? secLabel(s) : unLabel(); };
      const items = ua.breakdown.map((b) => `${lab(V, b.v)}・${lab(H, b.h)} ${b.count}${t('arrange.countUnit')}`);
      text += ` / ${t('arrange.breakdown')}: ${items.length ? items.join('、') : `0${t('arrange.countUnit')}`}`;
    }
    return { vertical, horizontal, text };
  }

  // 位置の計算（時系列の順に、区分ごとに上から積む）。未分類は縦・横それぞれ最後の行・列。
  function layout() {
    const { vertical: V, horizontal: H } = st.arrange.axes;
    const nv = V.sections.length; const nh = H.sections.length;
    const cells = new Map();
    const items = drawnObjects().map((o) => {
      const a = assignFor(o);
      const ri = a.v ? V.sections.findIndex((s) => s.id === a.v) : nv;
      const ci = a.h ? H.sections.findIndex((s) => s.id === a.h) : nh;
      const key = `${ri}:${ci}`;
      const idx = cells.get(key) ?? 0; cells.set(key, idx + 1);
      return { ...o, ri, ci, idx, unclassified: !a.v && !a.h, reason: describe(o.id).text, a };
    });
    const colW = Array.from({ length: nh + 1 }, () => MIN_COL_W);
    for (const it of items) colW[it.ci] = Math.max(colW[it.ci], Math.ceil((it.kind !== 'point' ? tw(it.text, 16) + 50 : tw(it.text, 14) + 70) + 20));
    for (let j = 0; j <= nh; j++) {
      const label = j < nh ? secLabel(H.sections[j]) : unLabel();
      colW[j] = Math.max(colW[j], Math.ceil(tw(label, 14) + 24));
    }
    const rowH = Array.from({ length: nv + 1 }, (_, i) => {
      const n = Math.max(0, ...items.filter((it) => it.ri === i).map((it) => it.idx + 1));
      return Math.max(MIN_ROW_H, n * ITEM_H + ITEM_PAD * 2);
    });
    const top = MARGIN + HEADER_H;
    const colX = []; let x = MARGIN + ROWHEAD_W;
    for (const w of colW) { colX.push(x); x += w; }
    const rowY = []; let y = top;
    for (const h of rowH) { rowY.push(y); y += h; }
    const width = x + MARGIN; const height = y + MARGIN;
    const out = items.map((it) => ({
      id: it.id, kind: it.kind, text: it.text, unclassified: it.unclassified, reason: it.reason,
      x: colX[it.ci] + 10, y: rowY[it.ri] + ITEM_PAD + it.idx * ITEM_H, w: colW[it.ci] - 20, h: it.kind !== 'point' ? 36 : 38,
    }));
    return {
      margin: MARGIN, top, width, height,
      cols: [...H.sections.map((s, i) => ({ id: s.id, label: secLabel(s), x: colX[i], w: colW[i] })), { id: null, label: unLabel(), x: colX[nh], w: colW[nh] }],
      rows: [...V.sections.map((s, i) => ({ id: s.id, label: secLabel(s), y: rowY[i], h: rowH[i] })), { id: null, label: unLabel(), y: rowY[nv], h: rowH[nv] }],
      items: out,
    };
  }

  api.getDisplayMode = () => st.displayMode;
  api.setDisplayMode = (mode) => {
    if (!DISPLAY_MODES.includes(mode)) return false;
    if (st.displayMode !== mode) ctx.change((s) => { s.displayMode = mode; });
    return true;
  };
  api.setArrangePreset = (id) => {
    if (id !== PRESET_ID) return { ok: false };
    ctx.change((s) => { s.arrange = parseArrange({ ...presetArrange(), assignments: s.arrange.assignments, idSeq: s.arrange.idSeq }); });
    return { ok: true };
  };
  api.getArrangement = () => {
    const { vertical: V, horizontal: H } = st.arrange.axes;
    const g = layout();
    const pos = new Map(g.items.map((i) => [i.id, { x: i.x, y: i.y }]));
    const ax = (A) => ({ name: axisName(A), sections: A.sections.map((s) => ({ id: s.id, label: secLabel(s) })) });
    return {
      mode: st.displayMode,
      presets: [{ id: PRESET_ID, label: t('arrange.preset.lp_wf') }],
      presetId: st.arrange.presetId,
      axes: { vertical: ax(V), horizontal: ax(H) },
      axisLabels: { vertical: t('arrange.axis.vertical'), horizontal: t('arrange.axis.horizontal') },
      unclassified: { label: unLabel() },
      assignments: [
        ...unitObjects().map((o) => {
          const a = assignFor(o);
          return { objectId: o.id, kind: o.kind, v: a.v, h: a.h, unclassified: !a.v && !a.h, position: pos.get(o.id), breakdown: a.breakdown };
        }),
        ...objects().filter((o) => level() === 'detail' || o.kind === 'point').map((o) => {
          const a = assignOf(o.id);
          return { objectId: o.id, kind: o.kind, v: a.v, h: a.h, unclassified: !a.v && !a.h, position: pos.get(o.id) };
        }),
      ],
      geometry: g,
    };
  };
  api.setAxis = (axis, def) => {
    const A = st.arrange.axes[axis];
    const name = typeof def?.name === 'string' ? def.name.trim() : '';
    const labels = Array.isArray(def?.sections) ? def.sections.map((x) => String(x ?? '').trim()) : [];
    if (!A || !name || labels.length < 2 || labels.some((x) => !x)) return { ok: false, reason: 'invalid' };
    ctx.change((s) => {
      const cur = s.arrange.axes[axis];
      let seq = s.arrange.idSeq;
      const sections = labels.map((label, i) => ({ id: cur.sections[i]?.id ?? `${axis[0]}${++seq}`, label }));
      s.arrange.idSeq = seq;
      s.arrange.axes[axis] = { name, sections };
      const ids = new Set(sections.map((x) => x.id)); const k = axis === 'vertical' ? 'v' : 'h';
      for (const [id, a] of Object.entries(s.arrange.assignments)) {
        if (a[k] && !ids.has(a[k])) a[k] = null;
        if (!a.v && !a.h) delete s.arrange.assignments[id];
      }
    });
    return { ok: true };
  };
  api.assignObject = (objectId, def) => {
    if (!objects().some((o) => o.id === objectId)) return { ok: false, reason: 'no_object' };
    const { vertical: V, horizontal: H } = st.arrange.axes;
    const cur = assignOf(objectId);
    const pick = (val, A, keep) => (val === undefined ? keep : (val === null ? null : (A.sections.some((s) => s.id === val) ? val : false)));
    const v = pick(def?.v, V, cur.v); const h = pick(def?.h, H, cur.h);
    if (v === false || h === false) return { ok: false, reason: 'no_section' };
    ctx.change((s) => { if (v || h) s.arrange.assignments[objectId] = { v, h }; else delete s.arrange.assignments[objectId]; });
    return { ok: true };
  };
  api.describeObject = (objectId) => describe(objectId);
  const DIRS = { 'section-up': ['v', -1], 'section-down': ['v', 1], 'section-left': ['h', -1], 'section-right': ['h', 1] };
  api.arrangeCommand = (objectId, name) => {
    const d = DIRS[name];
    if (!d || !objects().some((o) => o.id === objectId)) return { ok: false, reason: 'invalid' };
    const [k, step] = d;
    const A = st.arrange.axes[k === 'v' ? 'vertical' : 'horizontal'];
    const cur = assignOf(objectId)[k];
    const i = cur ? A.sections.findIndex((s) => s.id === cur) : -1;
    const ni = i < 0 ? (step > 0 ? 0 : -1) : i + step;
    if (ni < 0 || ni >= A.sections.length) return { ok: false, reason: 'edge' };
    return api.assignObject(objectId, { [k]: A.sections[ni].id });
  };

  // テキスト一覧（NFR-A11Y-001）への文字表示。順序は常に時系列（renderOutline は触らない）。
  api.getOutlineAnnotation = () => {
    if (st.displayMode !== 'arrange') return null;
    const { vertical: V, horizontal: H } = st.arrange.axes;
    return {
      header: `${t('arrange.outline.heading')}: ${t('arrange.axis.vertical')}「${axisName(V)}」 × ${t('arrange.axis.horizontal')}「${axisName(H)}」 (${V.sections.map(secLabel).join(' / ')} ｜ ${H.sections.map(secLabel).join(' / ')} ｜ ${unLabel()})`,
      of: (id) => describe(id)?.text ?? '',
    };
  };

  ctx.registerCommand('view.timeline', () => { api.setDisplayMode('timeline'); });
  ctx.registerCommand('view.arrange', () => { api.setDisplayMode('arrange'); });
  const target = () => api.getHighlight?.()?.pointId ?? null;
  for (const [cmd, dir] of [['arrange.up', 'section-up'], ['arrange.down', 'section-down'], ['arrange.left', 'section-left'], ['arrange.right', 'section-right']]) {
    ctx.registerCommand(cmd, () => { const id = target(); if (id) api.arrangeCommand(id, dir); });
  }
  const CAS = { alt: true, shift: true, ctrl: true };
  ctx.registerKey({ key: 'a', alt: true, shift: true, command: 'view.arrange' });
  ctx.registerKey({ key: 'q', alt: true, shift: true, command: 'view.timeline' });
  ctx.registerKey({ key: 'ArrowUp', ...CAS, command: 'arrange.up' });
  ctx.registerKey({ key: 'ArrowDown', ...CAS, command: 'arrange.down' });
  ctx.registerKey({ key: 'ArrowLeft', ...CAS, command: 'arrange.left' });
  ctx.registerKey({ key: 'ArrowRight', ...CAS, command: 'arrange.right' });
}
