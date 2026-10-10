// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 添削量の著者別集計：Claude 名義（noreply@anthropic.com）の版は human に数えない。
// 実行: node --test tools/marp-scroll-sync/test/churn-authors.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const core = require('../lib/corpus-core.cjs');

const git = (root, args, env) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, env || {}) }).trim();
const deck = (slides) => ['---', 'marp: true', 'theme: academic', '---', ''].concat(slides.map(s => s + '\n\n---\n')).join('\n');

test('churnOf：touched は全部の版、human は人の版だけ。未コミットの手直しは human に入る', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'churn-authors-'));
  git(root, ['init', '-q', '-b', 'main']); git(root, ['config', 'user.name', 'Shoh Tagawa']); git(root, ['config', 'user.email', 'tagawa@example.ac.jp']);
  fs.mkdirSync(path.join(root, 'theme'), { recursive: true }); fs.writeFileSync(path.join(root, 'theme', 'academic.css'), '/* @theme academic */');
  const dir = path.join(root, 'slides', '20260101_T_a'); fs.mkdirSync(dir, { recursive: true });
  const md = path.join(dir, '20260101_T_a.md');
  const commit = (msg, author) => { git(root, ['add', '-A']); git(root, ['commit', '-q', '-m', msg].concat(author ? ['--author=' + author] : []), { GIT_COMMITTER_DATE: '2026-06-01T00:00:00' }); };
  fs.writeFileSync(md, deck(['# 自己紹介\n\n- 一行目', '# 二枚目\n\n- 変えない']));
  commit('init');
  fs.writeFileSync(md, deck(['# 自己紹介\n\n- 一行目\n- Claude が足した行', '# 二枚目\n\n- 変えない']));
  commit('[claude] Edit', 'Claude Code <noreply@anthropic.com>');
  fs.writeFileSync(md, deck(['# 自己紹介\n\n- 一行目\n- Claude が足した行\n- 人が足した行', '# 二枚目\n\n- 変えない']));
  commit('手直し');
  fs.writeFileSync(md, deck(['# 自己紹介\n\n- 一行目\n- Claude が足した行\n- 人が足した行\n- Claude 2', '# 二枚目\n\n- 変えない']));
  commit('[claude] Edit 2', 'Claude Code <noreply@anthropic.com>');
  const r = core.churnOf(root, md);
  const s1 = r.rows[0];
  assert.equal(s1.touched, 3, '3 つの版で内容が変わった');
  assert.equal(s1.human.touched, 1, '人の版は 1 つ');
  assert.ok(s1.human.churn >= 1 && s1.human.churn < s1.churn);
  assert.equal(r.rows[1].touched, 0); assert.equal(r.rows[1].human.touched, 0);
  // 未コミットの手直し → human に入る
  fs.writeFileSync(md, deck(['# 自己紹介\n\n- 一行目\n- Claude が足した行\n- 人が足した行\n- Claude 2\n- 未保存の手直し', '# 二枚目\n\n- 変えない']));
  const r2 = core.churnOf(root, md);
  assert.equal(r2.rows[0].touched, 4); assert.equal(r2.rows[0].human.touched, 2);
  // buildCorpus でも entry.churn.human に乗る（repoHistory 経由）
  const c = core.buildCorpus(root, { withChurn: true });
  const e = c.entries.find(x => x.slide === 1);
  assert.equal(e.churn.touched, 4); assert.equal(e.churn.human.touched, 2);
  assert.ok(core.isClaudeVersion({ email: 'noreply@anthropic.com' }) && !core.isClaudeVersion({ email: 'tagawa@example.ac.jp' }));
  fs.rmSync(root, { recursive: true, force: true });
});
