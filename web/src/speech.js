// FR-001 音声認識の取込 / NFR-PRIV-001 音声データの扱い / FR-012 復元後の再開時に音声認識を改めて開始する。
// SpeechSource 抽象（契約: tests/system/CONTRACT.md）:
//   { processLocally, start({lang}), stop(), onresult({text,isFinal}), onerror({code}) }
// 選択言語がデバイス内で使える（local／導入可能）ときは同意なしで開始。使えなくても API があれば、利用者の明示同意後だけ外部送信の可能性つきで開始する。それ以外は開始せず代替入力（FR-002）へ誘導する。
// 音声データはアプリでは保持・保存しない（認識結果の文字列だけを扱う）。

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
      'cmd.speech.start': '音声認識を開始',
      'toolbar.speech': '音声認識',
      'cmd.speech.stop': '音声認識を停止',
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
      'cmd.speech.start': 'Start speech recognition',
      'toolbar.speech': 'Speech',
      'cmd.speech.stop': 'Stop speech recognition',
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
  const source = ctx.options.speechSource ?? createBrowserSpeechSource();
  if (source?.ready) await source.ready;
  const speech = ctx.state.speech = { active: false, interim: '' };
  // 判定は選択中の言語だけで行う（FR-001 AC-040 AC-066 AC-067）。同意はこのページの利用中だけ（保存しない）。
  let consent = false, micDenied = false, modelFailed = false;
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
    return { state, reason, startEnabled, alternative: state === 'unavailable', text: ctx.t(`speech.status.${key}`) };
  };
  const available = () => statusNow().startEnabled;
  ctx.api.isSpeechAvailable = available;
  ctx.api.getSpeechStatus = statusNow;
  ctx.api.getSpeechConsent = () => consent;
  ctx.api.getConsentUi = () => ({
    visible: statusNow().state === 'consent', role: 'checkbox', checked: consent, tabbable: true,
    label: ctx.t('speech.consent.label'), notice: ctx.t('speech.consent.notice'),
    stateText: ctx.t(consent ? 'speech.consent.on' : 'speech.consent.off'), colorOnly: false,
  });

  if (source) {
    source.onresult = ({ text, isFinal } = {}) => {
      if (ctx.state.session !== 'recording') return; // 記録中以外は無視
      if (isFinal) {
        ctx.change(() => { speech.interim = ''; });
        if (ctx.addUtterance(text)) ctx.transcript?.addFinals([String(text).trim()]);
      } else {
        ctx.change(() => { speech.interim = String(text ?? ''); }); // 暫定結果は発話にしない
      }
    };
    source.onerror = ({ code } = {}) => {
      const denied = code === 'not-allowed' || code === 'service-not-allowed';
      speech.active = false;
      if (denied) micDenied = true;
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
  const canRestart = () => ctx.state.session === 'recording' && speech.active && available();
  if (source) {
    const onResult = source.onresult;
    source.onresult = (e) => { fails = 0; return onResult(e); };
    source.onend = () => {
      if (!canRestart() || restartTimer != null) return;
      if (++fails > MAX_FAILS) {
        speech.active = false; fails = 0;
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
  const fail = (reason, msgKey) => { ctx.change(() => ctx.setMessage(msgKey)); return { ok: false, reason }; };
  const go = () => {
    if (!speech.active) { speech.active = true; begin(); }
    ctx.change(() => ctx.setMessage(null));
    return { ok: true };
  };
  ctx.api.startSpeech = () => {
    micDenied = false; modelFailed = false;
    const a = avail();
    if (a === 'api') return fail('api_missing', 'msg.speechApi');
    if (a === 'language') return fail('language_unsupported', 'msg.speechLang');
    if (a === 'remote') return consent ? go() : fail('consent_required', 'msg.speechConsent');
    if (a === 'downloadable') {
      const lang = curLang();
      return Promise.resolve(source.install?.({ lang })).catch(() => ({ ok: false })).then((r) => {
        if (!r?.ok) { modelFailed = true; return fail('model_missing', 'msg.speechModel'); }
        if (avail() === 'remote') return consent ? go() : fail('consent_required', 'msg.speechConsent');
        return go();
      });
    }
    return go();
  };
  ctx.api.setSpeechConsent = (v) => {
    consent = !!v; micDenied = false;
    if (!consent && source && speech.active) { source.stop(); cancelRestart(); fails = 0; }
    ctx.change(() => { if (!consent) { speech.active = false; speech.interim = ''; } });
  };
  ctx.registerCommand('speech.consent', () => ctx.api.setSpeechConsent(!consent));
  ctx.registerKey({ key: 'c', alt: true, shift: true, command: 'speech.consent' });
  ctx.api.stopSpeech = () => {
    if (source && speech.active) source.stop();
    cancelRestart(); fails = 0;
    ctx.change(() => { speech.active = false; speech.interim = ''; });
    return { ok: true };
  };
  ctx.registerCommand('speech.start', () => ctx.api.startSpeech());
  ctx.registerCommand('speech.stop', () => ctx.api.stopSpeech());
  ctx.registerKey({ key: 's', alt: true, shift: true, command: 'speech.start' });
  ctx.registerKey({ key: 'w', alt: true, shift: true, command: 'speech.stop' });

  // 一時停止・停止で止め、再開（復元後の再開を含む）で改めて開始する（FR-012 AC-043）。
  const halt = () => { if (speech.active) ctx.api.stopSpeech(); };
  ctx.on('session:pause', halt);
  ctx.on('session:stop', halt);
  ctx.on('session:resume', () => { if (available()) ctx.api.startSpeech(); });
  // 言語切替: 次の認識から切替後の言語（AC-039）
  ctx.on('lang', () => {
    micDenied = false; modelFailed = false;
    if (!speech.active || !source) return;
    source.stop();
    const a = avail();
    if (a === 'local' || (a === 'remote' && consent)) begin();
    else { speech.active = false; cancelRestart(); ctx.change(() => { speech.interim = ''; }); }
  });
}
