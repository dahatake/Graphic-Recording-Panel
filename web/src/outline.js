// NFR-A11Y-001 AC-035 AC-037: 図と同じ順序の、見出し・要点のテキスト一覧（HTML 文字列）。
// 状態（進行中/確定）と選択中は、色ではなく文字と記号（形）で示す。

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 状態の記号: 進行中=○ 確定=● 選択中=▶
export const STATUS_MARK = { in_progress: '○', confirmed: '●' };
export const SELECTED_MARK = '▶';

export function renderOutline(scenes, selectedSceneId, t, annot = null) {
  if (!scenes.length) return `<p class="outline-empty">${escapeHtml(t('outline.empty'))}</p>`;
  // FR-016 AC-082: 整理の表示では軸・区分・割り当てを文字で添える（順序は常に時系列）
  const note = (id) => (annot ? ` <span class="outline-arrange">[${escapeHtml(annot.of(id))}]</span>` : '');
  const items = scenes.map((s) => {
    const sel = s.id === selectedSceneId;
    const status = `<span class="badge badge-${escapeHtml(s.status)}"><span aria-hidden="true">${STATUS_MARK[s.status] ?? ''}</span> ${escapeHtml(t(`scene.status.${s.status}`))}</span>`;
    const selected = sel ? ` <span class="badge badge-selected"><span aria-hidden="true">${SELECTED_MARK}</span> ${escapeHtml(t('scene.selected'))}</span>` : '';
    const pts = s.points.map((p) => `<li data-point-id="${escapeHtml(p.id)}">${escapeHtml(p.text)}${note(p.id)}</li>`).join('');
    return `<li class="outline-scene${sel ? ' is-selected' : ''}" data-scene-id="${escapeHtml(s.id)}"${sel ? ' aria-current="true"' : ''}>`
      + `<h3>${escapeHtml(s.heading)}</h3>${note(s.id)} ${status}${selected}<ul>${pts}</ul></li>`;
  });
  const head = annot ? `<p class="outline-arrange-head">${escapeHtml(annot.header)}</p>` : '';
  return `${head}<ol class="outline">${items.join('')}</ol>`;
}
