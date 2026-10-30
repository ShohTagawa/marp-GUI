#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// npm test の実体：tools/marp-scroll-sync/test/*.test.cjs を自分で列挙して `node --test` に渡す。
//
//   npm test                                   # 全部（ファイルを 1 つずつ直列に）
//   npm test -- --test-name-pattern=トリミング   # node --test への引数はそのまま渡る
//
// なぜ要るか：Node 20 の `node --test` は引数をファイルかフォルダのパスとして読み、グロブを展開しない
// （グロブの引数は Node 22 の文書にある。引用符つきの "…/*.test.cjs" は Node 20 では 1 つのパス扱いになる）。
// 一方 Node 26 はフォルダを渡すと失敗扱いになる。ファイルを並べて渡せば、Node 20／22／26 のどれでも同じに動く。
// 直列（--test-concurrency=1）にするのは、速さの予算を測る試験があるため。--test-concurrency を知らない node
// では、ファイルを 1 つずつ別の `node --test` で順に走らせる（結果は同じ。最後に失敗したファイルを並べる）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join('tools', 'marp-scroll-sync', 'test');
const files = fs.readdirSync(path.join(ROOT, TEST_DIR))
  .filter((n) => n.endsWith('.test.cjs'))
  .sort()
  .map((n) => path.join(TEST_DIR, n));
if (!files.length) { console.error(`run-tests: ${TEST_DIR} に *.test.cjs がありません`); process.exit(1); }
const extra = process.argv.slice(2);

// --test-concurrency を受け付けるか（受け付けない node は "bad option" で exit 9）
const probe = spawnSync(process.execPath, ['--test-concurrency=1', '-e', ''], { stdio: 'ignore' });
const hasConcurrency = probe.status === 0;

if (hasConcurrency) {
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...extra, ...files], { cwd: ROOT, stdio: 'inherit' });
  child.on('error', (e) => { console.error('run-tests: ' + e.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code === null ? 1 : code; if (signal) console.error('run-tests: ' + signal); });
} else {
  const failed = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--test', ...extra, f], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) failed.push(f);
  }
  console.log(`\nrun-tests: ${files.length} files, ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`);
  process.exitCode = failed.length ? 1 : 0;
}
