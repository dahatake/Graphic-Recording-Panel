// FR-001 音声認識の取込 / NFR-PRIV-001 音声データの扱い / FR-012 復元後の再開時に音声認識を改めて開始する。
// SpeechSource 抽象（契約: tests/system/CONTRACT.md）:
//   { processLocally, start({lang}), stop(), onresult({text,isFinal}), onerror({code}) }
// デバイス内処理（processLocally）が確認できるときだけ有効。確認できなければ開始せず、代替入力（FR-002）へ誘導する。
// 音声データはアプリでは保持・保存しない（認識結果の文字列だけを扱う）。

const LANG_TAG = { ja: 'ja-JP', en: 'en-US' };
export const speechLang = (lang) => LANG_TAG[lang] ?? LANG_TAG.ja;

// 実ブラウザ用の SpeechSource。Web Speech API の processLocally が使えて、言語パックが利用可能なときだけ processLocally=true。
export function createBrowserSpeechSource(g = globalThis) {
  const SR = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  if (!SR) return null;
  const src = { processLocally: false, onresult: null, onerror: null, onend: null, ready: Promise.resolve() };
  const supportsLocal = typeof SR.available === 'function' && 'processLocally' in SR.prototype;
  if (supportsLocal) {
    src.ready = Promise.all(Object.values(LANG_TAG).map((l) => Promise.resolve(SR.available({ langs: [l], processLocally: true })).catch(() => 'unavailable')))
      .then((rs) => { src.processLocally = rs.every((r) => r === 'available'); })
      .catch(() => { src.processLocally = false; });
  }
  let rec = null;
  src.start = ({ lang }) => {
    if (!src.processLocally) return;
    src.stop();
    rec = new SR();
    rec.lang = lang; rec.continuous = true; rec.interimResults = true; rec.processLocally = true;
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
      'msg.speechUnavailable': 'この環境ではデバイス内の音声認識を確認できないため、音声認識は使えません。テキスト入力またはテキストファイルの取り込みをご利用ください',
      'msg.speechDenied': 'マイクの許可が得られないため音声認識を使えません。記録済みの内容は保持されています。テキスト入力またはテキストファイルの取り込みをご利用ください',
      'msg.speechError': '音声認識でエラーが発生しました。記録済みの内容は保持されています。テキスト入力をご利用いただけます',
    },
    en: {
      'cmd.speech.start': 'Start speech recognition',
      'toolbar.speech': 'Speech',
      'cmd.speech.stop': 'Stop speech recognition',
      'speech.interim': 'Listening (not final)',
      'msg.speechUnavailable': 'On-device speech recognition cannot be confirmed in this environment, so speech recognition is disabled. Please use text input or import a text file',
      'msg.speechDenied': 'Microphone permission was not granted, so speech recognition is unavailable. Your recorded content is kept. Please use text input or import a text file',
      'msg.speechError': 'A speech recognition error occurred. Your recorded content is kept. You can use text input',
    },
  });
  const source = ctx.options.speechSource ?? createBrowserSpeechSource();
  if (source?.ready) await source.ready;
  const speech = ctx.state.speech = { active: false, interim: '' };
  const available = () => !!source && source.processLocally === true;
  ctx.api.isSpeechAvailable = available;

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

  const begin = () => source.start({ lang: speechLang(ctx.state.lang) });
  ctx.api.startSpeech = () => {
    if (!available()) {
      ctx.change(() => ctx.setMessage('msg.speechUnavailable'));
      return { ok: false, reason: 'unavailable' };
    }
    if (!speech.active) { speech.active = true; begin(); }
    ctx.change(() => ctx.setMessage(null));
    return { ok: true };
  };
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
  ctx.on('lang', () => { if (speech.active && source) { source.stop(); begin(); } });
}
