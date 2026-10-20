// FR-081 Azure Speech による音声認識（契約: tests/system/CONTRACT-AZURE-SPEECH.md「1. アプリ」の AzureSpeechSource）。
// 実ブラウザ用の AzureSpeechSource: マイクの音声を 16 kHz・16 bit・モノラルの短い WAV に区切り、
// 同一オリジンの中継サーバー（POST /api/speech/recognize。options.relay）だけへ送る（AC-443。キーはブラウザに来ない）。
// - start〜stop の間だけ送る。発話のない区間（無音）は送らない。音声は送った後に捨て、保存しない（AC-446・NFR-PRIV-001）。
// - 失敗は onerror({code: 'unconfigured'|'auth'|'network'|'mic'})（AC-444）。トークンの取り直しは中継サーバーが行う（AC-458）。
// 方式の切替・同意・状態表示・自動の再開は speech.js が扱う。

const RATE = 16_000;
const FRAME = 4096;
const VOICE_RMS = 0.012; // 発話とみなす音の大きさ（RMS）
const PREROLL_MS = 300; // 発話の直前に残す音
const END_SILENCE_MS = 700; // 発話の後、この長さの無音で区切る
const MAX_SEGMENT_MS = 15_000; // 1 回に送る音声の上限（中継サーバーの上限 4 MB に十分収まる）

export const AZURE_ERROR_CODES = ['unconfigured', 'auth', 'network', 'mic'];

// 16 bit PCM（Int16Array の配列）から WAV（Uint8Array）を作る
export function encodeWav(parts, rate = RATE) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const p of parts) for (let i = 0; i < p.length; i++, o += 2) v.setInt16(o, p[i], true);
  return new Uint8Array(buf);
}

// 任意のサンプリング周波数の Float32 を 16 kHz の Int16 に変える（区間の平均）
export function downsample(input, fromRate, toRate = RATE) {
  const ratio = fromRate / toRate;
  const len = Math.max(0, Math.floor(input.length / ratio));
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b && j < input.length; j++) s += input[j];
    const x = Math.max(-1, Math.min(1, s / (b - a)));
    out[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
  }
  return out;
}

const rms = (f) => { let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i]; return Math.sqrt(s / Math.max(1, f.length)); };

// 中継サーバーの応答を分類する（AC-444）
export function classifyRecognize(r) {
  if (r && r.status >= 200 && r.status < 300 && r.body && r.body.ok === true) return { ok: true, text: typeof r.body.text === 'string' ? r.body.text : '' };
  const res = r?.body?.result;
  if (res === 'unconfigured' || res === 'auth') return { ok: false, code: res };
  if (!r || r.status === 401 || r.status === 403) return { ok: false, code: r ? 'auth' : 'network' };
  return { ok: false, code: 'network' };
}

// 発話の区切り（音の大きさだけで判定する簡単な VAD）。push(Float32, rate) → 送る区間（Int16Array[]）か null
export function createSegmenter() {
  let parts = [], ms = 0, voiced = false, silence = 0;
  const reset = () => { parts = []; ms = 0; voiced = false; silence = 0; };
  return {
    reset,
    push(frame, rate) {
      const pcm = downsample(frame, rate);
      const dur = (pcm.length / RATE) * 1000;
      const loud = rms(frame) >= VOICE_RMS;
      parts.push(pcm); ms += dur;
      if (loud) { voiced = true; silence = 0; } else if (voiced) silence += dur;
      if (!voiced) {
        while (parts.length > 1 && ms - (parts[0].length / RATE) * 1000 >= PREROLL_MS) { ms -= (parts[0].length / RATE) * 1000; parts.shift(); }
        return null;
      }
      if (silence >= END_SILENCE_MS || ms >= MAX_SEGMENT_MS) { const out = parts; reset(); return out; }
      return null;
    },
  };
}

// 実ブラウザ用の AzureSpeechSource。relay は relayclient.js の relayRequest（同一オリジンの /api/speech/ だけ）。
export function createRelayAzureSpeechSource({ relay, g = globalThis } = {}) {
  if (typeof relay !== 'function') return null;
  const src = { onresult: null, onerror: null, onend: null };
  let run = 0; // start ごとに増やす。stop 後に届いた結果・音声は捨てる
  let media = null, actx = null, node = null, input = null;
  let queue = [], sending = false;
  const seg = createSegmenter();

  const release = () => {
    try { if (node) { node.onaudioprocess = null; node.disconnect(); } } catch { /* 既に切断 */ }
    try { input?.disconnect(); } catch { /* 既に切断 */ }
    try { media?.getTracks().forEach((t) => t.stop()); } catch { /* 既に停止 */ }
    try { void actx?.close(); } catch { /* 既に閉じた */ }
    media = actx = node = input = null;
    queue = []; seg.reset(); // 音声は保持しない
  };
  const fail = (my, code) => { if (my !== run) return; run++; release(); src.onerror?.({ code }); };

  const pump = async () => {
    if (sending) return;
    sending = true;
    try {
      while (queue.length) {
        const { my, lang, wav } = queue.shift();
        if (my !== run) continue;
        let r = null;
        try { r = await relay({ method: 'POST', path: `/api/speech/recognize?language=${encodeURIComponent(lang)}`, body: wav, contentType: 'audio/wav' }); } catch { r = null; }
        if (my !== run) continue;
        const c = classifyRecognize(r);
        if (!c.ok) { fail(my, c.code); break; }
        const text = c.text.trim();
        if (text) src.onresult?.({ text, isFinal: true });
      }
    } finally { sending = false; }
  };

  src.start = ({ lang } = {}) => {
    src.stop();
    const my = ++run;
    const md = g.navigator?.mediaDevices;
    const AC = g.AudioContext ?? g.webkitAudioContext;
    if (!md?.getUserMedia || !AC) { Promise.resolve().then(() => fail(my, 'mic')); return; }
    md.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then((stream) => {
      if (my !== run) { stream.getTracks().forEach((t) => t.stop()); return; }
      media = stream;
      actx = new AC();
      input = actx.createMediaStreamSource(stream);
      node = actx.createScriptProcessor(FRAME, 1, 1);
      node.onaudioprocess = (ev) => {
        if (my !== run) return;
        const out = seg.push(ev.inputBuffer.getChannelData(0), actx.sampleRate);
        if (out) { queue.push({ my, lang, wav: encodeWav(out) }); void pump(); }
      };
      input.connect(node); node.connect(actx.destination);
      for (const t of stream.getAudioTracks()) t.onended = () => fail(my, 'mic');
    }, () => fail(my, 'mic'));
  };
  src.stop = () => { run++; release(); };
  return src;
}

// 状態表示・同意・メッセージの文言（ja/en）。speech.js が登録する。
export const AZURE_STRINGS = {
  ja: {
    'speech.status.azure.available': '使えます（Azure Speech・要同意）',
    'speech.status.azure.consent': '同意待ち（Azure Speech。同意すると始まります）',
    'speech.status.azure.unconfigured': '使えません（Azure Speech・未設定）',
    'speech.status.azure.auth': '使えません（Azure Speech・認証）',
    'speech.status.azure.network': '使えません（Azure Speech・接続）',
    'speech.status.azure.mic': '使えません（Azure Speech・マイク拒否）',
    'speech.azure.consent.label': '外部サービス（Azure Speech）での音声認識に同意する',
    'speech.azure.consent.notice': '同意すると、会議の音声が中継サーバーを通して、設定された Azure Speech のエンドポイント（{host}）へ送られます。同意はこのページを開いている間だけ有効で、音声は保存されません。',
    'speech.azure.host.unset': 'ホスト名は未取得',
    'speech.action.retryAzure': 'Azure Speech で再試行',
    'speech.action.useBrowser': 'ブラウザ標準に切り替え',
    'msg.azureConsent': 'Azure Speech での音声認識には同意が必要です。［記録開始］の近くの同意のチェックを入れると、音声認識が始まります。テキスト入力とファイルの取り込みは使えます',
    'msg.azureFail.unconfigured': 'Azure Speech が未設定のため、音声認識を止めました。記録済みの内容は保持されています。設定画面でエンドポイントとキーを保存するか、ブラウザ標準に切り替えてください',
    'msg.azureFail.auth': 'Azure Speech の認証に失敗したため、音声認識を止めました。記録済みの内容は保持されています。キーを確認して再試行するか、ブラウザ標準に切り替えてください',
    'msg.azureFail.network': 'Azure Speech に接続できないため、音声認識を止めました。記録済みの内容は保持されています。ネットワークを確認して再試行するか、ブラウザ標準に切り替えてください',
    'msg.azureFail.mic': 'マイクの許可が得られないため、Azure Speech での音声認識を止めました。記録済みの内容は保持されています。マイクを許可して再試行してください',
  },
  en: {
    'speech.status.azure.available': 'available (Azure Speech, consent required)',
    'speech.status.azure.consent': 'waiting for consent (Azure Speech starts when you consent)',
    'speech.status.azure.unconfigured': 'unavailable (Azure Speech, not configured)',
    'speech.status.azure.auth': 'unavailable (Azure Speech, authentication)',
    'speech.status.azure.network': 'unavailable (Azure Speech, connection)',
    'speech.status.azure.mic': 'unavailable (Azure Speech, microphone denied)',
    'speech.azure.consent.label': 'Allow speech recognition by an external service (Azure Speech)',
    'speech.azure.consent.notice': 'If you consent, meeting audio is sent through the relay server to the configured Azure Speech endpoint ({host}). Consent lasts only while this page is open, and audio is never saved.',
    'speech.azure.host.unset': 'host not loaded yet',
    'speech.action.retryAzure': 'Retry Azure Speech',
    'speech.action.useBrowser': 'Switch to browser',
    'msg.azureConsent': 'Consent is required for speech recognition by Azure Speech. Check the consent box near [Start recording] to start it. Text input and file import remain available',
    'msg.azureFail.unconfigured': 'Azure Speech is not configured, so speech recognition stopped. Your recorded content is kept. Save the endpoint and key in Settings, or switch to the browser method',
    'msg.azureFail.auth': 'Azure Speech authentication failed, so speech recognition stopped. Your recorded content is kept. Check the key and retry, or switch to the browser method',
    'msg.azureFail.network': 'Azure Speech cannot be reached, so speech recognition stopped. Your recorded content is kept. Check the network and retry, or switch to the browser method',
    'msg.azureFail.mic': 'Microphone permission was not granted, so Azure Speech recognition stopped. Your recorded content is kept. Allow the microphone and retry',
  },
};
