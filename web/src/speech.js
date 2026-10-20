// FR-001 音声認識の取込 / NFR-PRIV-001 音声データの扱い / FR-012 復元後の再開時に音声認識を改めて開始する。
// SpeechSource 抽象（契約: tests/system/CONTRACT.md）:
//   { processLocally, start({lang}), stop(), onresult({text,isFinal}), onerror({code}) }
// 選択言語がデバイス内で使える（local／導入可能）ときは同意なしで開始。使えなくても API があれば、利用者の明示同意後だけ外部送信の可能性つきで開始する。それ以外は開始せず代替入力（FR-002）へ誘導する。
// 音声データはアプリでは保持・保存しない（認識結果の文字列だけを扱う）。
// FR-081: 方式（speechsettings.js の getSpeechMethod）が Azure Speech のときは、AzureSpeechSource（options.azureSpeechSource。
// 既定は azurespeech.js の中継サーバー経由の実装）で認識する。同意は同じ setSpeechConsent をこの方式の同意に読み替え、
// 方式・エンドポイントのホストが変わると未同意に戻す（AC-441）。一時停止・再開・停止・復元（AC-394）はブラウザ標準と同じに扱う。
import { createRelayAzureSpeechSource, AZURE_STRINGS, AZURE_ERROR_CODES } from './azurespeech.js';

const LANG_TAG = { ja: 'ja-JP', en: 'en-US' };
export const speechLang = (lang) => LANG_TAG[lang] ?? LANG_TAG.ja;

// 実ブラウザ用の SpeechSource。判定は言語ごと（availabilityFor）。
//   local: SR.available が 'available' → processLocally=true で開始
//   downloadable: 'downloadable'/'downloading' → install（SR.install）後に local
//   remote: デバイス内不可（外部サービス経由の可能性）。利用者の同意後だけ、processLocally を設定せずに開始する
// FR-001 AC-040 AC-066 AC-067 / NFR-PRIV-001 AC-034
export function createBrowserSpeechSource(g = globalThis) {
  const SR = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  if (!SR) return null;
  const src = { supported: true, processLocally: false, onresult: null, onerror: null, onend: null, ready: Promise.resolve() };
  const supportsLocal = typeof SR.available === 'function' && 'processLocally' in SR.prototype;
  const cache = {};
  const classify = (r) => (r === 'available' ? 'local' : (r === 'downloadable' || r === 'downloading') ? 'downloadable' : 'remote');
  const refresh = (l) => Promise.resolve()
    .then(() => SR.available({ langs: [l], processLocally: true }))
    .catch(() => 'unavailable')
    .then((r) => { cache[l] = classify(r); src.processLocally = Object.values(cache).some((v) => v === 'local'); });
  if (supportsLocal) src.ready = Promise.all(Object.values(LANG_TAG).map(refresh)).then(() => {});
  src.availabilityFor = (lang) => (supportsLocal ? (cache[lang] ?? 'remote') : 'remote');
  src.install = async ({ lang }) => {
    try {
      if (typeof SR.install !== 'function') return { ok: false };
      const r = await SR.install({ langs: [lang], processLocally: true });
      if (r === false) return { ok: false };
      await refresh(lang);
      return { ok: cache[lang] === 'local' };
    } catch { return { ok: false }; }
  };
  let rec = null;
  src.start = ({ lang, processLocally }) => {
    src.stop();
    rec = new SR();
    rec.lang = lang; rec.continuous = true; rec.interimResults = true;
    if (processLocally === true) rec.processLocally = true; // 同意による開始では設定しない
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        src.onresult?.({ text: String(r[0]?.transcript ?? ''), isFinal: !!r.isFinal });
      }
    };
    rec.onerror = (ev) => src.onerror?.({ code: String(ev?.error ?? 'error') });
    rec.onend = () => { if (rec && rec === me) src.onend?.(); }; // NFR-BG-001 AC-064: 自動終了を通知
    const me = rec;
    try { rec.start(); } catch { src.onerror?.({ code: 'start-failed' }); }
  };
  src.stop = () => {
    if (!rec) return;
    const r = rec; rec = null;
    r.onresult = r.onerror = r.onend = null;
    try { r.stop(); } catch { /* 既に停止 */ }
  };
  return src;
}

export async function speechModule(ctx) {
  ctx.i18n.addStrings({
    ja: {
      'speech.interim': '認識中（未確定）',
      'msg.speechApi': 'このブラウザは音声認識（Web Speech API）に対応していないため、音声認識は使えません。テキスト入力またはテキストファイルの取り込みをご利用ください',
      'msg.speechLang': '選択中の言語は、このブラウザの音声認識が対応していないため使えません。テキスト入力またはテキストファイルの取り込みをご利用ください',
      'msg.speechModel': '音声認識の言語モデルを導入できなかったため、音声認識は使えません。テキスト入力またはテキストファイルの取り込みをご利用ください',
      'msg.speechConsent': 'デバイス内で音声認識できないため、外部サービスに音声が送られる可能性への同意が必要です。同意するか、テキスト入力またはテキストファイルの取り込みをご利用ください',
      'speech.status.local': '使えます（デバイス内）',
      'speech.status.consent': '使えます（要同意・外部送信の可能性）',
      'speech.status.api': '使えません（非対応のブラウザ）',
      'speech.status.language': '使えません（言語未対応）',
      'speech.status.model': '使えません（言語モデル未導入）',
      'speech.status.mic': '使えません（マイク未許可）',
      'speech.consent.label': '外部サービスでの音声認識に同意する',
      'speech.consent.notice': 'この言語はデバイス内で認識できないため、同意すると音声が外部の音声認識サービス（ブラウザ提供元など）へ送られる可能性があります。同意はこのページを開いている間だけ有効で、音声は保存されません。',
      'speech.consent.on': '同意済み',
      'speech.consent.off': '未同意',
      'msg.speechDenied': 'マイクの許可が得られないため音声認識を使えません。記録済みの内容は保持されています。テキスト入力またはテキストファイルの取り込みをご利用ください',
      'msg.speechError': '音声認識でエラーが発生しました。記録済みの内容は保持されています。テキスト入力をご利用いただけます',
    },
    en: {
      'speech.interim': 'Listening (not final)',
      'msg.speechApi': 'This browser does not support speech recognition (Web Speech API), so it is unavailable. Please use text input or import a text file',
      'msg.speechLang': 'The selected language is not supported by this browser\'s speech recognition. Please use text input or import a text file',
      'msg.speechModel': 'The speech language model could not be installed, so speech recognition is unavailable. Please use text input or import a text file',
      'msg.speechConsent': 'Speech cannot be recognized on this device, so consent to possible external transmission is required. Give consent, or use text input or import a text file',
      'speech.status.local': 'available (on-device)',
      'speech.status.consent': 'available (consent required, may be sent externally)',
      'speech.status.api': 'unavailable (unsupported browser)',
      'speech.status.language': 'unavailable (language not supported)',
      'speech.status.model': 'unavailable (language model not installed)',
      'speech.status.mic': 'unavailable (microphone not allowed)',
      'speech.consent.label': 'Allow speech recognition by an external service',
      'speech.consent.notice': 'This language cannot be recognized on this device. If you consent, your audio may be sent to an external speech recognition service (such as the browser vendor). Consent lasts only while this page is open, and audio is never saved.',
      'speech.consent.on': 'Consented',
      'speech.consent.off': 'Not consented',
      'msg.speechDenied': 'Microphone permission was not granted, so speech recognition is unavailable. Your recorded content is kept. Please use text input or import a text file',
      'msg.speechError': 'A speech recognition error occurred. Your recorded content is kept. You can use text input',
    },
  });
  ctx.i18n.addStrings(AZURE_STRINGS);
  const source = ctx.options.speechSource ?? createBrowserSpeechSource();
  if (source?.ready) await source.ready;
  // FR-081: Azure Speech の音声認識（同一オリジンの中継サーバー経由）。relay がなければ使えない（未設定扱い）
  const azSource = ctx.options.azureSpeechSource ?? createRelayAzureSpeechSource({ relay: ctx.options.relay });
  const isAzure = () => ctx.api.getSpeechMethod?.() === 'azure';
  const speech = ctx.state.speech = { active: false, interim: '' };
  // 判定は選択中の言語だけで行う（FR-001 AC-040 AC-066 AC-067）。同意はこのページの利用中だけ（保存しない）。
  let consent = false, micDenied = false, modelFailed = false;
  let engine = null; // speech.active のときに動いている方式: 'browser' | 'azure'
  let azFailed = null; // Azure Speech の失敗で停止した理由（AC-444）。利用者の操作（再試行・再開・方式の切替）まで保つ
  const curLang = () => speechLang(ctx.state.lang);
  const avail = () => {
    if (!source || source.supported === false) return 'api';
    // 例外・未知の値は「判定不能＝デバイス内不可」として同意経路（remote）に倒す（NFR-PRIV-001 AC-034）。
    let a;
    try {
      a = typeof source.availabilityFor === 'function' ? source.availabilityFor(curLang()) : (source.processLocally ? 'local' : 'remote');
    } catch { return 'remote'; }
    if (a === 'unsupported') return 'language';
    return a === 'local' || a === 'remote' || a === 'downloadable' ? a : 'remote';
  };
  const statusNow = () => {
    const a = avail();
    let state, reason = null, startEnabled = true;
    if (a === 'api' || a === 'language') { state = 'unavailable'; reason = a; }
    else if (micDenied) { state = 'unavailable'; reason = 'mic'; }
    else if (modelFailed && a === 'downloadable') { state = 'unavailable'; reason = 'model'; }
    else if (a === 'remote') { state = 'consent'; if (!consent) reason = 'consent'; }
    else state = 'local';
    if (reason && reason !== null) startEnabled = false;
    const key = state === 'unavailable' ? reason : state;
    return { method: 'browser', state, reason, startEnabled, alternative: state === 'unavailable', text: ctx.t(`speech.status.${key}`) };
  };
  // FR-081 AC-444 AC-445: Azure Speech の状態（使えます・同意待ち・使えません（理由））。失敗のときは 1 回の操作の候補を添える
  const azureStatus = () => {
    let state, reason;
    if (azFailed) { state = 'unavailable'; reason = azFailed; } else if (!azSource) { state = 'unavailable'; reason = 'unconfigured'; } else if (!consent) { state = 'consent'; reason = 'consent'; } else { state = 'available'; reason = null; }
    const st = { method: 'azure', state, reason, startEnabled: state === 'available', alternative: state === 'unavailable',
      text: ctx.t(`speech.status.azure.${state === 'unavailable' ? reason : state}`) };
    if (state === 'unavailable') {
      st.actions = [{ command: 'speech.retryAzure', label: ctx.t('speech.action.retryAzure') }, { command: 'speech.useBrowser', label: ctx.t('speech.action.useBrowser') }];
    }
    return st;
  };
  const browserAvailable = () => statusNow().startEnabled;
  const available = () => (isAzure() ? azureStatus().startEnabled : browserAvailable());
  ctx.api.isSpeechAvailable = available;
  ctx.api.getSpeechStatus = () => (isAzure() ? azureStatus() : statusNow());
  ctx.api.getSpeechConsent = () => consent;
  const azHost = () => ctx.api.getAzureSpeechSettings?.().endpointHost || ctx.t('speech.azure.host.unset');
  ctx.api.getConsentUi = () => (isAzure() ? {
    // FR-081 AC-442: Azure Speech では、デバイス内処理の可否によらず [記録開始] の直近に同意と送信先のホスト名を示す
    visible: true, noticeVisible: true,
    region: 'top', nearCommand: 'session.start', role: 'checkbox', checked: consent, tabbable: true,
    label: ctx.t('speech.azure.consent.label'), notice: ctx.t('speech.azure.consent.notice').replace('{host}', azHost()),
    stateText: ctx.t(consent ? 'speech.consent.on' : 'speech.consent.off'), colorOnly: false,
  } : {
    // FR-072 AC-385: 同意のチェックと説明は最上部の [記録開始] の直近に、セッションの状態によらず（外部送信の可能性があるとき）常に見える。
    visible: statusNow().state === 'consent', noticeVisible: statusNow().state === 'consent',
    region: 'top', nearCommand: 'session.start', role: 'checkbox', checked: consent, tabbable: true,
    label: ctx.t('speech.consent.label'), notice: ctx.t('speech.consent.notice'),
    stateText: ctx.t(consent ? 'speech.consent.on' : 'speech.consent.off'), colorOnly: false,
  });

  // 認識結果の取り込み（方式によらず共通）。暫定結果は発話にしない（AC-052）。確定結果だけを発話にする（AC-003）
  const accept = ({ text, isFinal } = {}) => {
    if (ctx.state.session !== 'recording') return; // 記録中以外は無視
    if (isFinal) {
      ctx.change(() => { speech.interim = ''; });
      if (ctx.addUtterance(text)) ctx.transcript?.addFinals([String(text).trim()]);
    } else {
      ctx.change(() => { speech.interim = String(text ?? ''); });
    }
  };
  if (source) {
    source.onresult = (e) => { if (!isAzure()) accept(e); }; // 方式が Azure Speech の間に遅れて届いたブラウザ標準の結果は使わない
    source.onerror = ({ code } = {}) => {
      if (isAzure()) return;
      const denied = code === 'not-allowed' || code === 'service-not-allowed';
      speech.active = false;
      if (denied) micDenied = true;
      engine = null;
      try { source.stop(); } catch { /* 無視 */ }
      ctx.change(() => { speech.interim = ''; ctx.setMessage(denied ? 'msg.speechDenied' : 'msg.speechError'); });
    };
  }

  // NFR-BG-001 AC-064: 記録中にブラウザが認識を自動終了したら、PARAM-008（2 秒）以内に再開する。
  // 停止・一時停止後（speech.active=false）や、デバイス内処理が確認できないときは再開しない。
  // 結果が 1 件も得られないまま短時間に再開が続くときは、無限ループを避けて止める。
  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const RESTART_MS = 500, MAX_FAILS = 5;
  let restartTimer = null, fails = 0;
  const cancelRestart = () => { if (restartTimer != null) { sched.clearTimeout(restartTimer); restartTimer = null; } };
  const canRestart = () => ctx.state.session === 'recording' && speech.active && engine === 'browser' && !isAzure() && browserAvailable();
  if (source) {
    const onResult = source.onresult;
    source.onresult = (e) => { fails = 0; return onResult(e); };
    source.onend = () => {
      if (!canRestart() || restartTimer != null) return;
      if (++fails > MAX_FAILS) {
        speech.active = false; engine = null; fails = 0;
        ctx.change(() => { speech.interim = ''; ctx.setMessage('msg.speechError'); });
        return;
      }
      restartTimer = sched.setTimeout(() => {
        restartTimer = null;
        if (canRestart()) begin();
      }, RESTART_MS);
    };
  }
  // 非表示でも停止・間引きをしない。可視に戻ったときは画面を最新化する（NFR-BG-001 AC-063）。
  const vis = ctx.options.visibility ?? (globalThis.document ? {
    get hidden() { return globalThis.document.hidden; },
    set onchange(f) { globalThis.document.addEventListener('visibilitychange', f); },
  } : null);
  if (vis) vis.onchange = () => { if (!vis.hidden) ctx.change(() => {}); };

  // デバイス内（local）のときだけ processLocally:true を渡す。同意による開始ではキー自体を持たせない。
  const begin = () => source.start(avail() === 'local' ? { lang: curLang(), processLocally: true } : { lang: curLang() });
  let keepMessage = false; // 方式の切替の直後は、切替の旨の表示を開始で消さない
  const fail = (reason, msgKey) => { ctx.change(() => ctx.setMessage(msgKey)); return { ok: false, reason }; };
  const go = () => {
    if (!speech.active) { speech.active = true; engine = 'browser'; begin(); ctx.emit('speech:started'); } // FR-074: 開始を通知（認識文字列パネルの自動表示）
    if (!keepMessage) ctx.change(() => ctx.setMessage(null));
    return { ok: true };
  };

  // ---- FR-081 Azure Speech ----
  // 失敗（AC-444）で止めた後は、利用者の操作（再試行・記録の再開・方式の切替）まで start を呼ばない。
  // 上流の正常な終了・トークンの期限切れ（AC-458 (a)）は失敗に含めず、PARAM-008（2 秒）以内に自動で再開する。
  let azTimer = null;
  const cancelAzRestart = () => { if (azTimer != null) { sched.clearTimeout(azTimer); azTimer = null; } };
  const azRunning = () => speech.active && engine === 'azure';
  const azCanRestart = () => azRunning() && isAzure() && consent && !azFailed && ctx.state.session === 'recording';
  const azBegin = () => azSource.start({ lang: curLang() });
  if (azSource) {
    azSource.onresult = (e) => { if (azRunning() && isAzure()) accept(e); }; // 未同意・停止中に届いた結果は使わない
    azSource.onerror = ({ code } = {}) => {
      if (!azRunning()) return;
      const reason = AZURE_ERROR_CODES.includes(code) ? code : 'network';
      azFailed = reason; speech.active = false; engine = null; cancelAzRestart();
      try { azSource.stop(); } catch { /* 無視 */ }
      ctx.change(() => { speech.interim = ''; ctx.setMessage(`msg.azureFail.${reason}`); });
    };
    azSource.onend = () => {
      if (!azCanRestart() || azTimer != null) return;
      ctx.change(() => { speech.interim = ''; });
      azTimer = sched.setTimeout(() => { azTimer = null; if (azCanRestart()) azBegin(); }, RESTART_MS);
    };
  }
  const startAzure = () => {
    azFailed = null;
    if (!azSource) { azFailed = 'unconfigured'; return fail('unconfigured', 'msg.azureFail.unconfigured'); }
    if (!consent) return fail('consent_required', 'msg.azureConsent');
    if (!speech.active) { speech.active = true; engine = 'azure'; azBegin(); ctx.emit('speech:started'); }
    if (!keepMessage) ctx.change(() => ctx.setMessage(null));
    return { ok: true };
  };

  let installing = null;
  ctx.api.startSpeech = () => {
    if (isAzure()) return startAzure();
    micDenied = false; modelFailed = false;
    const a = avail();
    if (a === 'api') return fail('api_missing', 'msg.speechApi');
    if (a === 'language') return fail('language_unsupported', 'msg.speechLang');
    if (a === 'remote') return consent ? go() : fail('consent_required', 'msg.speechConsent');
    if (a === 'downloadable') {
      const lang = curLang();
      if (installing) return installing; // 導入の最中に重ねて呼ばれても、導入と開始は 1 回（[記録開始] と明示の開始の重複）
      installing = Promise.resolve(source.install?.({ lang })).catch(() => ({ ok: false })).then((r) => {
        installing = null;
        if (isAzure()) return { ok: false, reason: 'method_changed' }; // 導入の間に方式が変わった
        if (!r?.ok) { modelFailed = true; return fail('model_missing', 'msg.speechModel'); }
        if (avail() === 'remote') return consent ? go() : fail('consent_required', 'msg.speechConsent');
        return go();
      });
      return installing;
    }
    return go();
  };
  // 動いている方式の音声認識を止める（force: 両方の方式を止める）
  const stopEngines = (force) => {
    if (source && (force || (speech.active && engine === 'browser'))) { try { source.stop(); } catch { /* 無視 */ } }
    if (azSource && (force || (speech.active && engine === 'azure'))) { try { azSource.stop(); } catch { /* 無視 */ } }
    cancelRestart(); cancelAzRestart(); fails = 0; engine = null;
  };
  let pendingResume = false; // 再開したが同意がなく開始できなかった（同意後に始める）
  ctx.api.setSpeechConsent = (v) => {
    consent = !!v; micDenied = false;
    if (!consent && speech.active) stopEngines(false); // 同意を外すと送信を止める（AC-442・AC-458 (c)）
    ctx.change(() => { if (!consent) { speech.active = false; speech.interim = ''; } });
    // 記録中に同意を得たら、止まっていた認識を始める（再開時に同意がなかった場合: FR-019 AC-099）
    if (consent && pendingResume && ctx.state.session === 'recording' && !speech.active && available()) { pendingResume = false; ctx.api.startSpeech(); }
  };
  ctx.registerCommand('speech.consent', () => ctx.api.setSpeechConsent(!consent));
  ctx.registerKey({ key: 'c', alt: true, shift: true, command: 'speech.consent' });
  ctx.api.stopSpeech = (opts) => {
    if (speech.active || opts?.force) stopEngines(!!opts?.force);
    else { cancelRestart(); cancelAzRestart(); fails = 0; }
    ctx.change(() => { speech.active = false; speech.interim = ''; });
    return { ok: true };
  };
  // FR-072: 音声認識の開始は [記録開始]・[再開] だけ（音声だけを始める別の操作は設けない）。

  // 一時停止・停止で止め、記録開始・再開（復元後の再開を含む）で改めて開始する（FR-012 AC-043。Azure Speech も同じ: FR-081 AC-458 (d)）。
  const halt = () => { pendingResume = false; if (speech.active) ctx.api.stopSpeech(); else { cancelAzRestart(); cancelRestart(); } };
  const kick = () => {
    pendingResume = false;
    const r = ctx.api.startSpeech();
    // 同意待ちなら、同意が入った時点で始める（FR-072 AC-386）
    if (r && typeof r.then === 'function') r.then((x) => { if (x?.reason === 'consent_required') pendingResume = true; });
    else if (r && r.reason === 'consent_required') pendingResume = true;
    else if (!r?.ok && ctx.api.getSpeechStatus().reason === 'consent') pendingResume = true;
  };
  ctx.on('session:pause', halt);
  ctx.on('session:stop', halt);
  ctx.on('session:start', kick);
  ctx.on('session:resume', kick);

  // FR-081 AC-441: 方式の切替（選択・キーの保存・キーの削除）と、Azure Speech のエンドポイントのホストの変更では、
  // それまでの方式の認識を止め、同意を未同意に戻す。記録中なら新しい方式の開始の条件（同意など）を満たせば開始し、
  // 満たさなければ同意待ちにする。記録中の状態と記録済みの発話・図は変えない。
  const switchEngine = () => {
    if (speech.active || azTimer != null || restartTimer != null) stopEngines(false);
    consent = false; azFailed = null; micDenied = false; modelFailed = false; pendingResume = false;
    ctx.change(() => { speech.active = false; speech.interim = ''; });
    if (ctx.state.session === 'recording') {
      keepMessage = true;
      try { kick(); } finally { keepMessage = false; }
    }
  };
  ctx.on('speech:method', switchEngine);
  ctx.on('speech:endpointHost', () => { if (isAzure()) switchEngine(); });

  // FR-081 AC-444: 状態表示から 1 回の操作で、Azure Speech の再試行・ブラウザ標準への切替
  ctx.registerCommand('speech.retryAzure', () => {
    if (!isAzure()) return { ok: false, reason: 'not_azure' };
    azFailed = null;
    if (ctx.state.session !== 'recording') { ctx.change(() => ctx.setMessage(null)); return { ok: true }; }
    if (speech.active) return { ok: true };
    pendingResume = false;
    const r = startAzure();
    if (r.reason === 'consent_required') pendingResume = true;
    return r;
  });
  ctx.registerCommand('speech.useBrowser', () => ctx.api.setSpeechMethod?.('browser') ?? { ok: false });
  ctx.registerKey({ key: 'u', ctrl: true, alt: true, shift: true, command: 'speech.retryAzure' });
  ctx.registerKey({ key: 'b', ctrl: true, alt: true, shift: true, command: 'speech.useBrowser' });

  // 言語切替: 次の認識から切替後の言語（AC-039。Azure Speech は FR-081 AC-445）
  ctx.on('lang', () => {
    micDenied = false; modelFailed = false;
    if (!speech.active) return;
    if (engine === 'azure') { if (azSource) { azSource.stop(); cancelAzRestart(); azBegin(); } return; }
    if (!source) return;
    source.stop();
    const a = avail();
    if (a === 'local' || (a === 'remote' && consent)) begin();
    else { speech.active = false; engine = null; cancelRestart(); ctx.change(() => { speech.interim = ''; }); }
  });
}
