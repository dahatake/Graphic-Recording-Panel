// NFR-DOC-001 AC-062: README と users-guide の日本語ドキュメントの検査（見出し・リンク・画面の用語）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const GUIDE = fs.readdirSync(path.join(ROOT, 'users-guide')).filter((f) => f.endsWith('.md')).map((f) => `users-guide/${f}`);
const DOCS = ['README.md', ...GUIDE];

const SUBJECTS = ['導入', '起動', '音声入力', 'ファイル取込', '図の見方', '保存', '言語切替', '2D / 3D', 'プレゼンテーション', 'トラブルシュート'];

// NFR-DOC-001 AC-062: 各主題に見出しがあり、日本語で書かれている
test('NFR-DOC-001 AC-062: 必須の主題の見出しが users-guide にあり、文書は日本語', () => {
  const heads = GUIDE.flatMap((f) => read(f).split('\n').filter((l) => /^#{1,3} /.test(l)));
  for (const s of SUBJECTS) assert.ok(heads.some((h) => h.includes(s)), `見出し「${s}」がない`);
  for (const f of DOCS) assert.match(read(f), /[ぁ-んァ-ヶ]{5}/, `${f} は日本語で書かれている`);
});

// NFR-DOC-001 AC-062: README から users-guide の全文書へリンクがあり、すべてのリンク先（相対）が実在する
test('NFR-DOC-001 AC-062: README が users-guide の各文書にリンクし、リンク切れがない', () => {
  const readme = read('README.md');
  for (const f of GUIDE) assert.ok(readme.includes(`](${f})`), `README から ${f} へのリンクがない`);
  for (const f of DOCS) {
    const dir = path.dirname(path.join(ROOT, f));
    for (const m of read(f).matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      assert.ok(fs.existsSync(path.resolve(dir, m[1])), `${f}: リンク切れ ${m[1]}`);
    }
  }
});

// NFR-DOC-001 AC-062: 「」で囲んだ画面の用語は、アプリ（index.html・src）の日本語の表示に存在する
test('NFR-DOC-001 AC-062: 「」の画面の用語がアプリの表示と一致する', () => {
  const WEB = path.join(ROOT, 'web');
  const src = [path.join(WEB, 'index.html'), ...fs.readdirSync(path.join(WEB, 'src')).map((f) => path.join(WEB, 'src', f))]
    .map((p) => fs.readFileSync(p, 'utf8')).join('\n');
  const OS_SETTING = new Set(['動きを減らす']); // OS 側の設定名（アプリの表示ではない）
  for (const f of GUIDE) {
    for (const m of read(f).matchAll(/「([^」]+)」/g)) {
      if (OS_SETTING.has(m[1])) continue;
      assert.ok(src.includes(m[1]), `${f}: 「${m[1]}」がアプリの表示にない`);
    }
  }
});

// NFR-DOC-001 AC-062: 起動手順とキー割り当てが実装と一致する
test('NFR-DOC-001 AC-062: 起動コマンドとキー割り当てが実装と一致する', () => {
  assert.match(read('README.md'), /python -m http\.server -d web/);
  assert.match(read('users-guide/01-getting-started.md'), /python -m http\.server -d web/);
  const keys = read('web/src/keymap.js') + read('web/src/speech.js');
  for (const k of ['r', 'p', 'e', 'x', 'n', 'i', 's', 'w', 'j', 'k', 'd', 'v', 'g', 'h', 'y', 't', 'm']) {
    assert.ok(new RegExp(`key: '${k}'`).test(keys), `キー ${k} が実装にない`);
    assert.match(read('users-guide/05-language-and-views.md'), new RegExp(`\\b${k.toUpperCase()}\\b`));
  }
});

// NFR-DOC-001 AC-112: 新機能（NFR-UX-003・FR-018〜FR-021）の主題の見出しが日本語の文書にある
test('NFR-DOC-001 AC-112: 新機能の各主題に見出しがある', () => {
  const heads = GUIDE.flatMap((f) => read(f).split('\n').filter((l) => /^#{1,3} /.test(l)));
  for (const s of ['ラベル', '初期化', 'セッションファイルの保存と読込', '3D の評価軸', '3D の画面操作と操作説明']) {
    assert.ok(heads.some((h) => h.includes(s)), `見出し「${s}」がない`);
  }
});
