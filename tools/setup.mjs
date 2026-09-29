#!/usr/bin/env node
// tools/setup.mjs — marp-GUI を使い始めるときの一発セットアップ（mac / Windows / Linux）。
//
//   npm run setup            すべて実行
//   npm run setup -- --check 状態確認だけ（何も変更しない）
//
// やること:
//   1. ルートの npm install（marp-cli / pdf-lib）
//   2. tools/marp-scroll-sync の npm install（同期プレビュー拡張の依存 marp-core）
//   3. VS Code 拡張 2つを ~/.vscode/extensions にリンク
//        - marp-gui.scroll-sync（同期プレビュー・プレビュー上での編集）
//        - marp-gui.pdf        （▶プレゼン / 📄PDF ボタン）
//      Windows はジャンクション（管理者権限・開発者モード不要）、mac/Linux はシンボリックリンク。
//   4. Chrome / Edge の有無を表示
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, findChrome, platform, shellSync } from './lib/marp-env.mjs';

const { IS_WIN } = platform;
const CHECK = process.argv.includes('--check');
let failed = false;
const ok = (s) => console.log('  ✔ ' + s);
const ng = (s) => { failed = true; console.log('  ✘ ' + s); };
const info = (s) => console.log('  · ' + s);

function npmInstall(dir, label) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  const missing = deps.filter((d) => !fs.existsSync(path.join(dir, 'node_modules', d, 'package.json')));
  if (!missing.length) { ok(`${label}: 依存は揃っています`); return; }
  if (CHECK) { ng(`${label}: 未インストール → ${missing.join(', ')}`); return; }
  info(`${label}: npm install（${missing.join(', ')}）… 数分かかることがあります`);
  const r = shellSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
  if (r.status === 0) ok(`${label}: インストール完了`); else ng(`${label}: npm install 失敗 (exit=${r.status})`);
}

function linkExtension(srcRel, linkName) {
  const want = fs.realpathSync(path.join(ROOT, srcRel));
  const extDir = path.join(os.homedir(), '.vscode', 'extensions');
  const link = path.join(extDir, linkName);
  let current = null;
  try {
    const st = fs.lstatSync(link);
    if (st.isSymbolicLink() || (IS_WIN && st.isDirectory())) {
      try { current = fs.realpathSync(link); } catch { current = '(壊れたリンク)'; }
    } else { current = '(リンクではない実体)'; }
  } catch { /* 無い */ }
  if (current && path.resolve(current) === path.resolve(want)) { ok(`${linkName}: 登録済み`); return; }
  if (CHECK) { ng(`${linkName}: 未登録${current ? `（現在: ${current}）` : ''}`); return; }
  fs.mkdirSync(extDir, { recursive: true });
  if (current) {
    if (current === '(リンクではない実体)') { ng(`${linkName}: ${link} はリンクではない実フォルダなので触りません。手で退避してください。`); return; }
    fs.rmSync(link, { recursive: false, force: true });   // フォルダを動かした後の古いリンクを貼り直す
  }
  fs.symlinkSync(want, link, IS_WIN ? 'junction' : 'dir');
  ok(`${linkName}: 登録しました → ${link}`);
}

console.log(`\n== marp-GUI セットアップ (${process.platform}) ${CHECK ? '[確認のみ]' : ''}`);
console.log(`   場所: ${ROOT}\n`);

console.log('[1] Node パッケージ');
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) ng(`Node.js ${process.version} は古すぎます。20 以上を https://nodejs.org/ から入れてください`);
else ok(`Node.js ${process.version}`);
npmInstall(ROOT, 'marp-cli / pdf-lib');
npmInstall(path.join(ROOT, 'tools', 'marp-scroll-sync'), '同期プレビュー拡張 (marp-core)');

console.log('\n[2] VS Code 拡張');
linkExtension('tools/marp-scroll-sync', 'marp-gui.scroll-sync');
linkExtension('tools/marp-pdf/vscode-extension', 'marp-gui.pdf');

console.log('\n[3] ブラウザ（PDF・プレゼン用）');
try { ok(`Chrome/Edge: ${findChrome()}`); } catch (e) { ng('Chrome か Edge が見つかりません。Google Chrome を入れてください（PDF とプレゼンに使います）'); }

if (failed) {
  console.log('\n✘ 上の ✘ の行を確認してください。\n');
  process.exitCode = 1;
} else if (!CHECK) {
  console.log('\n完了しました。次は:');
  console.log('  1. VS Code でこのフォルダ（marp-GUI）を開く（開いていたら「Developer: Reload Window」）');
  console.log('  2. slides/sample-layouts/sample-layouts.md を開く');
  console.log('  3. ⌘K M（Windows は Ctrl+K M）で同期プレビューを開く\n');
}
