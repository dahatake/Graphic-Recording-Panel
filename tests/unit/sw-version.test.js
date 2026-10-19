// NFR-OFFLINE-001 AC-031（再発防止）: web/ の資産が変わったら sw.js の VERSION を上げる。
// 資産の内容ハッシュと VERSION の組を tests/unit/sw-version.json に固定する。資産を変えたのに VERSION を据え置くと、
// cache-first の SW が旧い画面を出し続ける（FR-072〜074 の反映漏れ）。変更したら VERSION を上げ、json を更新する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'web');
const PIN = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'sw-version.json'), 'utf8'));

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}
function assetHash() {
  const h = crypto.createHash('sha256');
  const list = files(WEB).map((f) => path.relative(WEB, f).split(path.sep).join('/')).filter((f) => f !== 'sw.js').sort();
  for (const f of list) {
    h.update(f + '\n');
    h.update(fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n'));
  }
  return h.digest('hex');
}
const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
const version = /const VERSION = '([^']+)'/.exec(sw)?.[1];

test('NFR-OFFLINE-001 AC-031: web/ の資産が変わったら sw.js の VERSION も上がっている', () => {
  const now = assetHash();
  if (version === PIN.version) {
    assert.equal(now, PIN.hash, `web/ の資産が変わったのに VERSION（${version}）が同じです。sw.js の VERSION を上げ、tests/unit/sw-version.json の version と hash（${now}）を更新してください`);
  } else {
    assert.equal(now, PIN.hash, `VERSION を ${version} に上げたら、tests/unit/sw-version.json の version と hash（${now}）も更新してください`);
  }
});

test('NFR-OFFLINE-001 AC-031: web/src と web/styles の全ファイルが SW の SHELL に入っている', () => {
  const shell = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]));
  for (const f of files(WEB).map((x) => path.relative(WEB, x).split(path.sep).join('/'))) {
    if (f.startsWith('src/') || f.startsWith('styles/')) assert.ok(shell.has(f), `${f} が sw.js の SHELL にありません`);
  }
});
