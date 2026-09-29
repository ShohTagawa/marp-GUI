// tools/lib/marp-env.mjs — mac / Windows / Linux 共通の環境解決ヘルパー。
//
// build-pdf.mjs / present.mjs / setup.mjs から import する。
//   - リポジトリルート・theme/*.css の列挙
//   - 「最後に編集したデック」の自動選択
//   - Chrome / Edge の実行ファイル探索（CHROME_PATH 環境変数が最優先）
//   - marp-cli の実行（node_modules に無ければ npm install を自動で走らせる）
//   - puppeteer-core の解決（marp-cli の依存として入るものを使う）
//   - OS 既定の方法でファイル/URL を開く
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

/** リポジトリルート（このファイルの2つ上 = tools/lib/../..） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** theme/ 直下の *.css をすべて返す（academic.css を先頭に：@import "academic" の解決のため） */
export function themeFiles(root = ROOT) {
  const dir = path.join(root, 'theme');
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
  const first = all.filter((f) => f === 'academic.css');
  const rest = all.filter((f) => f !== 'academic.css');
  return [...first, ...rest].map((f) => path.join(dir, f));
}

/**
 * slides/ 直下〜デック直下（深さ1〜2）の *.md から、'_' 始まり（一時ファイル）を除いて
 * 最新 mtime のものを返す。引数なし実行（npm run pdf / ▶ボタン）用。
 */
export function latestDeck(root = ROOT) {
  const slides = path.join(root, 'slides');
  const cands = [];
  // 原稿_*.md や CONTENT-BRIEF.md などデック以外の md を拾わないよう、frontmatter に marp: true があるものだけ。
  const isMarp = (p) => {
    try {
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(2048);
      const n = fs.readSync(fd, buf, 0, 2048, 0);
      fs.closeSync(fd);
      return /^---\r?\n[\s\S]*?\bmarp:\s*true\b/.test(buf.toString('utf8', 0, n));
    } catch { return false; }
  };
  const consider = (p) => {
    const b = path.basename(p);
    if (b.endsWith('.md') && !b.startsWith('_') && isMarp(p)) cands.push({ p, m: fs.statSync(p).mtimeMs });
  };
  for (const ent of fs.readdirSync(slides, { withFileTypes: true })) {
    const p1 = path.join(slides, ent.name);
    if (ent.isFile()) consider(p1);
    else if (ent.isDirectory()) {
      for (const e2 of fs.readdirSync(p1, { withFileTypes: true })) {
        if (e2.isFile()) consider(path.join(p1, e2.name));
      }
    }
  }
  cands.sort((a, b) => b.m - a.m);
  return cands.length ? cands[0].p : null;
}

/** Chrome / Chromium / Edge の実行パス。CHROME_PATH → OS 別の既知パス → PATH の順に探す。 */
export function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env) {
    if (fs.existsSync(env)) return env;
    throw new Error(`CHROME_PATH が指すファイルがありません: ${env}`);
  }
  const cands = [];
  if (IS_MAC) {
    cands.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    );
  } else if (IS_WIN) {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    cands.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Chromium', 'Application', 'chrome.exe'),
      path.join(local, 'Chromium', 'Application', 'chrome.exe'),
    );
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const r = spawnSync('which', [n], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) cands.push(r.stdout.trim());
    }
  }
  const hit = cands.find((p) => p && fs.existsSync(p));
  if (!hit) {
    throw new Error(
      'Chrome/Edge が見つかりません。Google Chrome をインストールするか、環境変数 CHROME_PATH に実行ファイルのパスを設定してください。\n' +
        '  探した場所:\n' + cands.map((c) => '    ' + c).join('\n'),
    );
  }
  return hit;
}

/**
 * npm / code など「Windows では .cmd シム」なコマンドを同期実行する。
 * Windows の .cmd は shell 経由でないと起動できない（Node 22+）。shell:true に args 配列を渡すと
 * DEP0190 警告が出るので、1本のコマンド文字列にして渡す（引数は空白を含まない前提）。
 */
export function shellSync(cmd, args, opts = {}) {
  if (IS_WIN) return spawnSync([cmd, ...args].join(' '), { ...opts, shell: true });
  return spawnSync(cmd, args, opts);
}

/** ルートの package.json を読む */
function rootPkg(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

/**
 * ルートの node_modules に marp-cli が入っているか。無ければ `npm install` を実行する。
 * 初回クローン直後や別PCでも、ボタン一発で動くようにするための自動セットアップ。
 */
export function ensureNodeModules(root = ROOT, { quiet = false } = {}) {
  const marker = path.join(root, 'node_modules', '@marp-team', 'marp-cli', 'package.json');
  const pdflib = path.join(root, 'node_modules', 'pdf-lib', 'package.json');
  if (fs.existsSync(marker) && fs.existsSync(pdflib)) return false;
  if (!quiet) console.log('[setup] node_modules が未整備のため npm install を実行します（初回のみ・1〜2分）');
  const r = shellSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: quiet ? 'ignore' : 'inherit' });
  if (r.status !== 0) throw new Error('npm install に失敗しました。ネットワーク・node/npm の導入を確認してください。');
  return true;
}

/** marp-cli 本体（marp-cli.js）の絶対パス。ローカル node_modules を使う。 */
export function marpCliEntry(root = ROOT) {
  ensureNodeModules(root);
  const req = createRequire(path.join(root, 'package.json'));
  const pkgPath = req.resolve('@marp-team/marp-cli/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.marp;
  return path.join(path.dirname(pkgPath), bin);
}

/**
 * marp-cli を同期実行する。--no-stdin / --html は必ず付ける（CLAUDE.md の必須ルール）。
 * @param {string[]} args  marp-cli への追加引数
 */
export function runMarp(args, { root = ROOT, cwd = root, inherit = false } = {}) {
  const entry = marpCliEntry(root);
  const full = [entry, '--no-stdin', '--html', ...args];
  const r = spawnSync(process.execPath, full, {
    cwd,
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: { ...process.env, CHROME_PATH: process.env.CHROME_PATH || safeFindChrome() || '' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const msg = (r.stderr || '') + (r.stdout || '');
    throw new Error('marp-cli が失敗しました:\n' + msg.trim());
  }
  return r;
}

function safeFindChrome() {
  try { return findChrome(); } catch { return null; }
}

/** puppeteer-core を marp-cli の依存として解決する（hoist の有無に依存しない） */
export async function loadPuppeteer(root = ROOT) {
  ensureNodeModules(root);
  const req = createRequire(path.join(root, 'package.json'));
  const marpPkg = req.resolve('@marp-team/marp-cli/package.json');
  const req2 = createRequire(marpPkg);
  const p = req2.resolve('puppeteer-core');
  const mod = await import(pathToFileURL(p).href);
  return mod.default || mod;
}

/** theme 指定の引数列を作る： ['--theme-set', a.css, b.css, ...] */
export function themeSetArgs(root = ROOT) {
  return ['--theme-set', ...themeFiles(root)];
}

/**
 * OS 既定の方法で URL / ファイルを開く（Chrome があれば Chrome を優先）。
 * 呼び出し元をブロックしないよう detached で起動する。
 */
export function openInBrowser(url, { chromeArgs = [] } = {}) {
  let chrome = null;
  try { chrome = findChrome(); } catch { /* fall through */ }
  if (chrome) {
    const child = spawn(chrome, [...chromeArgs, url], { detached: true, stdio: 'ignore' });
    child.unref();
    return chrome;
  }
  if (IS_WIN) {
    const child = spawn('cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } else if (IS_MAC) {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
  return 'default-browser';
}

/** ルートからの相対表示（ログ用） */
export function rel(p, root = ROOT) {
  const r = path.relative(root, p);
  return r.startsWith('..') ? p : r.split(path.sep).join('/');
}

export const platform = { IS_WIN, IS_MAC, rootPkg };
