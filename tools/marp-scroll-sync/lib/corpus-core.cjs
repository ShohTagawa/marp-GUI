// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 既存の全スライドの索引と検索（DESIGN.md 7.1）。vscode 非依存。Node 標準モジュールだけ。
//   buildCorpus  … slides/ 配下の全デックをスライド単位に索引化（本文・型・素材・印・git の添削量・重複の束）
//   searchCorpus … 索引に対する部分一致の検索（全角/半角・大文字小文字・長音の揺れに強い）
//   readShelf / resolveShelf / shelfAdd … 棚（呼び名と並び順を自分で決める。DESIGN.md 8.2）
//   churnOf      … git の履歴から、スライドごとの添削量を数える（tools/marp-library.mjs から移設）
// 拡張（プレビューの検索ギャラリー）と CLI（tools/marp-library.mjs corpus / search）が同じ実装を使う。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const core = require('./library-core.cjs');
const { splitDeck, slideMeta } = require('./slide-split.cjs');

/** 索引の形を変えたら上げる（古い corpus.json を cache として使わないため） */
const CORPUS_VERSION = 1;
const TEXT_MAX = 600;

// ───────────────────────── git ─────────────────────────

let GIT = null;
/**
 * 動く git を探す。PATH の git が動かない環境（mac で Xcode のライセンス未同意の /usr/bin/git）では Homebrew の git を使う。
 * 見つからなければ例外（呼び出し側が「履歴なし」として続けるか、止めるかを決める）。
 */
function gitBin() {
  if (GIT) return GIT;
  for (const g of [process.env.GIT, 'git', '/opt/homebrew/bin/git', '/usr/local/bin/git'].filter(Boolean)) {
    try { execFileSync(g, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] }); GIT = g; return g; } catch (_) { /* 次へ */ }
  }
  throw new Error('git が見つかりません（環境変数 GIT で場所を指定できます）');
}

function runGit(repoRoot, args, bin) {
  return execFileSync(bin || gitBin(), ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * 複数の版の中身を 1 回の git 起動で読む（`git show sha:path` を版の数だけ起動すると、全デックで 1000 回を超えて遅い）。
 * specs = ['<sha>:<path>', …]。戻り値は同じ並びの文字列（読めないものは null）。
 */
function catFiles(repoRoot, specs, bin) {
  if (!specs.length) return [];
  let buf;
  try {
    buf = execFileSync(bin || gitBin(), ['-C', repoRoot, 'cat-file', '--batch'], { input: specs.join('\n') + '\n', maxBuffer: 1024 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (_) { return specs.map(() => null); }
  const out = [];
  let pos = 0;
  for (let n = 0; n < specs.length; n++) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) { out.push(null); continue; }
    const head = buf.toString('utf8', pos, nl);
    const m = head.match(/^[0-9a-f]+ (\w+) (\d+)$/);
    if (!m) { out.push(null); pos = nl + 1; continue; } // 「… missing」など
    const size = Number(m[2]);
    out.push(m[1] === 'blob' ? buf.toString('utf8', nl + 1, nl + 1 + size) : null);
    pos = nl + 1 + size + 1;
  }
  return out;
}

/**
 * リポジトリ全体の md の履歴を 1 回の git log で読み、ファイルごとの版の一覧を引けるようにする
 * （デックごとに git log --follow を起動すると 1 本 0.25 秒、全デックで 40 秒かかるため）。
 * versionsOf(mdRel) は新しい順の [{ sha, date, path }]。改名（R）と、別デックからの複製（C。フォークしたデック）は、
 * その版での元の名前へさかのぼって追う（git log --follow と同じ追い方。元デックで重ねた添削も、そのスライドの添削に数える）。
 */
function repoHistory(repoRoot, bin) {
  const raw = runGit(repoRoot, ['-c', 'core.quotepath=off', 'log', '-M', '-C', '--find-copies-harder', '--name-status', '--format=C %H %ad %ae', '--date=short', '--', '*.md'], bin);
  const commits = [];
  let c = null;
  for (const l of raw.split('\n')) {
    if (l.startsWith('C ')) { const [, sha, date, email] = l.split(' '); c = { sha, date, email: email || '', changes: [] }; commits.push(c); }
    else if (/^[AMRC]\d*\t/.test(l) && c) { const p = l.split('\t'); c.changes.push({ from: l[0] === 'R' || l[0] === 'C' ? p[1] : null, to: p[p.length - 1] }); }
  }
  return {
    commits: commits.length,
    versionsOf(mdRel) {
      const out = [];
      let tracked = mdRel;
      for (const cm of commits) {
        const ch = cm.changes.find((x) => x.to === tracked);
        if (!ch) continue;
        out.push({ sha: cm.sha, date: cm.date, email: cm.email || '', path: tracked });
        if (ch.from) tracked = ch.from;
      }
      return out;
    },
  };
}

// ───────────────────────── 添削量（churn） ─────────────────────────

/** Claude 名義のコミットか（tools/git-attrib/hook.mjs が付ける author）。追加の目印は CLAUDE_AUTHORS に足す */
const CLAUDE_AUTHORS = [/noreply@anthropic\.com$/i];
const isClaudeVersion = (v) => !!(v && typeof v.email === 'string' && CLAUDE_AUTHORS.some((re) => re.test(v.email)));

const normLines = (lines) => lines.map((l) => l.trim()).filter((l) => l && !/^<!--\s*_?class:/.test(l) && !/^_lib:/.test(l));

const setJaccard = (A, B) => {
  if (!A.size && !B.size) return 1;
  let inter = 0;
  const [S, L] = A.size <= B.size ? [A, B] : [B, A];
  for (const x of S) if (L.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
};
/** 行（または n-gram）の集合どうしの Jaccard 係数。配列でも Set でも受ける */
function jaccard(a, b) {
  return setJaccard(a instanceof Set ? a : new Set(a), b instanceof Set ? b : new Set(b));
}

/** 行の多重集合としての差（足した行＋消した行）。並べ替えは数えない */
function lineDelta(a, b) {
  const c = new Map();
  for (const x of a) c.set(x, (c.get(x) || 0) + 1);
  let add = 0;
  for (const x of b) { const v = c.get(x) || 0; if (v > 0) c.set(x, v - 1); else add++; }
  let del = 0;
  for (const v of c.values()) del += v;
  return add + del;
}

/**
 * 原稿をスライドに分け、対応付けに使う形にする。
 * parseDeck は style や配色まで解くので、履歴の全版に当てるには重い。ここでは分割の正本（slide-split）だけを使う
 * （題名・_class・印の読み方は parseDeck と同じ slideMeta）。
 */
function slidesOf(text) {
  const sd = splitDeck(String(text));
  return sd.slides.map((s) => {
    const meta = slideMeta(sd.lines, s.startLine, s.endLine);
    const norm = normLines(sd.lines.slice(s.startLine, s.endLine));
    return { index: s.index, title: meta.title, marked: meta.marked, classes: meta.classes, norm, set: new Set(norm) };
  });
}

/**
 * スライドごとの添削量。全版を古い順にたどり、各版のスライドを「題名の一致＋行集合の類似」で今のスライドに対応付けて、
 * 内容が変わった版の数（touched）と変更行数（churn）を数える。何度も直されたスライドほど「好みの正解」に近い。
 *   opts.text … 今の原稿（未保存の内容を見るとき。省略時はディスク）
 *   opts.git  … git の場所（省略時は gitBin()）
 *   opts.versions … そのファイルの版の一覧（新しい順。repoHistory().versionsOf の戻り値）。省略時は git log --follow で調べる
 * 戻り値：{ mdRel, versions, rows:[{ slide, title, pattern, marked, touched, churn, last }] }
 */
function churnOf(repoRoot, mdAbs, opts) {
  opts = opts || {};
  const bin = opts.git || gitBin();
  const mdRel = path.relative(repoRoot, mdAbs).split(path.sep).join('/');
  const cur = slidesOf(typeof opts.text === 'string' ? opts.text : fs.readFileSync(mdAbs, 'utf8'));
  let versions;
  if (Array.isArray(opts.versions)) versions = opts.versions.map((v) => ({ ...v }));
  else {
    const logRaw = runGit(repoRoot, ['log', '--follow', '--name-status', '--format=C %H %ad %ae', '--date=short', '--', mdRel], bin);
    versions = [];
    let c = null;
    for (const l of logRaw.split('\n')) {
      if (l.startsWith('C ')) { const [, sha, date, email] = l.split(' '); c = { sha, date, email: email || '', path: null }; versions.push(c); }
      else if (/^[AMR]/.test(l) && c) { const p = l.split('\t'); c.path = p[p.length - 1]; }
    }
  }
  versions.reverse();
  const stat = cur.map(() => ({ touched: 0, churn: 0, last: '', human: { touched: 0, churn: 0, last: '' } }));
  const chain = cur.map(() => null);
  const blobs = catFiles(repoRoot, versions.map((v) => `${v.sha}:${v.path}`), bin);
  const snaps = blobs.map((b) => (b === null ? null : slidesOf(b)));
  snaps.push(cur); // 未コミットの手直しも 1 版として数える
  versions.push({ sha: 'WORKTREE', date: '(未コミット)' });
  snaps.forEach((snap, v) => {
    if (!snap) return;
    const used = new Set();
    cur.forEach((cs, i) => {
      let best = -1, bestScore = 0;
      snap.forEach((o, j) => {
        if (used.has(j)) return;
        let sc = setJaccard(cs.set, o.set);
        if (cs.title && o.title === cs.title) sc += 1;
        if (sc > bestScore) { bestScore = sc; best = j; }
      });
      if (best < 0 || bestScore < 0.3) return;
      used.add(best);
      const o = snap[best];
      if (chain[i]) {
        const d = lineDelta(chain[i].norm, o.norm);
        if (d > 0) {
          stat[i].touched++; stat[i].churn += d; stat[i].last = versions[v].date;
          // 人の版だけを別に数える。AI 名義（noreply@anthropic.com）のコミットは除く。未コミットの手直しは人の分
          if (!isClaudeVersion(versions[v])) { stat[i].human.touched++; stat[i].human.churn += d; stat[i].human.last = versions[v].date; }
        }
      }
      chain[i] = o;
    });
  });
  return { mdRel, versions: versions.length - 1, rows: cur.map((s, i) => ({ slide: i + 1, title: s.title, pattern: s.classes[0] || '', marked: s.marked, ...stat[i] })) };
}

// ───────────────────────── 本文の抽出 ─────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rarr: '→', larr: '←', times: '×', middot: '・' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, n) => {
    if (n[0] === '#') {
      const cp = /^#x/i.test(n) ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (_) { return ' '; }
    }
    const v = ENTITIES[n.toLowerCase()];
    return v === undefined ? m : v;
  });
}

const stripTags = (s) => s.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * 検索と重複判定に使う本文。発表者ノート・ディレクティブ（どちらも HTML コメント）・<style>・インライン SVG の中身・
 * HTML タグ・Markdown の記号を除き、空白を 1 つに畳む。
 * 図だけのスライドは本文が空になるので、SVG の <text> の文字（図のラベル）を拾う。戻り値 { text, svgText }
 */
function extractText(fragment) {
  let s = String(fragment);
  const comments = core.findComments(s);
  for (const c of [...comments].reverse()) s = s.slice(0, c.start) + ' ' + s.slice(c.end);
  s = s.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ');
  const labels = [];
  s = s.replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, (svg) => {
    const re = /<text\b[^>]*>([\s\S]*?)<\/text\s*>/gi;
    let m;
    while ((m = re.exec(svg))) { const t = squash(decodeEntities(stripTags(m[1]))); if (t) labels.push(t); }
    return ' ';
  });
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')       // 画像：代替テキストだけ残す
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');             // リンク：文字だけ残す
  s = decodeEntities(stripTags(s));
  s = s.split(/\r?\n/).map((l) => l
    .replace(/^\s*(?:```|~~~).*$/, ' ')                   // フェンスの行（中のコードは本文として残す）
    .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/, ' ')        // 表の区切り行
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*(?:>\s*)+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\|/g, ' ')).join(' ');
  s = s.replace(/\*\*|__|~~|`/g, '').replace(/(^|[^\\])\*/g, '$1').replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1');
  return { text: squash(s).normalize('NFC'), svgText: squash(labels.join(' ')).normalize('NFC') };
}

// ───────────────────────── 走査・添削マップ ─────────────────────────

// work/ は制作途中の断片、old/・orig/ は旧版や取り込み元の控え（同じスライドが二重に出るので載せない）
// parts/ はデックを組み立てる前の断片（本体と同じスライドが二重に出る）
const SKIP_DIRS = new Set(['node_modules', 'out', '_library', 'work', 'old', 'orig', 'parts', '.git']);

function walkDecks(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    // .bak は手直し前の控え（lecture-script や手作業のバックアップ）。同じスライドが二重に出るので載せない
    if (e.name.startsWith('.') || e.name.startsWith('_') || /\.bak\b|backup/i.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkDecks(p, out); }
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
}

const isMarp = (text) => /^---\r?\n[\s\S]*?\bmarp:\s*true\b/.test(text.slice(0, 4096));

/** デック名の揺れ（# と _、大文字小文字）を吸収して比べるための形 */
const normDeckName = (s) => String(s).toLowerCase().replace(/[#\s]/g, '_');

/**
 * 手本にするデックの一覧（任意のファイル。配布版には無い）。リポジトリからの相対パス。
 * 書くのは利用者で、git で追跡してよい（corpus.json と違い生成物ではない）。形は Markdown：
 *
 *   ## A. 手本（何度も手を入れて仕上げたデック）
 *   - slides/20260101_Event_deck-a/
 *   ## B. 準手本
 *   | `slides/20260202_Event_deck-b` | メモ |
 *
 * 「## A.」「## B.」の節にあるデックのスライドは、score に +0.4／+0.2 が付き、ホームに A／B の印が出る。
 * ほかの見出し（## C. など）の節は読まない。ファイルが無ければ群は付かず、score は変わらない。
 */
const GROUPS_FILE = 'slides/_library/groups.md';

/**
 * GROUPS_FILE の「## A.」「## B.」の節にある slides/… のパスを拾う。戻り値 [{ name, group }]。
 * 表の列や書式が変わっても落ちないよう、節の見出しとパスの形だけを頼りにする。
 * `slides/20260101+0102_Event_x` は 20260101_… と 20260102_… の 2 本として読む。読めなければ []。
 * text を渡すとファイルの代わりにそれを読む（テスト用）。
 */
function readRevisionGroups(repoRoot, text) {
  try {
    if (typeof text !== 'string') text = fs.readFileSync(path.join(repoRoot, ...GROUPS_FILE.split('/')), 'utf8');
  } catch (_) { return []; }
  const out = [];
  let group = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^#{1,3}\s+([A-Z])[.．\s]/);
    if (h) { group = h[1] === 'A' || h[1] === 'B' ? h[1] : null; continue; }
    if (!group) continue;
    const re = /slides\/([^\s|`）)、,]+)/g;
    let m;
    while ((m = re.exec(line))) {
      const seg = m[1].replace(/\/+$/, '').split('/')[0].replace(/\.md$/, '');
      const multi = seg.match(/^(\d{4})(\d{4})((?:\+\d{4})+)(_.*)$/);
      if (multi) {
        out.push({ name: normDeckName(multi[1] + multi[2] + multi[4]), group });
        for (const d of multi[3].split('+').filter(Boolean)) out.push({ name: normDeckName(multi[1] + d + multi[4]), group });
      } else out.push({ name: normDeckName(seg), group });
    }
  }
  return out;
}

/** deck（slides/… の相対パス）がどの群か。パスのどこかの階層名が表の名前と一致（またはその名前で始まる）なら、その群 */
function groupOf(deckRel, groups) {
  if (!groups.length) return null;
  const segs = deckRel.split('/').slice(1).map((s) => normDeckName(s.replace(/\.md$/, '')));
  let hit = null;
  for (const g of groups) {
    if (segs.some((s) => s === g.name || s.startsWith(g.name + '_') || s.startsWith(g.name + '-'))) {
      if (g.group === 'A') return 'A';
      hit = g.group;
    }
  }
  return hit;
}

function dateOf(deckRel) {
  const segs = deckRel.split('/');
  for (let i = segs.length - 1; i >= 0; i--) {
    const m = segs[i].match(/^(\d{4})(\d{2})(\d{2})(?!\d)/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

// ───────────────────────── score ─────────────────────────

const dayNum = (d) => (d ? Date.parse(d + 'T00:00:00Z') / 86400000 : NaN);

/**
 * 手を入れた度合い（大きいほど「作り込んだ・使える」スライド）。小数 2 桁。
 *
 *   score = 6                                   … ★（完成の印）がある
 *         + 3 × (1 − 0.6^touched)               … 内容が変わった版の数。1回=1.2、2回=1.92、3回=2.35、5回=2.77、上限 3
 *         + min(1, log10(1 + lines) / 3)        … 変更行数の合計。10行=0.35、100行=0.67、1000行以上=1
 *         + 0.1 × min(tune, 5)                  … プレビューのつまみで調整した箇所（ss-tune）。上限 0.5
 *         + 0.4／0.2（任意の GROUPS_FILE＝slides/_library/groups.md で A／B に挙げたデック。無ければ 0）
 *         + 0.3 × max(0, 1 − 経過日数/365)      … 新しいデックに小さな加点（newest＝索引の中で最も新しいデックの日付が基準。
 *                                                  実行日を基準にしないのは、同じ索引から同じ値が出るようにするため）
 *         − 2                                   … pptx 変換のまま（converted）。★ が付いていれば引かない（本人が完成と認めたもの）
 *
 * 印の無いスライドの上限は 3+1+0.5+0.4+0.3 = 5.2 なので、★ は必ずその上に来る。
 * 1回も直していないスライドは最大 0.7、変換のままで直していないスライドは負。
 * 順序「★ > 何度も直した > 1回も直していない > pptx 変換のまま」は test/corpus-core.test.cjs で固定している。
 */
function scoreOf(e, newest) {
  const touched = e.churn ? e.churn.touched : 0;
  const lines = e.churn ? e.churn.lines : 0;
  let s = 0;
  if (e.mark) s += 6;
  s += 3 * (1 - Math.pow(0.6, touched));
  s += Math.min(1, Math.log10(1 + lines) / 3);
  s += 0.1 * Math.min(e.tune || 0, 5);
  s += e.group === 'A' ? 0.4 : e.group === 'B' ? 0.2 : 0;
  const age = dayNum(newest) - dayNum(e.date);
  if (Number.isFinite(age)) s += 0.3 * Math.max(0, Math.min(1, 1 - age / 365));
  if (e.converted && !e.mark) s -= 2;
  return Math.round(s * 100) / 100;
}

// ───────────────────────── 正規化（検索・重複） ─────────────────────────

/**
 * 揺れを吸収した形：NFKC（全角英数→半角、半角カナ→全角）・小文字化・空白と長音「ー」を落とす
 * （「サーバー/サーバ」「生成 AI/生成AI」を同じに扱う）。map を渡すと、結果の各文字が元の何文字目かを入れる（snippet 用）。
 * 1文字ずつ正規化するので、結合文字（か＋゛）は合成されない。本文は extractText で NFC にしてある。
 */
function normalizeForSearch(s, map) {
  s = String(s || '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let ch;
    if (c <= 0x20 || c === 0x3000 || c === 0xa0) continue;
    if (c < 0x80) ch = (c >= 65 && c <= 90) ? String.fromCharCode(c + 32) : s[i];
    else if (c === 0x30fc || c === 0xff70) continue;                                  // ー ｰ
    else if ((c >= 0x3041 && c <= 0x3096) || (c >= 0x30a1 && c <= 0x30fa) || (c >= 0x4e00 && c <= 0x9fff)) ch = s[i]; // かな・漢字は NFKC で変わらない
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { ch = s.slice(i, i + 2).normalize('NFKC').toLowerCase(); if (map) for (let k = 0; k < ch.length; k++) map.push(i); out += ch; i++; continue; }
    else ch = s[i].normalize('NFKC').toLowerCase().replace(/[\sー]/g, '');
    if (map) for (let k = 0; k < ch.length; k++) map.push(i);
    out += ch;
  }
  return out;
}

const normTitle = (s) => normalizeForSearch(s).replace(/[\p{P}\p{S}]/gu, '');

function grams4(s) {
  const n = normalizeForSearch(s);
  const set = new Set();
  if (n.length < 4) { if (n) set.add(n); return set; }
  for (let i = 0; i + 4 <= n.length; i++) set.add(n.slice(i, i + 4));
  return set;
}

/**
 * 重複のまとめ。使い回したスライド（自己紹介・連絡先・フォークしたデック）が検索結果を埋めないようにする。
 * 全体を総当たりすると O(n²) なので、正規化した題名（無題は本文の先頭 40 字）でバケツに分け、その中だけを比べる。
 * バケツの中は score の高い順（同点は新しい順）に見て、既存の代表のどれかと本文の文字 4-gram Jaccard ≥ 0.7 ならその束に入れる。
 * 代表に dupCount（束の大きさ）、ほかに dupOf（代表の key）を書く。
 */
function dedupe(entries) {
  const buckets = new Map();
  for (const e of entries) {
    e.dupOf = null; e.dupCount = 1;
    const k = normTitle(e.title) || normTitle(e.text).slice(0, 40);
    if (!k) continue; // 題名も本文も無い（写真だけ等）。中身を比べられないので束ねない
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  }
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    list.sort(byScore);
    const reps = [];
    for (const e of list) {
      const g = grams4(e.text);
      const rep = reps.find((r) => setJaccard(r.g, g) >= 0.7);
      if (rep) { e.dupOf = rep.e.key; rep.e.dupCount++; } else reps.push({ e, g });
    }
  }
}

/**
 * score の高い順。同点は新しいデックが先、同じ日付ならデックのパス順、同じデックの中はスライド番号の順
 * （数として比べる：#2 が #10 より先）。最後に key で順序を必ず決める（同じ入力からは同じ並び）。
 */
const byScore = (a, b) => b.score - a.score
  || String(b.date || '').localeCompare(String(a.date || ''))
  || String(a.deck || '').localeCompare(String(b.deck || ''))
  || (Number(a.slide) || 0) - (Number(b.slide) || 0)
  || String(a.key || '').localeCompare(String(b.key || ''));

// ───────────────────────── buildCorpus ─────────────────────────

/** デック 1 本分の entry（churn・group・score・重複は後で入れる） */
function entriesOfDeck(repoRoot, deckRel, mdAbs, text) {
  const deck = core.parseDeck(text, { path: mdAbs });
  const deckName = path.basename(deckRel).replace(/\.md$/, '');
  const date = dateOf(deckRel);
  // デック固有クラス＝テーマに無く、このデックの style（scoped でないもの）で定義されたクラス。library-core の fragmentDeps と同じ定義。
  // slideDeps をスライドごとに呼ぶと CSS を毎回解くので、デックで 1 回だけ解く
  const inTheme = core.themeClasses(repoRoot).byTheme[deck.theme] || new Set();
  const defined = new Set();
  for (const b of deck.styleBlocks) if (!b.scoped) { try { for (const r of core.cssRules(b.css)) for (const c of r.classes) defined.add(c); } catch (_) { /* 壊れた CSS は数えない */ } }
  // pptx 変換のまま：座標再現のキャンバスを使う、または style 属性の直書きが 1 枚あたり平均 5 個以上（体裁が手で組まれていない）
  const styleAttrs = (text.match(/\sstyle\s*=\s*["']/g) || []).length;
  const converted = /class\s*=\s*["'][^"']*\bppt-canvas\b/.test(text) || styleAttrs / Math.max(1, deck.slides.length) >= 5;
  return deck.slides.map((s, i) => {
    const frag = core.slideText(deck, i);
    const ex = extractText(frag);
    // 図だけ（本文がほぼ題名だけ）のスライドは、図のラベルを本文の代わりにする
    const bodyLen = ex.text.length - (s.title ? s.title.length : 0);
    const full = ex.svgText && bodyLen < 40 ? squash(ex.text + ' ' + ex.svgText) : ex.text;
    const used = core.classesUsed(frag);
    if (!s.classes.length) for (const c of String(core.globalClassAt(deck, i) || '').split(/\s+/)) if (c) used.add(c);
    let assets = 0;
    const seen = new Set();
    for (const r of core.listRefs(frag)) {
      const ref = r.ref.replace(/[?#].*$/, '');
      if (/^(?:\.\/)?src\//.test(ref) && !seen.has(ref)) { seen.add(ref); assets++; }
    }
    return {
      key: `${deckRel}#${i + 1}`, deck: deckRel, deckName, slide: i + 1,
      title: s.title || '', pattern: s.classes[0] || '', theme: deck.theme, date,
      text: full.slice(0, TEXT_MAX), chars: full.length,
      hasSvg: /<svg\b/i.test(frag), hasImg: /<img\b|!\[[^\]]*\]\(/i.test(frag), hasVideo: /<video\b/i.test(frag), assets,
      deckClasses: [...used].filter((c) => !inTheme.has(c) && defined.has(c)).length,
      mark: s.mark ? { id: s.mark.id, tags: s.mark.tags || [] } : null, from: s.from || null,
      tune: (frag.match(/\bss-tune\b/g) || []).length,
      churn: null, group: null, converted, score: 0, dupOf: null, dupCount: 1,
    };
  });
}

/**
 * 索引を作る（書き込みはしない。writeCorpus が書く）。
 *   withChurn … git の履歴から添削量を数える（全デックで 1 分前後）。false なら数えない（cache にあれば引き継ぐ）
 *   cache     … 前回の戻り値。md の mtimeMs+size が同じデックは本文を読み直さない。
 *               churn は、withChurn のときは HEAD も同じ場合だけ使い回す。withChurn=false のときは md が同じなら引き継ぐ
 *               （md が変わっていなければ、未コミットの手直しも含めて数えた結果は変わらないため。無いよりずっと役に立つ）
 *   textOf    … 未保存の原稿を差し込む口（abs → string | undefined）
 *   git       … git の場所。onProgress(done, total, deckRel) は CLI の進み具合の表示用
 * 戻り値：{ version, generatedAt, head, withChurn, decks:{ [deck]: { mtimeMs, size, churn:boolean } }, entries, warnings }
 */
function buildCorpus(repoRoot, opts) {
  opts = opts || {};
  const withChurn = opts.withChurn !== false;
  const textOf = typeof opts.textOf === 'function' ? opts.textOf : null;
  const cache = opts.cache && opts.cache.version === CORPUS_VERSION && Array.isArray(opts.cache.entries) && opts.cache.decks ? opts.cache : null;
  const warnings = [];

  let bin = opts.git || null, head = null;
  try { if (!bin) bin = gitBin(); head = runGit(repoRoot, ['rev-parse', 'HEAD'], bin).trim() || null; } catch (_) { head = null; }
  if (withChurn && !bin) warnings.push('git が見つからないので、添削量（churn）は数えていません');

  // 履歴は最初に必要になったときに 1 回だけ読む（全部 cache で済むなら読まない）
  let history;
  const historyOf = (deckRel) => {
    if (history === undefined) { try { history = repoHistory(repoRoot, bin); } catch (_) { history = null; } }
    return history ? history.versionsOf(deckRel) : undefined;
  };

  const cached = new Map();
  if (cache) for (const e of cache.entries) { if (!cached.has(e.deck)) cached.set(e.deck, []); cached.get(e.deck).push(e); }

  const files = [];
  walkDecks(path.join(repoRoot, 'slides'), files);
  files.sort();
  const groups = readRevisionGroups(repoRoot);
  const entries = [];
  const decks = {};
  let done = 0;
  for (const f of files) {
    const deckRel = path.relative(repoRoot, f).split(path.sep).join('/');
    let st, live;
    try { st = fs.statSync(f); live = textOf ? textOf(f) : undefined; } catch (_) { continue; }
    const isLive = typeof live === 'string';
    const c = cache && !isLive ? cache.decks[deckRel] : null;
    const same = !!(c && c.mtimeMs === st.mtimeMs && c.size === st.size && cached.has(deckRel));
    let list, text = null;
    if (same) list = cached.get(deckRel).map((e) => ({ ...e }));
    else {
      try { text = isLive ? live : fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
      if (!isMarp(text)) { done++; continue; }
      try { list = entriesOfDeck(repoRoot, deckRel, f, text); } catch (e) {
        warnings.push(`${deckRel}: 読めません（${String(e.message || e).split('\n')[0]}）`);
        continue;
      }
    }
    // 添削量。1 デックずつ守る（履歴が読めないデックがあっても、ほかは続ける）
    let hasChurn = false;
    const reusable = same && c.churn && list.every((e) => e.churn);
    if (reusable && (!withChurn || (head && cache.head === head))) hasChurn = true;
    else {
      for (const e of list) e.churn = null;
      if (withChurn && bin) {
        try {
          const r = churnOf(repoRoot, f, { git: bin, text: text === null ? undefined : text, versions: historyOf(deckRel) });
          if (r.rows.length === list.length) {
            const lastOf = (x) => (x && /^\d{4}-/.test(x) ? x : (x ? 'worktree' : ''));
            list.forEach((e, i) => {
              const row = r.rows[i];
              e.churn = { touched: row.touched, lines: row.churn, last: lastOf(row.last) };
              if (row.human) e.churn.human = { touched: row.human.touched, lines: row.human.churn, last: lastOf(row.human.last) };
            });
            hasChurn = true;
          }
        } catch (e) { warnings.push(`${deckRel}: 履歴を読めません（${String(e.message || e).split('\n')[0]}）`); }
      }
    }
    const group = groupOf(deckRel, groups);
    for (const e of list) { e.group = group; entries.push(e); }
    // 未保存の内容から作った分は、次回ディスクの内容で作り直させる（mtime を記録しない）
    decks[deckRel] = { mtimeMs: isLive ? -1 : st.mtimeMs, size: isLive ? -1 : st.size, churn: hasChurn };
    done++;
    if (opts.onProgress) { try { opts.onProgress(done, files.length, deckRel); } catch (_) { /* 表示の失敗で止めない */ } }
  }

  let newest = null;
  for (const e of entries) if (e.date && (!newest || e.date > newest)) newest = e.date;
  for (const e of entries) e.score = scoreOf(e, newest);
  dedupe(entries);
  return { version: CORPUS_VERSION, generatedAt: new Date().toISOString(), head, withChurn, decks, entries, warnings };
}

// ───────────────────────── searchCorpus ─────────────────────────

// 型（_class）は英語の名前なので、日本語でも引けるようにする（「自己紹介」で intro 型も当たる）
const PATTERN_WORDS = {
  intro: '自己紹介', cover: '表紙', 'cover-hero': '表紙', summary: 'まとめ', refs: '参考文献 引用文献', qa: '質疑 質問',
  divider: '章扉 区切り', message: 'メッセージ', fig: '図', split: '左右 2列', 'sec-open': '章扉',
};

const normCache = new WeakMap();
function normsOf(corpus) {
  let n = normCache.get(corpus);
  if (!n || n.length !== corpus.entries.length) {
    n = corpus.entries.map((e) => ({
      title: normalizeForSearch(e.title),
      text: normalizeForSearch(e.text),
      tags: normalizeForSearch(e.mark ? [e.mark.id].concat(e.mark.tags || []).join(' ') : ''),
      deck: normalizeForSearch(e.deckName),
      pattern: normalizeForSearch((e.pattern || '') + ' ' + (PATTERN_WORDS[e.pattern] || '')),
    }));
    normCache.set(corpus, n);
  }
  return n;
}

function snippetOf(text, terms) {
  const SPAN = 40;
  const map = [];
  const n = normalizeForSearch(text, map);
  let at = -1, len = 0;
  for (const t of terms) { const p = n.indexOf(t); if (p >= 0) { at = p; len = t.length; break; } }
  if (at < 0) return text.length > SPAN * 2 ? text.slice(0, SPAN * 2) + '…' : text;
  const s0 = map[at], s1 = map[at + len - 1] + 1;
  const a = Math.max(0, s0 - SPAN), b = Math.min(text.length, s1 + SPAN);
  return (a > 0 ? '…' : '') + text.slice(a, b).trim() + (b < text.length ? '…' : '');
}

/**
 * 検索。query は空白区切りの AND。題名・本文・タグ（印の id とタグ）・デック名・型への部分一致（分かち書きはしない）。
 * 関連度（sort:'relevance'）＝ 語ごとに［題名 10（題名そのものなら +4）／タグ 8／本文 3（先頭 80 字以内なら +1）／デック名 2／型 2］の合計
 *   ＋ score（同じくらい当たったものの中で、手を入れたスライドを上に、pptx 変換のままを下に。作者の手元のデック群の「自己紹介」で、
 *   題名が同じ 20 枚余りのうち添削済みの版が先頭に来る重みにした。題名に当たらないものが題名に当たったものを越えることはない：score は −2〜5.2＋6）。
 * query が空なら score 順。dedupe は「当たったものの中で」同じ束を 1 件にする（代表が絞り込みで外れても、束の中の次点が残る）。
 * opts.shelf（resolveShelf の戻り値）を渡すと、棚の呼び名（題名と同じ 10）と棚名（8）にも当たり、棚のスライドを先頭に出す。
 * 戻り値：{ total, items:[{ entry, snippet, titleHit, dupCount, shelf:{name,label}|null }] }
 */
function searchCorpus(corpus, query, opts) {
  opts = opts || {};
  const entries = (corpus && corpus.entries) || [];
  const terms = String(query || '').split(/[\s　]+/).map((t) => normalizeForSearch(t)).filter(Boolean);
  const norms = normsOf(corpus && corpus.entries ? corpus : { entries });
  const sort = opts.sort === 'score' || opts.sort === 'recent' ? opts.sort : (terms.length ? 'relevance' : 'score');
  const dedupeOn = opts.dedupe !== false;
  // 棚（resolveShelf の戻り値）。同じスライドが複数の棚にあるときは、先に出てくる棚の呼び名を使う（検索は全部の呼び名に当てる）
  const shelfOf = new Map();
  let order = 0;
  for (const sv of Array.isArray(opts.shelf) ? opts.shelf : []) {
    for (const it of (sv && sv.items) || []) {
      if (!it || !it.entry || !it.entry.key) continue;
      const cur = shelfOf.get(it.entry.key);
      if (cur) { cur.nLabel += ' ' + normalizeForSearch(it.label); cur.nName += ' ' + normalizeForSearch(sv.name); }
      else shelfOf.set(it.entry.key, { name: sv.name, label: it.label, order: order++, nLabel: normalizeForSearch(it.label), nName: normalizeForSearch(sv.name) });
    }
  }
  const hits = [];
  entries.forEach((e, i) => {
    if (opts.onlyMarked && !e.mark) return;
    if (opts.theme && e.theme !== opts.theme) return;
    if (opts.excludeDeck && e.deck === opts.excludeDeck) return;
    const n = norms[i];
    const sh = shelfOf.get(e.key);
    let rel = 0, titleHit = terms.length > 0;
    for (const t of terms) {
      let r = 0;
      if (sh) { if (sh.nLabel.includes(t)) r += 10; if (sh.nName.includes(t)) r += 8; }
      const inTitle = n.title.includes(t);
      if (inTitle) r += n.title === t ? 14 : 10; else titleHit = false;
      if (n.tags.includes(t)) r += 8;
      const p = n.text.indexOf(t);
      if (p >= 0) r += p < 80 ? 4 : 3;
      if (n.deck.includes(t)) r += 2;
      if (n.pattern.includes(t)) r += 2;
      if (!r) return; // AND：どこにも無い語が 1 つでもあれば外す
      rel += r;
    }
    hits.push({ e, rel: rel + e.score, titleHit, shelf: sh || null });
  });
  const base = sort === 'recent'
    ? (a, b) => String(b.e.date || '').localeCompare(String(a.e.date || '')) || byScore(a.e, b.e)
    : sort === 'score' ? (a, b) => byScore(a.e, b.e)
      : (a, b) => b.rel - a.rel || byScore(a.e, b.e);
  // 棚のスライドは先頭。語があるときは棚の中でも関連順、語が無いときは棚に並べた順（自分で決めた並び）
  const cmp = (a, b) => {
    if (!a.shelf !== !b.shelf) return a.shelf ? -1 : 1;
    if (a.shelf && b.shelf && !terms.length && sort === 'score' && opts.sort !== 'score') return a.shelf.order - b.shelf.order;
    return base(a, b);
  };
  hits.sort(cmp);
  let list = hits;
  const sizes = new Map();
  if (dedupeOn) {
    list = [];
    for (const h of hits) {
      const k = h.e.dupOf || h.e.key;
      // 棚のスライドは、似た内容どうしでも自分で呼び名を付けて区別したものなので、まとめない
      if (h.shelf || !sizes.has(k)) list.push(h);
      sizes.set(k, (sizes.get(k) || 0) + 1);
    }
  }
  const offset = Math.max(0, opts.offset | 0);
  const limit = opts.limit === undefined ? 24 : Math.max(0, opts.limit | 0);
  const items = list.slice(offset, offset + limit).map((h) => ({
    entry: h.e, snippet: snippetOf(h.e.text || '', terms), titleHit: h.titleHit,
    shelf: h.shelf ? { name: h.shelf.name, label: h.shelf.label } : null,
    // 束の大きさ。絞り込みの外にある分も含めた全体の数（代表の dupCount）を優先し、分からなければ当たった中の数
    dupCount: dedupeOn ? Math.max(sizes.get(h.e.dupOf || h.e.key) || 1, h.e.dupOf ? 0 : h.e.dupCount || 1) : 1,
  }));
  return { total: list.length, items };
}

// ───────────────────────── 読み書き ─────────────────────────

const corpusPath = (repoRoot) => path.join(repoRoot, 'slides', '_library', 'corpus.json');

/** 読めない・形が違う・版が古いときは null（呼び出し側は作り直す） */
function readCorpus(repoRoot, file) {
  try {
    const c = JSON.parse(fs.readFileSync(file || corpusPath(repoRoot), 'utf8'));
    return c && c.version === CORPUS_VERSION && Array.isArray(c.entries) ? c : null;
  } catch (_) { return null; }
}

/** 一時ファイルに書いてから置き換える（拡張が読んでいる最中に、書きかけの JSON を見せない）。戻り値は書いた場所 */
function writeCorpus(repoRoot, corpus, file) {
  const p = file || corpusPath(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(corpus));
  fs.renameSync(tmp, p);
  return p;
}

// ───────────────────────── 棚（DESIGN.md 8.2） ─────────────────────────
// slides/_library/shelf.json。呼び名と並び順は利用者が自分で決める。git で追跡し、手で編集されることもある。
//   { "version": 1, "shelves": [ { "name": "自己紹介", "items": [ { "label", "deck", "id"?, "slide"?, "title"? } ] } ] }
// 知らないキーは読み書きで保つ。編集の関数はどれも純粋（引数を変えず、新しい棚を返す）。

const SHELF_VERSION = 1;
const shelfPath = (repoRoot) => path.join(repoRoot, 'slides', '_library', 'shelf.json');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cleanName = (v) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
const sameRef = (a, b) => a.deck === b.deck && ((a.id && b.id) ? a.id === b.id : ((a.slide || 0) === (b.slide || 0) && normTitle(a.title || '') === normTitle(b.title || '')));

/**
 * 手で書かれた棚を、落ちない形に整える。戻り値 { shelf, warnings }。
 * 同じ名前の棚は 1 つにまとめ、同じ棚の中の同じスライドは先の 1 つだけ残す（どちらも warnings に出す）。
 */
function normalizeShelf(raw) {
  const warnings = [];
  const out = { ...(isObj(raw) ? raw : {}), version: SHELF_VERSION, shelves: [] };
  const list = isObj(raw) && Array.isArray(raw.shelves) ? raw.shelves : [];
  const byName = new Map();
  list.forEach((sv, n) => {
    if (!isObj(sv)) { warnings.push(`棚 ${n + 1} 番目が読めない形なので飛ばしました`); return; }
    const name = cleanName(sv.name) || '（名前なし）';
    let dst = byName.get(name);
    if (dst) warnings.push(`棚「${name}」が 2 つあるので 1 つにまとめました`);
    else { dst = { ...sv, name, items: [] }; byName.set(name, dst); out.shelves.push(dst); }
    for (const it of Array.isArray(sv.items) ? sv.items : []) {
      if (!isObj(it) || typeof it.deck !== 'string' || !it.deck.trim()) { warnings.push(`棚「${name}」に deck の無い項目があるので飛ばしました`); continue; }
      const item = { ...it, deck: it.deck.trim().split('\\').join('/').replace(/^\.\//, '') };
      if (item.id !== undefined && (typeof item.id !== 'string' || !item.id)) delete item.id;
      if (item.slide !== undefined) { const v = Number(item.slide); if (Number.isInteger(v) && v >= 1) item.slide = v; else delete item.slide; }
      if (item.title !== undefined && typeof item.title !== 'string') item.title = String(item.title);
      item.label = cleanName(item.label) || cleanName(item.title) || item.id || path.basename(item.deck, '.md');
      if (dst.items.some((x) => sameRef(x, item))) { warnings.push(`棚「${name}」に同じスライドが 2 回あるので 1 つにしました（${item.label}）`); continue; }
      dst.items.push(item);
    }
  });
  return { shelf: out, warnings };
}

/**
 * 棚を読む。戻り値 { version, shelves, warnings, exists, broken }（warnings・exists・broken は列挙されないので、そのまま writeShelf に渡せる）。
 * 無ければ空の棚。JSON として読めない・shelves が配列でないときは空の棚＋broken:true（writeShelf はそのファイルを上書きしない）。
 */
function readShelf(repoRoot, file) {
  const p = file || shelfPath(repoRoot);
  let raw = null, exists = false, broken = false;
  const warnings = [];
  let text = null;
  try { text = fs.readFileSync(p, 'utf8'); exists = true; } catch (e) { if (e && e.code !== 'ENOENT') { exists = true; broken = true; warnings.push(`棚を読めません（${e.code || e.message}）`); } }
  if (text !== null) {
    try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { broken = true; warnings.push(`shelf.json が JSON として読めません（${String(e.message).split('\n')[0]}）。直すまで棚は空として扱い、ファイルは上書きしません`); }
    if (!broken && (!isObj(raw) || (raw.shelves !== undefined && !Array.isArray(raw.shelves)))) { broken = true; raw = null; warnings.push('shelf.json の形が違います（{ "version": 1, "shelves": [ … ] }）。直すまで棚は空として扱い、ファイルは上書きしません'); }
  }
  const n = normalizeShelf(raw);
  const shelf = n.shelf;
  for (const [k, v] of [['warnings', warnings.concat(n.warnings)], ['exists', exists], ['broken', broken]]) Object.defineProperty(shelf, k, { value: v, enumerable: false, writable: true });
  return shelf;
}

/**
 * 棚を書く。戻り値 { ok, path, reason? }。今あるファイルが壊れている（readShelf が broken）ときは書かない
 * （手で編集している途中の内容を、空の棚で潰さないため）。一時ファイルに書いてから置き換える。
 */
function writeShelf(repoRoot, shelf, file) {
  const p = file || shelfPath(repoRoot);
  const cur = readShelf(repoRoot, p);
  if (cur.broken) return { ok: false, path: p, reason: 'shelf.json が壊れているので、上書きしませんでした。ファイルを直してからやり直してください（' + (cur.warnings[0] || '') + '）' };
  const n = normalizeShelf(shelf).shelf;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(n, null, 2) + '\n');
    fs.renameSync(tmp, p);
  } catch (e) { return { ok: false, path: p, reason: `棚を書けません（${e.code || e.message}）` }; }
  return { ok: true, path: p };
}

/**
 * 棚の参照を索引のスライドに結び付ける。解決順：id（★ の印。デックが改名されていても追える。同じ id が複数あれば同じデックを優先）
 * → 同じデックで題名が一致（複数あれば slide 番号に近いもの）→ 同じデックの slide 番号。
 * 見つからなければ entry:null（行方不明）。棚からは消さない。how はどれで見つけたか（'id'|'title'|'slide'|null）。
 * 戻り値：[{ name, items:[{ label, entry|null, how, ref }] }]
 */
function resolveShelf(shelf, corpus) {
  const entries = (corpus && corpus.entries) || [];
  const byId = new Map(), byDeck = new Map();
  for (const e of entries) {
    if (e.mark && e.mark.id) { if (!byId.has(e.mark.id)) byId.set(e.mark.id, []); byId.get(e.mark.id).push(e); }
    if (!byDeck.has(e.deck)) byDeck.set(e.deck, []);
    byDeck.get(e.deck).push(e);
  }
  return normalizeShelf(shelf).shelf.shelves.map((sv) => ({
    name: sv.name,
    items: sv.items.map((ref) => {
      let entry = null, how = null;
      const ids = ref.id ? byId.get(ref.id) : null;
      if (ids && ids.length) { entry = ids.find((e) => e.deck === ref.deck) || ids[0]; how = 'id'; }
      const inDeck = byDeck.get(ref.deck) || [];
      if (!entry && ref.title) {
        const t = normTitle(ref.title);
        const same = t ? inDeck.filter((e) => normTitle(e.title) === t) : [];
        if (same.length) { const at = ref.slide || 0; same.sort((a, b) => Math.abs(a.slide - at) - Math.abs(b.slide - at) || a.slide - b.slide); entry = same[0]; how = 'title'; }
      }
      if (!entry && ref.slide) { entry = inDeck.find((e) => e.slide === ref.slide) || null; if (entry) how = 'slide'; }
      return { label: ref.label, entry, how, ref };
    }),
  }));
}

const cloneShelf = (shelf) => { const n = normalizeShelf(shelf).shelf; return { ...n, shelves: n.shelves.map((sv) => ({ ...sv, items: sv.items.map((it) => ({ ...it })) })) }; };
const fail = (shelf, reason) => ({ ok: false, shelf, reason });
const findShelf = (s, name) => s.shelves.findIndex((sv) => sv.name === cleanName(name));
/** 項目の指定：index（0 始まり）か label（その棚の中で 1 つに決まること） */
function findItem(sv, a) {
  if (Number.isInteger(a.index)) return a.index >= 0 && a.index < sv.items.length ? a.index : -1;
  const want = cleanName(a.item !== undefined ? a.item : a.label);
  if (!want) return -1;
  const hits = sv.items.map((it, i) => (it.label === want ? i : -1)).filter((i) => i >= 0);
  return hits.length === 1 ? hits[0] : -1;
}
const clampPos = (to, len) => (Number.isInteger(to) ? Math.max(0, Math.min(len, to)) : len);

/**
 * 棚にスライドを足す。a = { shelf: 棚名（無ければ作る）, label, entry（索引の entry）または ref:{ deck, id?, slide?, title? }, at?（入れる位置。省略で末尾） }。
 * 同じスライドが既にその棚にあれば、足さずに呼び名だけ直す（existed:true）。
 */
function shelfAdd(shelf, a) {
  a = a || {};
  const s = cloneShelf(shelf);
  const name = cleanName(a.shelf);
  if (!name) return fail(shelf, '棚の名前を指定してください');
  const e = a.entry, r = a.ref || {};
  const ref = e ? { deck: e.deck, id: e.mark ? e.mark.id : undefined, slide: e.slide, title: e.title || undefined } : { deck: r.deck, id: r.id, slide: r.slide, title: r.title };
  if (typeof ref.deck !== 'string' || !ref.deck) return fail(shelf, 'どのスライドか分かりません（deck がありません）');
  if (!ref.id && !ref.slide && !ref.title) return fail(shelf, 'どのスライドか分かりません（id・題名・番号のどれかが要ります）');
  const label = cleanName(a.label) || cleanName(ref.title) || ref.id || '';
  if (!label) return fail(shelf, '呼び名を指定してください');
  let i = findShelf(s, name);
  if (i < 0) { s.shelves.push({ name, items: [] }); i = s.shelves.length - 1; }
  const item = { label, deck: ref.deck };
  for (const k of ['id', 'slide', 'title']) if (ref[k] !== undefined && ref[k] !== null && ref[k] !== '') item[k] = ref[k];
  const items = s.shelves[i].items;
  const at = items.findIndex((x) => sameRef(x, item));
  if (at >= 0) { items[at] = { ...items[at], ...item }; return { ok: true, shelf: s, existed: true }; }
  items.splice(clampPos(a.at, items.length), 0, item);
  return { ok: true, shelf: s, existed: false };
}

/** 呼び名を直す。a = { shelf, index|label（今の呼び名）, to: 新しい呼び名 } */
function shelfRename(shelf, a) {
  a = a || {};
  const s = cloneShelf(shelf);
  const i = findShelf(s, a.shelf);
  if (i < 0) return fail(shelf, `棚「${cleanName(a.shelf)}」がありません`);
  const j = findItem(s.shelves[i], a);
  if (j < 0) return fail(shelf, 'その項目が見つかりません（同じ呼び名が複数あるときは番号で指定）');
  const to = cleanName(a.to);
  if (!to) return fail(shelf, '新しい呼び名が空です');
  s.shelves[i].items[j].label = to;
  return { ok: true, shelf: s };
}

/** 並べ替え・別の棚への移動。a = { shelf, index|label, to: 移した後の位置（0 始まり。省略で末尾）, toShelf?: 移す先の棚（無ければ作る） } */
function shelfMove(shelf, a) {
  a = a || {};
  const s = cloneShelf(shelf);
  const i = findShelf(s, a.shelf);
  if (i < 0) return fail(shelf, `棚「${cleanName(a.shelf)}」がありません`);
  const j = findItem(s.shelves[i], a);
  if (j < 0) return fail(shelf, 'その項目が見つかりません（同じ呼び名が複数あるときは番号で指定）');
  let k = i;
  const toName = cleanName(a.toShelf);
  if (toName && toName !== s.shelves[i].name) {
    k = findShelf(s, toName);
    if (k < 0) { s.shelves.push({ name: toName, items: [] }); k = s.shelves.length - 1; }
    if (s.shelves[k].items.some((x) => sameRef(x, s.shelves[i].items[j]))) return fail(shelf, `棚「${toName}」には同じスライドが既にあります`);
  }
  const [item] = s.shelves[i].items.splice(j, 1);
  s.shelves[k].items.splice(clampPos(a.to, s.shelves[k].items.length), 0, item);
  return { ok: true, shelf: s };
}

/** 棚から外す（元のデックには触らない）。index も label も無いときは棚そのものを消す（空の棚だけ。中身があれば断る） */
function shelfRemove(shelf, a) {
  a = a || {};
  const s = cloneShelf(shelf);
  const i = findShelf(s, a.shelf);
  if (i < 0) return fail(shelf, `棚「${cleanName(a.shelf)}」がありません`);
  if (!Number.isInteger(a.index) && a.label === undefined && a.item === undefined) {
    if (s.shelves[i].items.length) return fail(shelf, `棚「${s.shelves[i].name}」にはまだ ${s.shelves[i].items.length} 枚あります（先に中身を外してください）`);
    s.shelves.splice(i, 1);
    return { ok: true, shelf: s };
  }
  const j = findItem(s.shelves[i], a);
  if (j < 0) return fail(shelf, 'その項目が見つかりません（同じ呼び名が複数あるときは番号で指定）');
  s.shelves[i].items.splice(j, 1);
  return { ok: true, shelf: s };
}

/** 棚の名前を変える。a = { shelf, to }。同じ名前の棚が既にあれば断る（黙って混ぜない） */
function shelfRenameShelf(shelf, a) {
  a = a || {};
  const s = cloneShelf(shelf);
  const i = findShelf(s, a.shelf);
  if (i < 0) return fail(shelf, `棚「${cleanName(a.shelf)}」がありません`);
  const to = cleanName(a.to);
  if (!to) return fail(shelf, '新しい棚の名前が空です');
  if (to !== s.shelves[i].name && findShelf(s, to) >= 0) return fail(shelf, `棚「${to}」は既にあります`);
  s.shelves[i].name = to;
  return { ok: true, shelf: s };
}

/** 棚の並び順を変える。a = { shelf, to: 移した後の位置（0 始まり） } */
function shelfMoveShelf(shelf, a) {
  a = a || {};
  const s = cloneShelf(shelf);
  const i = findShelf(s, a.shelf);
  if (i < 0) return fail(shelf, `棚「${cleanName(a.shelf)}」がありません`);
  if (!Number.isInteger(a.to)) return fail(shelf, '移す先の位置を指定してください');
  const [sv] = s.shelves.splice(i, 1);
  s.shelves.splice(clampPos(a.to, s.shelves.length), 0, sv);
  return { ok: true, shelf: s };
}

module.exports = {
  CORPUS_VERSION,
  buildCorpus, searchCorpus, corpusPath, readCorpus, writeCorpus,
  churnOf, repoHistory, jaccard, lineDelta, slidesOf, gitBin, isClaudeVersion, CLAUDE_AUTHORS,
  extractText, normalizeForSearch, GROUPS_FILE, readRevisionGroups, groupOf, scoreOf, dedupe, byScore,
  SHELF_VERSION, shelfPath, readShelf, writeShelf, resolveShelf, normalizeShelf,
  shelfAdd, shelfRename, shelfMove, shelfRemove, shelfRenameShelf, shelfMoveShelf,
};
