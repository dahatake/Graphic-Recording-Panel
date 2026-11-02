// FR-106 AC-612〜616: 投票と評価の基準（単一端末での代理入力）。契約: tests/system/CONTRACT-P2.md「投票」。
// - 票は利用者が代理入力する（共同編集・ネットワーク投票は対象外）。投票者は任意のラベル（空は「投票者 n」の連番）で、話者の識別・認証ではなく発話に結びつけない（FR-107）。
// - 持ち票数は投票者 1 人あたり（既定 PARAM-143）。集計は投票者を合算する。位置づけは「参考」（既定）か「決定」。
// - 評価の基準は 目標への適合・影響・実現性・リスク（PARAM-144）。段階は 1〜5。評価しない基準は「未評価」（自動で補わない）。
// - 集計は決定的な純関数（computeTally）。同点は同順位。リスク評価が PARAM-145 以上は「重大なリスク」。少数意見・重大なリスクは票数だけで却下しない注記を常に出す。
// - 「決定」の結果は決定事項（FR-094）の候補になるだけで、利用者の確定の操作なしに確定にならない（AC-553）。「参考」は候補にしない。
// - 機密（FR-104）: 由来の要点が機密の選択肢が 1 つでもあれば、「除く」保存の出力に投票の行を載せず、決定の候補・確定した項目も議事項目から除く。
// - 保存・復元・初期化は registerPersist。生成 AI へは何も送らない（外部通信 0 件）。
import { escapeHtml } from './outline.js';

export const DEFAULT_VOTES_PER_PERSON = 3; // PARAM-143
export const CRITERIA = ['fit', 'impact', 'feasibility', 'risk']; // PARAM-144
export const CRITICAL_RISK_MIN = 4; // PARAM-145
export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const VOTE_RESULT_ID = 'vote-result';
const OPTION_MAX = 20;
const VOTER_MAX = 20;
const VOTES_MAX = 99;
const LABEL_MAX = 100;
const VOTER_LABEL_MAX = 40;

const W = {
  ja: {
    title: '投票と評価', reference: '参考', decision: '決定', decisionCandidate: '決定（候補）', votes: '票', unrated: '未評価', critical: '重大なリスク', none: 'なし',
    fit: '目標への適合', impact: '影響', feasibility: '実現性', risk: 'リスク', voter: (n) => `投票者 ${n}`, rank: (n) => `${n} 位`, tie: '同順位',
    notice: '少数意見・重大なリスクは票数だけで却下しない', noticeLabel: '注記', rules: (n) => `持ち票数は投票者 1 人あたり ${n} 票です。1 つの選択肢には、持ち票数の範囲で何票でも入れられます。票は利用者が代理で入力します。同点は同順位として示し、自動では決めません。`,
    stanceLabel: '票の位置づけ', ruleLabel: '規則', perPerson: '投票者 1 人あたりの持ち票数', used: '使った票', remaining: '残り票', average: '平均', result: '結果', ratings: '評価',
    overVotes: '持ち票数を超える票は入れられません', noVotes: '取り消せる票がありません', topLine: (s) => `投票（${s}）`, candidateText: (s, names, v, crit) => `投票の結果（${s}）: ${names}（${v} 票${crit ? '。重大なリスクの印あり' : ''}）`,
  },
  en: {
    title: 'Vote and evaluation', reference: 'Reference', decision: 'Decision', decisionCandidate: 'Decision (candidate)', votes: 'votes', unrated: 'Not rated', critical: 'Critical risk', none: 'None',
    fit: 'Fit to the goal', impact: 'Impact', feasibility: 'Feasibility', risk: 'Risk', voter: (n) => `Voter ${n}`, rank: (n) => `Rank ${n}`, tie: 'Tied',
    notice: 'Minority opinions and critical risks are not rejected by vote count alone', noticeLabel: 'Note', rules: (n) => `Each voter has ${n} votes. A voter may put any number of votes on one option, up to the votes held. Votes are entered by the user on behalf of voters. Ties are shown as the same rank and are not decided automatically.`,
    stanceLabel: 'Meaning of the votes', ruleLabel: 'Rules', perPerson: 'Votes per voter', used: 'Votes used', remaining: 'Votes left', average: 'Average', result: 'Result', ratings: 'Ratings',
    overVotes: 'Votes beyond the votes held cannot be cast', noVotes: 'There is no vote to retract', topLine: (s) => `Vote (${s})`, candidateText: (s, names, v, crit) => `Vote result (${s}): ${names} (${v} votes${crit ? '; marked as a critical risk' : ''})`,
  },
};
const words = (lang) => W[lang === 'en' ? 'en' : 'ja'];

// 集計（決定的な純関数）。options:[{id}]、ballots:{voterId:{optionId:n}}、ratings:{optionId:{criterion:1..5}}。
// 並びは票数の降順・同票は入力順。同点は同順位（1,2,2,4）。avg は未評価を除く（評価がなければ null）。
export function computeTally(options, ballots, ratings) {
  const rows = options.map((o, i) => {
    let votes = 0;
    for (const b of Object.values(ballots ?? {})) votes += Number(b?.[o.id]) || 0;
    const avg = {};
    for (const c of CRITERIA) { const r = ratings?.[o.id]?.[c]; avg[c] = Number.isInteger(r) && r >= RATING_MIN && r <= RATING_MAX ? r : null; }
    return { optionId: o.id, votes, avg, i };
  });
  rows.sort((a, b) => b.votes - a.votes || a.i - b.i);
  let rank = 0;
  const ranking = rows.map((r, k) => { if (k === 0 || r.votes !== rows[k - 1].votes) rank = k + 1; return { optionId: r.optionId, votes: r.votes, rank, avg: r.avg, tie: false }; });
  for (const r of ranking) r.tie = ranking.filter((x) => x.rank === r.rank).length > 1;
  return { ranking, tie: ranking.some((r) => r.tie) };
}
export const isCriticalRisk = (risk) => Number.isInteger(risk) && risk >= CRITICAL_RISK_MIN;

const cleanLabel = (s, max) => [...String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim()].slice(0, max).join('');

export function voteModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'vote.title': '投票と評価', 'vote.close': '閉じる', 'vote.start': '投票を始める', 'vote.end': '投票をやり直す（消去）', 'vote.optionsLabel': '選択肢（1 行に 1 つ。2 つ以上）', 'vote.votersLabel': '投票者（1 行に 1 人。空欄は連番。任意）',
      'vote.perPersonLabel': '投票者 1 人あたりの持ち票数', 'vote.voterSelect': '票を入れる投票者', 'vote.cast': '票を入れる', 'vote.retract': '票を取り消す', 'vote.tally': '集計する', 'vote.concern': '注記・印を異論・懸念に記録',
      'vote.stance': '票の位置づけ', 'vote.stanceReference': '参考', 'vote.stanceDecision': '決定', 'vote.used': '使った票', 'vote.votesWord': ' 票', 'vote.ratingOf': '評価', 'vote.hint': '票も評価も代理入力です。Tab で移動し、Enter で押します。Esc で閉じます。', 'vote.setupHint': '投票の前に、持ち票数と規則を確かめてください。',
      'msg.voteOpen': '投票の画面を開きました', 'msg.voteClosed': '投票の画面を閉じました', 'msg.voteStarted': '投票を始めました', 'msg.voteTallied': '集計しました', 'msg.voteNone': '投票がありません。先に投票を始めてください', 'msg.voteEnded': '投票を消去しました',
      'msg.voteConcern': '注記を異論・懸念に記録しました', 'msg.voteCast': '票を入れました', 'msg.voteRetracted': '票を取り消しました',
    },
    en: {
      'vote.title': 'Vote and evaluation', 'vote.close': 'Close', 'vote.start': 'Start the vote', 'vote.end': 'Start over (clear)', 'vote.optionsLabel': 'Options (one per line, at least two)', 'vote.votersLabel': 'Voters (one per line; blank for a number; optional)',
      'vote.perPersonLabel': 'Votes per voter', 'vote.voterSelect': 'Voter casting the vote', 'vote.cast': 'Cast a vote', 'vote.retract': 'Retract a vote', 'vote.tally': 'Tally', 'vote.concern': 'Record the note as an objection or concern',
      'vote.stance': 'Meaning of the votes', 'vote.stanceReference': 'Reference', 'vote.stanceDecision': 'Decision', 'vote.used': 'Votes used', 'vote.votesWord': ' votes', 'vote.ratingOf': 'Rating', 'vote.hint': 'Votes and ratings are entered on behalf of voters. Move with Tab, press with Enter, close with Esc.', 'vote.setupHint': 'Check the votes held and the rules before voting.',
      'msg.voteOpen': 'The vote view was opened', 'msg.voteClosed': 'The vote view was closed', 'msg.voteStarted': 'The vote was started', 'msg.voteTallied': 'The votes were tallied', 'msg.voteNone': 'There is no vote. Start a vote first', 'msg.voteEnded': 'The vote was cleared',
      'msg.voteConcern': 'The note was recorded as an objection or concern', 'msg.voteCast': 'A vote was cast',       'msg.voteRetracted': 'A vote was retracted',
          },
        });
  // 状態: null | { options:[{id,label,pointId?}], voters:[{id,label}], votesPerPerson, stance, ballots, ratings, tallied, decision:'candidate'|'rejected'|'confirmed', confirmedItemId, concern, seq }
  let vote = null;
  let uiOpen = false;
  const lang = () => state.lang;
  const fail = (reason, extra) => ({ ok: false, reason, ...extra });
  const findPoint = (id) => { for (const s of state.scenes) { const p = s.points.find((q) => q.id === id); if (p) return p; } return null; };
  const exporting = () => !!api.getVisibilityLines?.()?.excludedLine;
  // 機密の選択肢: 由来の要点が機密。「除く」保存の作成中は、機密の要点が写しから除かれるので、見つからない要点も機密として扱う（伏せる側に倒す）
  const isConf = (o) => { if (!o.pointId) return false; const p = findPoint(o.pointId); return p ? p.confidential === true : exporting(); };
  const voterLabel = (v, i) => v.label || words(lang()).voter(i + 1);
  const usedBy = (voterId) => Object.values(vote.ballots[voterId] ?? {}).reduce((a, n) => a + n, 0);
  const touch = () => { vote.tallied = false; }; // 票・評価が変わったら、古い結果は捨てる（決定的に作り直せる）
  const resultOf = () => (vote.tallied ? computeTally(vote.options, vote.ballots, vote.ratings) : null);
  const stanceLabel = (s = vote.stance, forResult = false) => { const w = words(lang()); return s === 'decision' ? (forResult ? w.decisionCandidate : w.decision) : w.reference; };

  const ratingTextOf = (id) => {
    const w = words(lang());
    return CRITERIA.map((c) => { const r = vote.ratings[id]?.[c]; return `${w[c]}: ${Number.isInteger(r) ? `${r} / ${RATING_MAX}` : w.unrated}`; }).join(' / ');
  };

  api.getVote = () => {
    if (!vote) return null;
    const w = words(lang());
    const result = resultOf();
    const votesOf = (id) => Object.values(vote.ballots).reduce((a, b) => a + (b[id] ?? 0), 0);
    const options = vote.options.map((o) => {
      const ratings = {}; for (const c of CRITERIA) ratings[c] = Number.isInteger(vote.ratings[o.id]?.[c]) ? vote.ratings[o.id][c] : null;
      return { id: o.id, label: o.label, ...(o.pointId ? { pointId: o.pointId } : {}), votes: votesOf(o.id), ratings, ratingText: ratingTextOf(o.id), criticalRisk: isCriticalRisk(ratings.risk), confidential: isConf(o) };
    });
    const voters = vote.voters.map((v, i) => { const u = usedBy(v.id); return { id: v.id, label: voterLabel(v, i), votesUsed: u, remaining: vote.votesPerPerson - u }; });
    const votesUsed = voters.reduce((a, v) => a + v.votesUsed, 0);
    return {
      options, voters, votesPerPerson: vote.votesPerPerson, votesUsed, remaining: vote.votesPerPerson * voters.length - votesUsed,
      stance: vote.stance, stanceLabel: stanceLabel(), rulesText: w.rules(vote.votesPerPerson), noticeText: w.notice, result,
    };
  };

  api.startVote = (opts = {}) => {
    const rawOpts = Array.isArray(opts?.options) ? opts.options : [];
    const options = []; const seen = new Set();
    for (const o of rawOpts) {
      const label = cleanLabel(typeof o === 'string' ? o : o?.label, LABEL_MAX);
      if (!label) return fail('empty_option');
      if (seen.has(label)) return fail('duplicate_option');
      seen.add(label);
      const pointId = typeof o === 'object' && o && o.pointId ? String(o.pointId) : null;
      if (pointId && !findPoint(pointId)) return fail('invalid_point');
      options.push({ id: `o${options.length + 1}`, label, ...(pointId ? { pointId } : {}) });
    }
    if (options.length < 2) return fail('too_few_options');
    if (options.length > OPTION_MAX) return fail('too_many_options');
    const per = opts.votesPerPerson == null ? DEFAULT_VOTES_PER_PERSON : opts.votesPerPerson;
    if (!Number.isInteger(per) || per < 1 || per > VOTES_MAX) return fail('invalid_votes');
    const labels = Array.isArray(opts.voters) && opts.voters.length ? opts.voters : [''];
    if (labels.length > VOTER_MAX) return fail('too_many_voters');
    const voters = labels.map((l, i) => ({ id: `v${i + 1}`, label: cleanLabel(l, VOTER_LABEL_MAX) }));
    ctx.change(() => {
      vote = { options, voters, votesPerPerson: per, stance: opts.stance === 'decision' ? 'decision' : 'reference', ballots: {}, ratings: {}, tallied: false, decision: 'candidate', confirmedItemId: null, concern: false };
      ctx.setMessage('msg.voteStarted');
    });
    return { ok: true };
  };
  api.endVote = () => {
    if (!vote) return { ok: true };
    ctx.change(() => { vote = null; ctx.setMessage('msg.voteEnded'); });
    return { ok: true };
  };
  api.setVoteStance = (s) => {
    if (!vote) return fail('no_vote');
    if (s !== 'reference' && s !== 'decision') return fail('invalid_stance');
    if (s !== vote.stance) ctx.change(() => { vote.stance = s; if (vote.decision === 'rejected') vote.decision = 'candidate'; });
    return { ok: true, stance: vote.stance };
  };
  const voterOf = (id) => (id == null ? vote.voters[0] : vote.voters.find((v) => v.id === id));
  api.castVote = (optionId, voterId) => {
    if (!vote) return fail('no_vote');
    if (!vote.options.some((o) => o.id === optionId)) return fail('no_option');
    const v = voterOf(voterId);
    if (!v) return fail('no_voter');
    if (usedBy(v.id) >= vote.votesPerPerson) return fail('over_votes', { reason: words(lang()).overVotes });
    ctx.change(() => { const b = (vote.ballots[v.id] ??= {}); b[optionId] = (b[optionId] ?? 0) + 1; touch(); ctx.setMessage('msg.voteCast'); });
    return { ok: true };
  };
  api.retractVote = (optionId, voterId) => {
    if (!vote) return fail('no_vote');
    const v = voterOf(voterId);
    if (!v) return fail('no_voter');
    if (!(vote.ballots[v.id]?.[optionId] > 0)) return fail('no_vote_to_retract', { reason: words(lang()).noVotes });
    ctx.change(() => { const b = vote.ballots[v.id]; b[optionId] -= 1; if (!b[optionId]) delete b[optionId]; touch(); ctx.setMessage('msg.voteRetracted'); });
    return { ok: true };
  };
  api.rateOption = (optionId, criterion, level) => {
    if (!vote) return fail('no_vote');
    if (!vote.options.some((o) => o.id === optionId)) return fail('no_option');
    if (!CRITERIA.includes(criterion)) return fail('invalid_criterion');
    const clear = level == null || level === '';
    if (!clear && !(Number.isInteger(level) && level >= RATING_MIN && level <= RATING_MAX)) return fail('invalid_level');
    ctx.change(() => {
      const r = (vote.ratings[optionId] ??= {});
      if (clear) delete r[criterion]; else r[criterion] = level;
      if (!Object.keys(r).length) delete vote.ratings[optionId];
      touch();
    });
    return { ok: true };
  };
  api.tallyVote = () => {
    if (!vote) { ctx.change(() => ctx.setMessage('msg.voteNone')); return fail('no_vote'); }
    ctx.change(() => { vote.tallied = true; ctx.setMessage('msg.voteTallied'); });
    return { ok: true, result: resultOf() };
  };

  // ---- 表示（NFR-A11Y-001: 画面とテキスト一覧が同じ語。会議の文字列は escape） ----
  api.renderVote = () => {
    const g = api.getVote();
    if (!g) return '';
    const w = words(lang());
    const e = escapeHtml;
    const byId = new Map(g.options.map((o) => [o.id, o]));
    const ratingsHtml = (o) => `<ul class="vote-ratings" aria-label="${e(w.ratings)}: ${e(o.label)}">${CRITERIA.map((c) => `<li data-criterion="${c}">${e(w[c])}: ${o.ratings[c] == null ? `<span class="vote-unrated">${e(w.unrated)}</span>` : `${o.ratings[c]} / ${RATING_MAX}`}</li>`).join('')}</ul>`;
    const critical = (o) => (o.criticalRisk ? ` <span class="badge badge-critical-risk" data-critical-risk="1"><span aria-hidden="true">⚠</span> ${e(w.critical)}</span>` : '');
    const noticeBox = `<p class="vote-notice" data-vote-notice role="note"><span aria-hidden="true">□</span> ${e(w.noticeLabel)}: ${e(w.notice)}</p>`;
    const optionsHtml = g.options.map((o) => `<li data-vote-option="${e(o.id)}"><strong>${e(o.label)}</strong>: ${o.votes} ${e(w.votes)}${critical(o)}${ratingsHtml(o)}${o.criticalRisk ? noticeBox : ''}</li>`).join('');
    let resultHtml = '';
    if (g.result) {
      const stanceResult = g.stance === 'decision' ? w.decisionCandidate : w.reference;
      const rows = g.result.ranking.map((r) => {
        const o = byId.get(r.optionId);
        return `<li data-vote-rank="${r.rank}">${e(w.rank(r.rank))}${r.tie ? ` (${e(w.tie)})` : ''}: ${e(o.label)} — ${r.votes} ${e(w.votes)}${critical(o)}<br>${e(w.average)}: ${e(o.ratingText)}</li>`;
      }).join('');
      resultHtml = `<section class="vote-result" aria-label="${e(w.result)}"><h3>${e(w.result)}（${e(stanceResult)}）</h3><ol>${rows}</ol></section>`;
    }
    return `<section class="outline-vote vote" data-vote="1" data-stance="${g.stance}" aria-label="${e(w.title)}"><h2>${e(w.title)}</h2>`
      + `<p>${e(w.stanceLabel)}: <strong>${e(g.stanceLabel)}</strong>。${e(w.ruleLabel)}: ${e(g.rulesText)}</p>`
      + `<p>${e(w.perPerson)}: ${g.votesPerPerson}。${e(w.used)}: ${g.votesUsed}。${e(w.remaining)}: ${g.remaining}。</p>`
      + `<ul class="vote-voters" aria-label="${e(w.voter(''))}">${g.voters.map((v) => `<li>${e(v.label)}: ${v.votesUsed} / ${g.votesPerPerson} ${e(w.votes)}</li>`).join('')}</ul>`
      + `<ul class="vote-options">${optionsHtml}</ul>${resultHtml}${noticeBox}</section>`;
  };
  api.getVoteOutlineHtml = () => (vote ? api.renderVote() : '');

  // ---- 出力（Markdown・HTML。契約: 参考／決定・重大なリスク・未評価の語） ----
  // 機密の選択肢が 1 つでもあれば、「除く」保存の出力には載せない（AC-606）
  api.getVoteLines = () => {
    if (!vote || !vote.tallied) return {};
    const g = api.getVote();
    if (exporting() && g.options.some((o) => o.confidential)) return {};
    const w = words(lang());
    const byId = new Map(g.options.map((o) => [o.id, o]));
    const rows = g.result.ranking.map((r) => { const o = byId.get(r.optionId); return `${w.rank(r.rank)}${r.tie ? `（${w.tie}）` : ''} ${o.label} ${r.votes} ${w.votes}（${o.ratingText}）`; });
    const crit = g.options.filter((o) => o.criticalRisk).map((o) => o.label);
    const s = g.stance === 'decision' ? w.decisionCandidate : w.reference;
    return { voteLine: `${w.topLine(s)}: ${rows.join('、')}。${w.critical}: ${crit.length ? crit.join('、') : w.none}。${w.notice}` };
  };

  // ---- 決定事項（FR-094）の候補 ----
  const candidate = () => {
    if (!vote || !vote.tallied || vote.stance !== 'decision' || vote.decision !== 'candidate') return null;
    const g = api.getVote();
    if (exporting() && g.options.some((o) => o.confidential)) return null;
    const top = g.result.ranking.filter((r) => r.rank === 1);
    if (!top.length || top[0].votes < 1) return null;
    const byId = new Map(g.options.map((o) => [o.id, o]));
    const names = top.map((r) => byId.get(r.optionId).label).join('、');
    const crit = top.some((r) => byId.get(r.optionId).criticalRisk);
    const w = words(lang());
    return { id: VOTE_RESULT_ID, kind: 'decision', state: 'candidate', text: w.candidateText(w.decisionCandidate, names, top[0].votes, crit), sourceUtteranceId: null, reason: null, decider: null };
  };
  const baseItems = api.getMeetingItems;
  if (baseItems) {
    api.getMeetingItems = () => {
      const out = baseItems();
      if (vote && vote.confirmedItemId && exporting() && vote.options.some(isConf)) out.decisions = out.decisions.filter((d) => d.id !== vote.confirmedItemId);
      const c = candidate();
      if (c) { out.decisions.push(c); out.candidateCount += 1; }
      return out;
    };
    const baseConfirm = api.confirmMeetingItem; const baseReject = api.rejectMeetingItem; const baseEdit = api.editMeetingItem;
    const confirmCandidate = () => {
      const c = candidate();
      if (!c) return { ok: false };
      const r = api.addMeetingItem('decision', { text: c.text });
      if (!r.ok) return r;
      ctx.change(() => { vote.decision = 'confirmed'; vote.confirmedItemId = r.id; });
      return { ok: true, id: r.id };
    };
    api.confirmMeetingItem = (id) => (id === VOTE_RESULT_ID ? confirmCandidate() : baseConfirm(id));
    api.rejectMeetingItem = (id) => {
      if (id !== VOTE_RESULT_ID) return baseReject(id);
      if (!candidate()) return { ok: false };
      ctx.change(() => { vote.decision = 'rejected'; ctx.setMessage('msg.minutesRejected'); });
      return { ok: true };
    };
    api.editMeetingItem = (id, fields) => {
      if (id !== VOTE_RESULT_ID) return baseEdit(id, fields);
      const r = confirmCandidate(); // 編集は、候補を確定の項目にしてから行う（利用者の操作）
      return r.ok ? baseEdit(r.id, fields) : r;
    };
  }
  // 注記・印を異論・懸念（FR-094）として記録する（AC-615）
  api.recordVoteConcern = () => {
    if (!vote) return fail('no_vote');
    const g = api.getVote();
    const w = words(lang());
    const crit = g.options.filter((o) => o.criticalRisk).map((o) => o.label);
    const text = `${w.notice}${crit.length ? `: ${w.critical}: ${crit.join('、')}` : ''}`;
    if (!api.addMeetingItem) return fail('no_minutes');
    const r = api.addMeetingItem('objection', { text });
    if (r.ok) ctx.change(() => { vote.concern = true; ctx.setMessage('msg.voteConcern'); });
    return r;
  };

  // ---- 画面（vote-ui.js が使う） ----
  api.openVote = () => { if (!uiOpen) { uiOpen = true; ctx.change(() => ctx.setMessage('msg.voteOpen')); } return { ok: true, active: !!vote }; };
  api.closeVote = () => { if (uiOpen) { uiOpen = false; ctx.change(() => ctx.setMessage('msg.voteClosed')); } return { ok: true }; };
  api.getVoteRulesText = (n = DEFAULT_VOTES_PER_PERSON) => words(lang()).rules(n);
  api.getVoteView = () => (uiOpen ? { rulesText: api.getVoteRulesText(), vote: api.getVote(), html: api.renderVote(), defaultVotes: DEFAULT_VOTES_PER_PERSON, criteria: CRITERIA.map((c) => ({ id: c, label: words(lang())[c] })), unrated: words(lang()).unrated, critical: words(lang()).critical, concern: !!vote?.concern } : null);
  ctx.registerCommand('vote.open', () => api.openVote());
  ctx.registerCommand('vote.tally', () => api.tallyVote());
  // Ctrl+Alt+Shift+< / >（使用済みの組み合わせと重ならないもの）
  ctx.registerKey({ key: '<', ctrl: true, alt: true, shift: true, command: 'vote.open' });
  ctx.registerKey({ key: '>', ctrl: true, alt: true, shift: true, command: 'vote.tally' });
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (uiOpen && ev?.key === 'Escape' && !ev?.ctrlKey && !ev?.altKey) { api.closeVote(); return 'vote.close'; }
    return baseKey(ev);
  };

  // ---- 保存・復元・初期化（FR-012・FR-018・FR-019） ----
  const dict = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  const parse = (raw) => {
    const o = dict(raw);
    if (!Array.isArray(o.options) || !Array.isArray(o.voters)) return null;
    const options = []; const ids = new Set();
    for (const x of o.options.slice(0, OPTION_MAX)) {
      if (!x || typeof x.id !== 'string' || ids.has(x.id) || typeof x.label !== 'string' || !x.label.trim()) continue;
      ids.add(x.id); options.push({ id: x.id, label: cleanLabel(x.label, LABEL_MAX), ...(typeof x.pointId === 'string' && x.pointId ? { pointId: x.pointId } : {}) });
    }
    const voters = []; const vids = new Set();
    for (const x of o.voters.slice(0, VOTER_MAX)) {
      if (!x || typeof x.id !== 'string' || vids.has(x.id)) continue;
      vids.add(x.id); voters.push({ id: x.id, label: cleanLabel(x.label, VOTER_LABEL_MAX) });
    }
    if (options.length < 2 || !voters.length) return null;
    const per = Number.isInteger(o.votesPerPerson) && o.votesPerPerson >= 1 && o.votesPerPerson <= VOTES_MAX ? o.votesPerPerson : DEFAULT_VOTES_PER_PERSON;
    const ballots = {};
    for (const v of voters) {
      let left = per; const b = {};
      for (const opt of options) { const n = dict(dict(o.ballots)[v.id])[opt.id]; if (Number.isInteger(n) && n > 0 && left > 0) { b[opt.id] = Math.min(n, left); left -= b[opt.id]; } }
      if (Object.keys(b).length) ballots[v.id] = b;
    }
    const ratings = {};
    for (const opt of options) {
      const r = {};
      for (const c of CRITERIA) { const n = dict(dict(o.ratings)[opt.id])[c]; if (Number.isInteger(n) && n >= RATING_MIN && n <= RATING_MAX) r[c] = n; }
      if (Object.keys(r).length) ratings[opt.id] = r;
    }
    return {
      options, voters, votesPerPerson: per, stance: o.stance === 'decision' ? 'decision' : 'reference', ballots, ratings, tallied: o.tallied === true,
      decision: ['candidate', 'rejected', 'confirmed'].includes(o.decision) ? o.decision : 'candidate', confirmedItemId: typeof o.confirmedItemId === 'string' ? o.confirmedItemId : null, concern: o.concern === true,
    };
  };
  ctx.registerPersist('vote', {
    export: () => (vote ? JSON.parse(JSON.stringify(vote)) : undefined),
    import: (v) => { vote = v == null ? null : parse(v); },
    reset: () => { vote = null; uiOpen = false; },
  });
}
