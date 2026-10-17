// NFR-A11Y-001 AC-035 AC-037: 図と同じ順序の、見出し・要点のテキスト一覧（HTML 文字列）。
// 状態（進行中/確定）と選択中は、色ではなく文字と記号（形）で示す。

const EVIDENCE_MAX = 40; // PARAM-033: 根拠の語の最大文字数（FR-054 AC-235）

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 状態の記号: 進行中=○ 確定=● 選択中=▶
export const STATUS_MARK = { in_progress: '○', confirmed: '●' };
export const SELECTED_MARK = '▶';

export function renderOutline(scenes, selectedSceneId, t, annot = null, topics = null, kinds = null) {
  if (!scenes.length) return `<p class="outline-empty">${escapeHtml(t('outline.empty'))}</p>`;
  // FR-025 AC-129 AC-135: トピック（大項目）→ シーン（中項目）の階層とトピック間の関係を文字で示す（要点・関係線・絵記号は下の一覧）
  const topicBlock = topics ? `<section class="outline-topics" aria-label="${escapeHtml(topics.heading)}"><h2>${escapeHtml(topics.heading)}</h2><ol>`
    + topics.topics.map((tp) => `<li class="outline-topic">${escapeHtml(tp.title)}${tp.containsSelected ? ` <span class="badge badge-selected"><span aria-hidden="true">${SELECTED_MARK}</span> ${escapeHtml(t('topic.selected'))}</span>` : ''}<ul>${tp.scenes.map((s) => `<li>${escapeHtml(s.heading)}</li>`).join('')}</ul></li>`).join('')
    + `</ol>${topics.relations.length ? `<ul class="outline-topic-relations">${topics.relations.map((r) => `<li>${escapeHtml(r.text)}</li>`).join('')}</ul>` : ''}</section>` : '';
  // FR-016 AC-082: 整理の表示では軸・区分・割り当てを文字で添える（順序は常に時系列）
  const note = (id) => (annot ? ` <span class="outline-arrange">[${escapeHtml(annot.of(id))}]</span>` : '');
  const items = scenes.map((s) => {
    const sel = s.id === selectedSceneId;
    const status = `<span class="badge badge-${escapeHtml(s.status)}"><span aria-hidden="true">${STATUS_MARK[s.status] ?? ''}</span> ${escapeHtml(t(`scene.status.${s.status}`))}</span>`;
    const selected = sel ? ` <span class="badge badge-selected"><span aria-hidden="true">${SELECTED_MARK}</span> ${escapeHtml(t('scene.selected'))}</span>` : '';
    const pts = s.points.map((p) => `<li data-point-id="${escapeHtml(p.id)}">${kinds ? `<span class="badge badge-kind">${escapeHtml(kinds.label(p.text))}</span> ` : ''}${escapeHtml(p.text)}${note(p.id)}</li>`).join('');
    return `<li class="outline-scene${sel ? ' is-selected' : ''}" data-scene-id="${escapeHtml(s.id)}"${sel ? ' aria-current="true"' : ''}>`
      + `<h3>${escapeHtml(s.heading)}</h3>${note(s.id)} ${status}${selected}<ul>${pts}</ul></li>`;
  });
  const head = annot ? `<p class="outline-arrange-head">${escapeHtml(annot.header)}</p>` : '';
  // FR-052 AC-231 / FR-053: 要点の種類のラベル（kinds.label）と、関係（kinds.relations）を文字で示す
  const texts = new Map(scenes.flatMap((s) => s.points).map((p) => [p.id, p.text]));
  const relBlock = kinds?.relations?.length ? `<ul class="outline-relations">${kinds.relations.map((r) => `<li data-relation-from="${escapeHtml(r.from)}" data-relation-to="${escapeHtml(r.to)}" data-relation-kind="${escapeHtml(r.kind)}" data-relation-basis="${escapeHtml(r.basis)}">${escapeHtml(r.kindLabel)}: ${escapeHtml(texts.get(r.from) ?? '')} → ${escapeHtml(texts.get(r.to) ?? '')} （${escapeHtml(r.basisLabel)}${r.evidence ? `: ${escapeHtml([...String(r.evidence.text)].slice(0, EVIDENCE_MAX).join(''))}` : ''}）</li>`).join('')}</ul>` : '';
  return `${topicBlock}${head}<ol class="outline">${items.join('')}</ol>${relBlock}`;
}
