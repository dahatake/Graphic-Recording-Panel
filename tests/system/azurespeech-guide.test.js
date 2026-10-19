// FR-082 AC-451（検証レベル unit。users-guide の記述の検査。期待値は受入基準だけから決める）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const GUIDE = path.join(ROOT, 'users-guide');
const read = () => fs.readdirSync(GUIDE).filter((f) => f.endsWith('.md')).map((f) => ({ f, t: fs.readFileSync(path.join(GUIDE, f), 'utf8') }));

// FR-082 AC-451
test('FR-082 AC-451: users-guide に Azure Speech の設定・接続テスト・方式の切替・同意・失敗時の対処・再配置の周期の手順が日本語で書かれている', () => {
  const docs = read();
  const az = docs.filter((d) => d.t.includes('Azure Speech'));
  assert.ok(az.length >= 1, 'Azure Speech を扱う文書がある');
  const all = az.map((d) => d.t).join('\n');
  const need = {
    'エンドポイント': /エンドポイント/, 'キー': /キー/, '保存': /保存/, '変更': /変更|置き換/, '削除': /削除/,
    '接続テスト': /接続テスト/, '方式の切替': /方式/, '同意': /同意/, '失敗時の対処': /(失敗|うまく(いか|動か)|エラー)[\s\S]{0,400}(対処|確認|再試行|切り替)/,
    '図の再配置の周期（FR-080）': /再配置[\s\S]{0,200}(周期|秒)|(周期|秒)[\s\S]{0,200}再配置/,
  };
  const docsAll = docs.map((d) => d.t).join('\n');
  for (const [name, re] of Object.entries(need)) {
    const hay = name.startsWith('図の再配置') ? docsAll : all;
    assert.ok(re.test(hay), `users-guide に「${name}」の手順がない`);
  }
  assert.ok(/[\u3040-\u30ff]/.test(all), '日本語で書かれている');
  const index = fs.readFileSync(path.join(GUIDE, 'README.md'), 'utf8');
  assert.ok(az.some((d) => d.f === 'README.md' || index.includes(d.f)), '目次から辿れる');
});

test('FR-082 AC-451 異常系: users-guide はキーとエンドポイントの実値を含まない（例はプレースホルダだけ）', () => {
  const placeholder = /<|\*|\{|example|contoso|your|sample|placeholder|xxx|name|resource|dummy/i;
  const hits = [];
  for (const { f, t } of read()) {
    for (const m of t.matchAll(/([^\s/"'`(]+)\.cognitiveservices\.azure\.com/g)) if (!placeholder.test(m[1])) hits.push(`${f}: ${m[0]}`);
    for (const m of t.matchAll(/\b[0-9a-f]{32}\b|\b[A-Za-z0-9]{84}\b/g)) hits.push(`${f}: ${m[0].slice(0, 8)}…（キーの実値らしい文字列）`);
  }
  assert.deepEqual(hits, []);
});
