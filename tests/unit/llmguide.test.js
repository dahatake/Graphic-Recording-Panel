// FR-069 AC-357: LLM 連携の使い方ガイドの検査（項目の有無と、キー・トークンの実値がないこと）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('FR-069 AC-357: users-guide/08-llm.md が必要な項目を含み、実値を含まない', () => {
  const t = fs.readFileSync(path.join(ROOT, 'users-guide', '08-llm.md'), 'utf8');
  for (const w of ['エンドポイント', 'デプロイ名', 'API キー', 'Entra', '同意', '既定', 'オフ', '方式2', 'トラブル', 'config/llm.example.json', 'config/llm.local.json']) {
    assert.ok(t.includes(w), `${w} がない`);
  }
  assert.ok(!/sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}|\b[0-9a-f]{32}\b/.test(t), '実値らしい文字列');
});
