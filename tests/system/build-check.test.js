// FR-113 起動のたびの検査（server/build.py）と旧い画面を出し続けない /sw.js の配信。
// 期待値は受入基準 AC-653〜AC-658 だけから決める（実装は未着手でもよい）。
// 検査は「壊した一時コピー」で行い、リポジトリのファイルは変更しない。外部通信はしない。
// 前提とする呼び出し: `python server/build.py`（引数なし・どこを cwd にしても、スクリプトの位置から web/・server/ を探す）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from './helpers.js';
import { PYTHON, freePort, rawRequest } from './relay-util.js';

const WIN = process.platform === 'win32';
const hasNode = spawnSync('node', ['--version']).status === 0;
const pyExe = spawnSync(PYTHON, ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
const pwsh = [['pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']], ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']]]
  .find(([c]) => spawnSync(c, ['-NoProfile', '-Command', 'exit 0']).status === 0);
const hasSh = !WIN && spawnSync('sh', ['-c', 'exit 0']).status === 0;

// 起動スクリプト・server/・web/ だけを一時ディレクトリへコピーする（壊す対象は常にコピー）
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-st-'));
  for (const f of ['start.ps1', 'start.sh', 'start.cmd']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const filter = (src) => !src.includes('__pycache__');
  fs.cpSync(path.join(ROOT, 'server'), path.join(dir, 'server'), { recursive: true, filter });
  fs.cpSync(path.join(ROOT, 'web'), path.join(dir, 'web'), { recursive: true, filter });
  return dir;
}
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const listAll = (d) => fs.readdirSync(d, { recursive: true }).map(String).sort();

function runBuild(dir, env = process.env) {
  return spawnSync(pyExe, [path.join(dir, 'server', 'build.py')], { cwd: dir, env, encoding: 'utf8', timeout: 60000 });
}

// 起動方法ごとのコマンド（AC-658: cmd は Windows のみ、sh は sh があるときのみ）
function launchers(dir) {
  const l = [];
  if (pwsh) l.push({ name: 'start.ps1', cmd: pwsh[0], args: [...pwsh[1], path.join(dir, 'start.ps1')] });
  if (WIN) l.push({ name: 'start.cmd', cmd: 'cmd.exe', args: ['/c', path.join(dir, 'start.cmd')] });
  if (hasSh) l.push({ name: 'start.sh', cmd: 'sh', args: [path.join(dir, 'start.sh')] });
  return l;
}
function killTree(child) {
  if (child.exitCode !== null) return;
  if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); else child.kill('SIGKILL');
}
// 起動スクリプトを走らせ、終了するまで（または stopWhen が真になるまで）出力を集める
function runLauncher(l, extra, { stopWhen = null, timeout = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(l.cmd, [...l.args, ...extra], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let done = false;
    const fin = (code) => { if (done) return; done = true; clearInterval(iv); clearTimeout(to); resolve({ code, out, child }); };
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (c) => fin(c));
    const iv = setInterval(() => { if (stopWhen && stopWhen(out)) fin(null); }, 150);
    const to = setTimeout(() => fin('timeout'), timeout);
  });
}
const listening = (port) => rawRequest(port, { path: '/', timeout: 1500 }).then(() => true, () => false);

// FR-113 AC-653 AC-658: 構文エラーがあれば、理由（ファイル名と位置）を表示して起動せず、0 以外で終了する
test('FR-113 AC-653 AC-658 server/*.py の構文エラーで検査が失敗し、中継サーバーは起動しない（直接・各起動スクリプト）', async () => {
  const dir = sandbox();
  try {
    const bad = path.join(dir, 'server', 'relay_config.py');
    fs.appendFileSync(bad, '\ndef broken(:\n    pass\n');
    const r = runBuild(dir);
    assert.notEqual(r.status, 0, '構文エラーがあるのに build.py が成功した');
    assert.match(r.stdout + r.stderr, /relay_config\.py/, 'ファイル名が表示されない');
    assert.match(r.stdout + r.stderr, /\d+/, '位置（行）が表示されない');
    assert.doesNotMatch(r.stdout, /build: OK/);
    // 起動スクリプトは検査の失敗で中継サーバーを起動せず、0 以外で終了する（start.cmd の終了コードにも伝わる）
    for (const l of launchers(dir)) {
      const port = await freePort();
      const res = await runLauncher(l, ['--port', String(port)]);
      assert.notEqual(res.code, 0, `${l.name}: 失敗した検査のあとで 0 または未終了(${res.code})`);
      assert.equal(await listening(port), false, `${l.name}: 検査が失敗したのに中継サーバーが起動した`);
      assert.match(res.out, /relay_config\.py/, `${l.name}: 失敗の理由（ファイル名）が表示されない`);
      assert.doesNotMatch(res.out, /build: OK/, l.name);
      killTree(res.child);
    }
  } finally { rm(dir); }
});

// FR-113 AC-654 AC-658: 成功時は「build: OK」を 1 行表示してから起動し、引数（--port）はそのまま中継サーバーへ渡る
test('FR-113 AC-654 AC-658 検査が成功すると「build: OK」のあとに起動し、渡した引数が中継サーバーに届く', async () => {
  const dir = sandbox();
  try {
    const ls = launchers(dir);
    assert.ok(ls.length > 0, '起動スクリプトを実行できる環境がない');
    for (const l of ls) {
      const port = await freePort();
      const res = await runLauncher(l, ['--port', String(port)], { stopWhen: (o) => o.includes(`127.0.0.1:${port}`) && o.includes('build: OK') });
      try {
        assert.equal(res.code, null, `${l.name}: 起動できない: ${res.out}`);
        const lines = res.out.split(/\r?\n/).filter((s) => s.trim() === 'build: OK');
        assert.equal(lines.length, 1, `${l.name}: 「build: OK」が 1 行ではない: ${res.out}`);
        assert.ok(res.out.indexOf('build: OK') < res.out.indexOf(`127.0.0.1:${port}`), `${l.name}: 検査より前に中継サーバーが起動した`);
        const t0 = Date.now();
        while (!(await listening(port))) {
          if (Date.now() - t0 > 15000) assert.fail(`${l.name}: 指定した --port ${port} で待ち受けない`);
          await new Promise((r) => setTimeout(r, 150));
        }
      } finally { killTree(res.child); }
    }
    // 起動のたびに検査する（前回の結果を使い回さない）: 検査のあとで壊すと、次の起動は失敗する
    fs.appendFileSync(path.join(dir, 'server', 'relay_config.py'), '\nx = (\n');
    const l0 = ls[0];
    const port = await freePort();
    const again = await runLauncher(l0, ['--port', String(port)]);
    assert.notEqual(again.code, 0, '2 回目の起動で再検査されず、壊れたコードのまま起動した');
    assert.equal(await listening(port), false);
    killTree(again.child);
  } finally { rm(dir); }
});

// FR-113 AC-655: node があれば web/src/*.js を node --check で調べ、なければ省略して続行する
test('FR-113 AC-655 web/src/*.js の構文エラーで失敗し、node がないときは省略を表示して続行する', { skip: hasNode ? false : 'node がない環境' }, () => {
  const dir = sandbox();
  try {
    const js = fs.readdirSync(path.join(dir, 'web', 'src')).filter((f) => f.endsWith('.js'));
    assert.ok(js.length > 0);
    const ok = runBuild(dir);
    assert.equal(ok.status, 0, `正常なコードで失敗した: ${ok.stdout}${ok.stderr}`);
    assert.match(ok.stdout, /build: OK/);
    // 末尾のファイルを壊す（すべてのファイルを調べていることの確認）
    const target = js.sort().pop();
    fs.appendFileSync(path.join(dir, 'web', 'src', target), '\nconst = ;\n');
    const bad = runBuild(dir);
    assert.notEqual(bad.status, 0, 'web/src/*.js の構文エラーで失敗しない');
    assert.match(bad.stdout + bad.stderr, new RegExp(target.replace('.', '\\.')));
    assert.doesNotMatch(bad.stdout, /build: OK/);
    // node が使えない（PATH に node がない）: web の検査を省略したことを表示し、成功する。server/*.py の検査は行う
    const noNode = { ...process.env, PATH: path.dirname(pyExe), Path: path.dirname(pyExe) };
    const skipped = runBuild(dir, noNode);
    assert.equal(skipped.status, 0, `node がないだけで失敗した: ${skipped.stdout}${skipped.stderr}`);
    assert.match(skipped.stdout + skipped.stderr, /node/i, '省略したことが表示されない');
    assert.match(skipped.stdout, /build: OK/);
    fs.appendFileSync(path.join(dir, 'server', 'relay_config.py'), '\ndef broken(:\n');
    const pyBad = runBuild(dir, noNode);
    assert.notEqual(pyBad.status, 0, 'node がなくても server/*.py の検査は行う');
  } finally { rm(dir); }
});

// FR-113 AC-656: /sw.js は要求のたびに、web/ の sw.js 以外の資産の内容ハッシュを VERSION の末尾に付け、no-store で返す
test('FR-113 AC-656 /sw.js の VERSION が資産の内容で変わり（再起動不要）、同じ内容なら同じで、no-store', async () => {
  const dir = sandbox();
  const port = await freePort();
  const child = spawn(PYTHON, [path.join(dir, 'server', 'relay.py'), '--port', String(port), '--web', path.join(dir, 'web')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    const t0 = Date.now();
    while (!(await listening(port))) {
      if (child.exitCode !== null || Date.now() - t0 > 15000) assert.fail(`中継サーバーが起動しない: ${out}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    const get = async () => {
      const r = await rawRequest(port, { path: '/sw.js' });
      const body = r.body ?? r.text ?? '';
      const m = String(body).match(/const VERSION = '([^']*)'/);
      assert.ok(m, `VERSION の行がない: ${String(body).slice(0, 200)}`);
      return { version: m[1], headers: r.headers, status: r.status, body: String(body) };
    };
    const orig = fs.readFileSync(path.join(ROOT, 'web', 'sw.js'), 'utf8').match(/const VERSION = '([^']*)'/)[1];
    const a = await get();
    assert.equal(a.status, 200);
    assert.match(String(a.headers['cache-control']), /no-store/);
    assert.ok(a.version.startsWith(orig), `VERSION が元の値 ${orig} で始まらない: ${a.version}`);
    assert.ok(a.version.length > orig.length, '内容ハッシュが末尾に付かない');
    assert.match(a.version, /^grp-shell-v\d+/, 'tests/unit/sw-version.test.js が前提とする形式を保つ');
    const a2 = await get();
    assert.equal(a2.version, a.version, '内容が同じなのに VERSION が変わった');
    // 資産（sw.js 以外）を変更すると、サーバーを再起動せずに VERSION が変わる
    fs.appendFileSync(path.join(dir, 'web', 'src', 'main.js'), '\n// changed\n');
    const b = await get();
    assert.notEqual(b.version, a.version, '資産を変えても VERSION が変わらない（旧い画面が残る）');
    assert.ok(b.version.startsWith(orig));
    assert.match(String(b.headers['cache-control']), /no-store/);
    // 元の内容へ戻すと元の値に戻る（内容だけで決まる）
    fs.writeFileSync(path.join(dir, 'web', 'src', 'main.js'), fs.readFileSync(path.join(ROOT, 'web', 'src', 'main.js')));
    assert.equal((await get()).version, a.version);
    // リポジトリの web/sw.js の本体は変えない
    assert.match(fs.readFileSync(path.join(ROOT, 'web', 'sw.js'), 'utf8'), /const VERSION = 'grp-shell-v\d+';/);
  } finally { killTree(child); rm(dir); }
});

// FR-113 AC-657: 検査は生成物を残さず、標準ライブラリだけで、外部通信をしない
test('FR-113 AC-657 検査のあとにファイルが増えず（__pycache__ なし）、git status に差分がなく、外部通信の部品を使わない', () => {
  const dir = sandbox();
  try {
    const before = listAll(dir);
    const r = runBuild(dir);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.deepEqual(listAll(dir), before, '検査が生成物（バイトコード・一時ファイル）を残した');
    // リポジトリでも実行し、git status が変わらない
    const st = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8' }).stdout;
    const s0 = st();
    const rr = spawnSync(pyExe, [path.join(ROOT, 'server', 'build.py')], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
    assert.equal(rr.status, 0, `${rr.stdout}${rr.stderr}`);
    assert.equal(st(), s0, '検査のあとで git status に差分が出た');
    // 外部通信をしない（ネットワークの部品を import しない）・標準ライブラリだけ
    const src = fs.readFileSync(path.join(ROOT, 'server', 'build.py'), 'utf8');
    assert.doesNotMatch(src, /^\s*(import|from)\s+(socket|urllib|http|ssl|requests|ftplib|smtplib|asyncio)\b/m, '外部通信の部品を使っている');
    const mods = [...src.matchAll(/^\s*(?:import|from)\s+([A-Za-z_][\w]*)/gm)].map((m) => m[1]);
    const std = spawnSync(pyExe, ['-c', `import sys\nm=${JSON.stringify(mods)}\nprint(','.join(x for x in m if x not in sys.stdlib_module_names and x!='__future__'))`], { encoding: 'utf8' });
    assert.equal(std.stdout.trim(), '', `標準ライブラリ以外を import している: ${std.stdout}`);
  } finally { rm(dir); }
});
