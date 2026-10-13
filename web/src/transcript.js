// FR-013 右パネルの認識文字列 / FR-014 暫定結果と確定結果の区別（契約: tests/system/CONTRACT.md「右パネル・暫定結果・リアルタイム反映」）。
// 右パネルは既存のパネル 'input'。確定結果（音声・ファイル取込）の一覧をここで持ち、暫定結果は speech.js の state.speech.interim を読む。
// 図への反映は addUtterance(s) が同期で行う（NFR-PERF-001 の 3 秒以内を満たす）。DOM に依存しない。

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function transcriptModule(ctx) {
  ctx.i18n.addStrings({
    ja: { 'transcript.interim': '暫定', 'transcript.final': '確定', 'transcript.empty': 'まだ認識文字列はありません' },
    en: { 'transcript.interim': 'Interim', 'transcript.final': 'Final', 'transcript.empty': 'No transcript yet' },
  });
  const finals = [];
  let n = 0;
  // 確定結果の一覧への追加（受け付けられた文字列だけを呼び出し側が渡す）
  ctx.transcript = {
    addFinals(texts) {
      for (const t of texts) finals.push({ id: `t${++n}`, text: String(t) });
      ctx.emit('change', ctx.api);
    },
    clear() { finals.length = 0; },
  };
  ctx.api.getTranscript = () => {
    const raw = ctx.state.speech?.interim;
    const interim = ctx.state.session === 'recording' && raw ? String(raw) : null;
    return { heading: ctx.t('panel.input'), interim, finals: finals.map((f) => ({ ...f })) };
  };
  ctx.api.renderTranscript = () => {
    const t = ctx.api.getTranscript();
    const items = t.finals.map((f) => `<li class="transcript-item final" data-kind="final" data-id="${esc(f.id)}">${esc(f.text)}</li>`).join('');
    const interim = t.interim
      ? `<p class="transcript-item interim" data-kind="interim"><span class="transcript-tag">${esc(ctx.t('transcript.interim'))}</span> ${esc(t.interim)}</p>`
      : '';
    const empty = !t.finals.length && !t.interim ? `<p class="transcript-empty">${esc(ctx.t('transcript.empty'))}</p>` : '';
    return `<div class="transcript"><h3 class="transcript-heading">${esc(t.heading)}</h3>`
      + `<ol class="transcript-list" role="log" aria-live="polite" aria-label="${esc(t.heading)}">${items}</ol>${interim}${empty}</div>`;
  };
}
