#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// tools/marp-library.mjs — 完成スライドのライブラリ（印・台帳・サムネイル・候補出し・挿入）。mac / Windows 共通。
//
//   node tools/marp-library.mjs index                       台帳 slides/_library/index.json を作り直す
//   node tools/marp-library.mjs thumbs [id …]               印付きスライドのサムネイル（slides/_library/thumbs/<id>.png）
//   node tools/marp-library.mjs list [--tag x] [--json]     台帳の一覧
//   node tools/marp-library.mjs candidates [--deck md] [--all] [--top 10]   git の添削量から「印を付ける候補」を出す
//   node tools/marp-library.mjs mark <md> <スライド番号> [--id x] [--tags a,b]
//   node tools/marp-library.mjs unmark <md> <スライド番号>
//   node tools/marp-library.mjs insert <id> --into <md> --after <n> [--keep-colors] [--keep-typo] [--dry-run]
//   node tools/marp-library.mjs corpus [--no-churn] [--out path]   全スライドの索引 slides/_library/corpus.json を作り直す
//   node tools/marp-library.mjs search <語…> [--marked] [--sort score|recent] [--theme x] [--top N] [--json]
//   node tools/marp-library.mjs shelf list|add|move|remove|rename …   棚 slides/_library/shelf.json（呼び名と並び順）
//
// 中身は tools/marp-scroll-sync/lib/library-core.cjs（VS Code 拡張と同じ実装）。ここは引数の受け渡しと
// marp-cli / git の呼び出しだけを受け持つ。印の形式と貼り付け先への適応の取り決めは
// tools/marp-scroll-sync/DESIGN.md の 3 章。全スライドの索引と検索（corpus / search）は同 7.1、棚（shelf）は同 8.2。実装は lib/corpus-core.cjs。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, latestDeck, runMarp, themeSetArgs, rel as relTo } from './lib/marp-env.mjs';

const require = createRequire(import.meta.url);
const core = require('./marp-scroll-sync/lib/library-core.cjs');
const corpus = require('./marp-scroll-sync/lib/corpus-core.cjs');

const HELP = `marp-library — 完成スライドの印・台帳・再利用

使い方:
  node tools/marp-library.mjs <コマンド> [引数]

コマンド:
  index                         slides/ を走査して slides/_library/index.json を作り直す
  thumbs [id …]                 印付きスライドのサムネイルを slides/_library/thumbs/<id>.png に描く（id 省略で全部）
  list [--tag x] [--json]       印付きスライドの一覧（原稿から読み直すので常に最新）
  candidates [--deck md] [--all] [--top N]
                                git の履歴から、よく添削されたスライド（＝完成度が高い候補）を出す。
                                --deck 省略時は最後に編集したデック。--all は全デック（時間がかかる）
  mark <md> <番号> [--id x] [--tags a,b] [--at YYYY-MM-DD]
                                スライドに印を付ける（番号は 1 始まり。id 省略時は題名から提案）
  unmark <md> <番号>            印を外す
  insert <id> --into <md> --after <n> [--keep-colors] [--keep-typo] [--dry-run]
                                ライブラリのスライドを <md> の n 枚目の後ろに入れる（0 で先頭）。
                                素材のコピー・デック固有 CSS の同梱・配色の追従まで行う。
                                --from <md> --slide <番号> で、印の無いスライドを直接指定してもよい。
                                --keep-typo は、テーマが違うときに元の本文サイズ・行間をそのスライドに持ち込む（はみ出し対策）。
                                --dry-run は計画（本文・CSS・コピーする素材・警告）を表示するだけ
  corpus [--no-churn] [--out <path>]
                                既存の全スライドの索引（slides/_library/corpus.json）を作り直す。git の履歴から
                                スライドごとの添削量も数える（1 分前後）。--no-churn は履歴を見ない（数秒）。
                                前回の索引があれば、変わっていないデックは使い回す。--out は書き出し先を変える（検証用）
  search <語…> [--marked] [--sort score|recent] [--theme x] [--top N] [--all] [--json]
                                全スライドから探す（空白区切りは AND。題名・本文・タグ・デック名・型への部分一致）。
                                語を省くと「手を入れた順」。--marked は ★ だけ、--all は同じ内容のスライドをまとめない、
                                --corpus <path> は読む索引を変える。入れるときは insert --from <md> --slide <番号>
  shelf list [--json]           棚（slides/_library/shelf.json。自分で付けた呼び名と並び順）の一覧。行方不明の項目も出す
  shelf add <md> <番号> --shelf <棚名> [--label "呼び名"] [--at N]
                                スライドを棚に足す（棚が無ければ作る。元のデックは書き換えない。N は入れる位置で 1 始まり）
  shelf move --shelf <棚名> <項目> --to N [--to-shelf <棚名>]      並べ替え・別の棚へ移す（項目は番号か呼び名）
  shelf move --shelf <棚名> --to N                                  棚そのものの並び順を変える
  shelf rename --shelf <棚名> <項目> --label "新しい呼び名"        呼び名を直す
  shelf rename --shelf <棚名> --name "新しい棚名"                   棚の名前を変える
  shelf remove --shelf <棚名> [<項目>]                              棚から外す（項目を省くと、空の棚を消す）
                                search は棚の呼び名と棚名にも当たり、棚のスライドを先頭に出す（--no-shelf で棚を見ない）
  --root <dir>                  対象リポジトリを変える（検証用。theme/ と slides/ のある場所）。コマンドの前後どちらに置いてもよい。
                                省略時は、今いるフォルダに theme/ と slides/ があればそこ、無ければこのスクリプトのあるリポジトリ。
                                リポジトリの写しで試すときは、必ず --root を付けるか、写しの中で実行する
                                （tools/ をシンボリックリンクにした写しでは、スクリプトの場所が実リポジトリに解決されるため）
  --help                        この説明

印は _class と同じコメントに入る 1 行です（発表者ノートにも出力にも出ません）:
  <!--
  _class: summary
  _lib: alc-agenda | 構成, アジェンダ | 2026-09-20
  -->
`;

// ---------------------------------------------------------------- 引数

/** `--key value` と `--flag` を拾い、残りを位置引数にする（既存の tools/*.mjs と同じく依存なし） */
function parseArgs(argv, flags) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (flags.includes(k)) opt[k] = true;
      else { opt[k] = argv[i + 1]; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

const FLAGS = ['help', 'json', 'all', 'keep-colors', 'keep-typo', 'dry-run', 'no-churn', 'marked', 'no-shelf'];
/** 台帳の対象にするリポジトリ（theme/ と slides/ がある場所）。既定はこのリポジトリ */
let REPO = ROOT;
const rel = (p) => relTo(p, REPO);

function die(msg) { console.error('[ERROR] ' + msg); process.exit(1); }

function needMd(p) {
  if (!p) die('md のパスを指定してください');
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) die(`ファイルが見つかりません: ${p}`);
  return abs;
}

function slideNo(v, name = 'スライド番号') {
  if (v === undefined || v === '') die(`${name}が要ります（1 始まりの整数）`);
  const n = Number(v);
  if (!Number.isInteger(n)) die(`${name} は整数で指定してください: ${v}`);
  return n;
}

const printWarnings = (ws) => { for (const w of ws || []) console.log('  ⚠ ' + w); };

// ---------------------------------------------------------------- index / list

function cmdIndex() {
  const idx = core.buildIndex(REPO);
  const p = core.writeIndex(REPO, idx);
  console.log(`=> ${idx.entries.length} 件: ${rel(p)}`);
  printWarnings(idx.warnings);
  return idx;
}

function cmdList(opt) {
  const idx = core.buildIndex(REPO);
  let es = idx.entries;
  if (opt.tag) es = es.filter((e) => e.tags.includes(opt.tag));
  if (opt.json) { console.log(JSON.stringify(es, null, 2)); return; }
  if (!es.length) console.log(opt.tag ? `タグ「${opt.tag}」の印付きスライドはありません` : '印付きスライドはまだありません（mark で付けられます）');
  for (const e of es) {
    console.log(`${e.id}  ［${e.pattern || '-'}］ ${e.title || '(無題)'}`);
    console.log(`    ${e.deck} #${e.slide}  theme=${e.theme}  tags=${e.tags.join(', ') || '-'}  css=${e.cssBytes}B  素材=${e.assets.length}`);
  }
  printWarnings(idx.warnings);
}

// ---------------------------------------------------------------- thumbs

/**
 * デックごとに「印付きスライドだけを並べた一時 md」を 1 回だけ描画する（1枚ずつ marp を起動すると遅い）。
 * 一時 md は別の場所に置くので、相対参照（./src、../assets、url()）は file:// の絶対 URL に直す。
 * ページ番号は振り直されてしまうので消す。
 */
function cmdThumbs(ids) {
  const idx = core.buildIndex(REPO);
  let entries = idx.entries;
  if (ids.length) {
    entries = entries.filter((e) => ids.includes(e.id));
    for (const id of ids) if (!entries.some((e) => e.id === id)) console.log(`  ⚠ id「${id}」の印が見つかりません`);
  }
  const dup = new Set(entries.map((e) => e.id).filter((id, i, a) => a.indexOf(id) !== i));
  for (const id of dup) {
    console.log(`  ⚠ id「${id}」が重複しているので描きません: ` + entries.filter((e) => e.id === id).map((e) => `${e.deck} #${e.slide}`).join(' ／ ')
      + '（フォークしたデックなら、片方の印を unmark で外してください）');
  }
  const outDir = path.join(REPO, 'slides', '_library', 'thumbs');
  fs.mkdirSync(outDir, { recursive: true });
  const byDeck = new Map();
  for (const e of entries) {
    if (dup.has(e.id)) continue; // どちらの絵か決められない（下で理由を出す）
    if (!byDeck.has(e.deck)) byDeck.set(e.deck, []);
    byDeck.get(e.deck).push(e);
  }
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'marp-library-'));
  let done = 0;
  try {
    for (const [deckRel, list] of byDeck) {
      const mdAbs = path.join(REPO, deckRel);
      const deck = core.parseDeck(mdAbs, { repoRoot: REPO });
      const absify = (s) => core.mapRefs(s, (ref) => pathToFileURL(path.resolve(deck.dir, ref.replace(/[?#].*$/, ''))).href);
      const fmEnd = deck.frontmatter.endLine;
      // frontmatter の header にある ../assets/… も直す（YAML の中だが、属性の形は同じ）
      const fm = fmEnd >= 0 ? absify(deck.lines.slice(0, fmEnd + 1).join('\n')) : '---\nmarp: true\n---';
      const wanted = new Set(list.map((e) => e.slide - 1));
      // 他のスライドに置かれたデック全体向けの <style> は、抜き出すと失われるので先頭に持ってくる
      const extraCss = deck.styleBlocks.filter((b) => b.kind === 'inline' && !b.scoped && !wanted.has(b.slideIndex)).map((b) => b.css.trim());
      const bodies = list.map((e, n) => {
        const i = e.slide - 1;
        let body = core.removeMark(core.slideText(deck, i)).replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');
        const gc = core.globalClassAt(deck, i);
        const head = ['_paginate: false'];
        // 本文の <!-- class: x --> で切り替わったグローバル class は、抜き出すと効かなくなるので _class で補う
        if (!deck.slides[i].classes.length && gc && gc !== deck.globalClass) head.unshift(`_class: ${gc}`);
        body = `<!--\n${head.join('\n')}\n-->\n\n` + absify(body);
        if (n === 0 && extraCss.length) body += `\n\n<style>\n${extraCss.join('\n')}\n</style>`;
        return body;
      });
      const tmpMd = path.join(tmpRoot, '_thumb.md');
      fs.writeFileSync(tmpMd, fm + '\n\n' + bodies.join('\n\n---\n\n') + '\n');
      for (const f of fs.readdirSync(tmpRoot)) if (f.endsWith('.png')) fs.rmSync(path.join(tmpRoot, f));
      try {
        runMarp([tmpMd, ...themeSetArgs(REPO), '--images', 'png', '--image-scale', '0.5', '--allow-local-files', '-o', path.join(tmpRoot, 'thumb.png')]);
      } catch (e) {
        console.log(`  ⚠ ${deckRel} の描画に失敗: ${String(e.message || e).split('\n').slice(0, 3).join(' / ')}`);
        continue;
      }
      const pngs = fs.readdirSync(tmpRoot).filter((f) => /^thumb(\.\d+)?\.png$/.test(f)).sort();
      if (pngs.length !== list.length) {
        console.log(`  ⚠ ${deckRel}: 描画枚数が合いません（${pngs.length} 枚 / 期待 ${list.length} 枚）。このデックは飛ばします`);
        continue;
      }
      list.forEach((e, n) => {
        fs.copyFileSync(path.join(tmpRoot, pngs[n]), path.join(outDir, `${e.id}.png`));
        done++;
      });
      console.log(`  ${deckRel}: ${list.map((e) => e.id).join(', ')}`);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  // 印の無くなった id の絵を片付ける（全部描き直したときだけ）
  if (!ids.length) {
    const alive = new Set(idx.entries.map((e) => e.id + '.png'));
    for (const f of fs.readdirSync(outDir)) if (f.endsWith('.png') && !alive.has(f)) fs.rmSync(path.join(outDir, f));
  }
  console.log(`=> サムネイル ${done} 枚: ${rel(outDir)}/`);
  // thumb の有無が変わるので台帳も更新する
  core.writeIndex(REPO, core.buildIndex(REPO));
}

// ---------------------------------------------------------------- candidates（git の添削量）

// 添削量の数え方（churnOf）と git の探し方は tools/marp-scroll-sync/lib/corpus-core.cjs に移した（索引と同じ実装を使う）
/** 動く git。無ければここで止める（candidates は git が無いと何も出せない） */
function gitBin() {
  try { return corpus.gitBin(); } catch (e) { die(e.message); }
}
const churnOf = (mdAbs) => corpus.churnOf(REPO, mdAbs, { git: gitBin() });

function allDecks() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || ['node_modules', 'out', '_library'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md') && !e.name.startsWith('_')) {
        try { if (/^---\r?\n[\s\S]*?\bmarp:\s*true\b/.test(fs.readFileSync(p, 'utf8').slice(0, 2048))) out.push(p); } catch { /* 読めないものは飛ばす */ }
      }
    }
  };
  for (const top of ['slides']) if (fs.existsSync(path.join(REPO, top))) walk(path.join(REPO, top));
  return out;
}

function cmdCandidates(opt) {
  const top = opt.top ? slideNo(opt.top, '--top') : 10;
  let decks;
  if (opt.all) decks = allDecks();
  else if (opt.deck) decks = [needMd(opt.deck)];
  else {
    const d = latestDeck(REPO);
    if (!d) die('デックの .md が見つかりません');
    console.log(`（--deck なし）最後に編集したデックを自動選択: ${rel(d)}`);
    decks = [d];
  }
  const existing = core.buildIndex(REPO).entries.map((e) => e.id);
  const all = [];
  for (const d of decks) {
    let r;
    try { r = churnOf(d); } catch (e) { console.log(`  ⚠ ${rel(d)}: 履歴を読めません（${String(e.message || e).split('\n')[0]}）`); continue; }
    for (const row of r.rows) if (!row.marked && row.touched > 0) all.push({ deck: r.mdRel, versions: r.versions, ...row });
  }
  all.sort((a, b) => b.touched - a.touched || b.churn - a.churn);
  const rows = all.slice(0, top);
  if (opt.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log('候補はありません（履歴の中で直されたスライドが無いか、すべて印付きです）'); return; }
  console.log('添削された回数の多い順（touched=内容が変わった版の数、churn=変更行数の合計）:');
  for (const r of rows) {
    const id = core.suggestId(r.title, r.deck, r.slide, existing);
    existing.push(id);
    console.log(`  touched=${String(r.touched).padStart(2)} churn=${String(r.churn).padStart(4)}  #${String(r.slide).padStart(3)} ［${r.pattern || '-'}］ ${r.title || '(無題)'}   最終 ${r.last}`);
    console.log(`      node tools/marp-library.mjs mark ${r.deck} ${r.slide} --id ${id} --tags `);
  }
}

// ---------------------------------------------------------------- corpus / search（全スライドの索引）

function cmdCorpus(opt) {
  const out = opt.out ? path.resolve(opt.out) : corpus.corpusPath(REPO);
  const withChurn = !opt['no-churn'];
  const t0 = Date.now();
  const tty = process.stderr.isTTY;
  const c = corpus.buildCorpus(REPO, {
    withChurn, cache: corpus.readCorpus(REPO, out),
    onProgress: tty ? (i, n) => process.stderr.write(`\r  ${i} / ${n} デック`) : null,
  });
  if (tty) process.stderr.write('\r' + ' '.repeat(30) + '\r');
  corpus.writeCorpus(REPO, c, out);
  const withC = c.entries.filter((e) => e.churn).length;
  const touched = c.entries.filter((e) => e.churn && e.churn.touched > 0).length;
  console.log(`=> ${c.entries.length} 枚（${Object.keys(c.decks).length} デック）: ${rel(out)}   ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  console.log(`   添削量つき ${withC} 枚（うち 1 回以上直したもの ${touched} 枚） / ★ ${c.entries.filter((e) => e.mark).length} 枚 / 同じ内容としてまとめたもの ${c.entries.filter((e) => e.dupOf).length} 枚`);
  if (!withChurn && withC < c.entries.length) console.log('   （--no-churn：変わったデックの添削量は数えていません。数えるには --no-churn を外して実行）');
  printWarnings(c.warnings);
}

function cmdSearch(pos, opt) {
  const file = opt.corpus ? path.resolve(opt.corpus) : corpus.corpusPath(REPO);
  const cached = corpus.readCorpus(REPO, file);
  // 索引が古くても結果は今の原稿に合わせる（変わったデックだけ読み直す。履歴は見ないので速い）。ここでは書き込まない
  const c = corpus.buildCorpus(REPO, { withChurn: false, cache: cached });
  if (!cached) console.error('[marp-library] 索引がまだ無いので、添削量なしで探します（node tools/marp-library.mjs corpus で作れます）');
  const top = opt.top ? slideNo(opt.top, '--top') : 12;
  const shelf = opt['no-shelf'] ? null : corpus.resolveShelf(corpus.readShelf(REPO), c);
  const r = corpus.searchCorpus(c, pos.join(' '), { onlyMarked: !!opt.marked, sort: opt.sort, theme: opt.theme, dedupe: !opt.all, limit: top, shelf });
  if (opt.json) { console.log(JSON.stringify(r.items.map((it) => it.entry), null, 2)); return; }
  if (!r.items.length) { console.log('見つかりません'); return; }
  console.log(`${r.total} 件中 ${r.items.length} 件（${pos.length ? '関連順' : '手を入れた順'}${opt.sort ? '→ --sort ' + opt.sort : ''}）:`);
  for (const it of r.items) {
    const e = it.entry;
    const name = e.deckName.replace(/^\d{8}_/, '');
    const churn = e.churn ? `添削${e.churn.touched}回` : '添削 - ';
    console.log(`  ${e.mark ? '★' : ' '} score ${e.score.toFixed(1).padStart(4)}  ${churn}  ${e.date || '    -     '}  ${name} #${e.slide} ［${e.pattern || '-'}］ ${e.title || '(無題)'}`
      + (it.dupCount > 1 ? `  (同じ内容 他${it.dupCount - 1}件)` : '') + (it.snippet ? `   — ${it.snippet}` : ''));
    console.log(`      ${e.deck}` + (it.shelf ? `   ［棚：${it.shelf.name} ／ ${it.shelf.label}］` : ''));
  }
  console.log('入れるには: node tools/marp-library.mjs insert --from <上の md> --slide <番号> --into <md> --after <n>');
}

// ---------------------------------------------------------------- shelf（呼び名と並び順。DESIGN 8.2）

/** 索引（無ければ・古ければ、履歴を見ずにその場で作る。書き込まない） */
const corpusNow = (opt) => corpus.buildCorpus(REPO, { withChurn: false, cache: corpus.readCorpus(REPO, opt.corpus ? path.resolve(opt.corpus) : undefined) });

/** 項目の指定：整数なら番号（1 始まり）、それ以外は呼び名 */
const itemArg = (v) => (/^\d+$/.test(String(v)) ? { index: Number(v) - 1 } : { label: String(v) });
const posArg = (v, name) => (v === undefined ? undefined : slideNo(v, name) - 1);

function cmdShelf(pos, opt) {
  const sub = pos.shift() || 'list';
  const shelf = corpus.readShelf(REPO);
  printWarnings(shelf.warnings);
  if (sub === 'list') {
    const res = corpus.resolveShelf(shelf, corpusNow(opt));
    if (opt.json) { console.log(JSON.stringify(res.map((sv) => ({ name: sv.name, items: sv.items.map((it) => ({ label: it.label, how: it.how, ref: it.ref, key: it.entry ? it.entry.key : null })) })), null, 2)); return; }
    if (!res.length) { console.log('棚はまだありません（shelf add <md> <番号> --shelf <棚名> --label "呼び名" で作れます）'); return; }
    for (const sv of res) {
      console.log(`■ ${sv.name}（${sv.items.length} 枚）`);
      sv.items.forEach((it, i) => {
        const e = it.entry;
        console.log(`  ${String(i + 1).padStart(2)}. ${it.label}` + (e ? `   — ${e.deck} #${e.slide} ［${e.pattern || '-'}］ ${e.title || '(無題)'}` + (it.how === 'slide' ? '  ⚠ 番号だけで見つけました（題名が変わっています。中身を確かめてください）' : '')
          : `   — ⚠ 行方不明（${it.ref.deck}${it.ref.id ? ' id=' + it.ref.id : ''}${it.ref.slide ? ' #' + it.ref.slide : ''}${it.ref.title ? ' 「' + it.ref.title + '」' : ''}）`));
      });
    }
    return;
  }
  if (shelf.broken) die('shelf.json が読めないので、変更できません（ファイルを直してからやり直してください）');
  if (!opt.shelf) die('--shelf <棚名> が要ります');
  let r;
  if (sub === 'add') {
    const md = needMd(pos[0]);
    const n = slideNo(pos[1]);
    const deckRel = path.relative(REPO, md).split(path.sep).join('/');
    const c = corpusNow(opt);
    let entry = c.entries.find((e) => e.deck === deckRel && e.slide === n);
    if (!entry) {
      // 索引の対象外（slides/ の外など）でも、名前は付けられる
      const deck = core.parseDeck(fs.readFileSync(md, 'utf8'), { path: md });
      const s = deck.slides[n - 1];
      if (!s) die(`スライド ${n} がありません（全 ${deck.slides.length} 枚）`);
      entry = { deck: deckRel, slide: n, title: s.title || '', mark: s.mark ? { id: s.mark.id } : null };
    }
    r = corpus.shelfAdd(shelf, { shelf: opt.shelf, label: opt.label, entry, at: posArg(opt.at, '--at') });
    if (r.ok && r.existed) console.log('  （このスライドは既にその棚にあるので、呼び名だけ直しました）');
  } else if (sub === 'move') {
    r = pos.length ? corpus.shelfMove(shelf, { shelf: opt.shelf, ...itemArg(pos[0]), to: posArg(opt.to, '--to'), toShelf: opt['to-shelf'] })
      : corpus.shelfMoveShelf(shelf, { shelf: opt.shelf, to: posArg(opt.to, '--to') });
  } else if (sub === 'rename') {
    if (pos.length) r = corpus.shelfRename(shelf, { shelf: opt.shelf, ...itemArg(pos[0]), to: opt.label });
    else if (opt.name !== undefined) r = corpus.shelfRenameShelf(shelf, { shelf: opt.shelf, to: opt.name });
    else die('項目（番号か呼び名）と --label "新しい呼び名"、または --name "新しい棚名" を指定してください');
  } else if (sub === 'remove') {
    r = corpus.shelfRemove(shelf, { shelf: opt.shelf, ...(pos.length ? itemArg(pos[0]) : {}) });
  } else die(`知らない shelf コマンド: ${sub}（list / add / move / remove / rename）`);
  if (!r.ok) die(r.reason);
  const w = corpus.writeShelf(REPO, r.shelf);
  if (!w.ok) die(w.reason);
  console.log(`=> ${rel(w.path)} を更新しました`);
  for (const sv of r.shelf.shelves) console.log(`  ■ ${sv.name}: ` + (sv.items.map((it, i) => `${i + 1}. ${it.label}`).join(' ／ ') || '（空）'));
}

// ---------------------------------------------------------------- mark / unmark / insert

function cmdMark(pos, opt, on) {
  const md = needMd(pos[0]);
  const n = slideNo(pos[1]);
  const text = fs.readFileSync(md, 'utf8');
  const deck = core.parseDeck(text, { path: md });
  const s = deck.slides[n - 1];
  if (!s) die(`スライド ${n} がありません（全 ${deck.slides.length} 枚）`);
  let mark = null;
  if (on) {
    const others = core.buildIndex(REPO).entries.filter((e) => !(path.join(REPO, e.deck) === md && e.slide === n));
    const id = opt.id || core.suggestId(s.title, md, n, others.map((e) => e.id));
    const hit = others.find((e) => e.id === id);
    if (hit) die(`id「${id}」は既に使われています: ${hit.deck} #${hit.slide}`);
    const tags = opt.tags !== undefined ? String(opt.tags).split(/[,、]/).map((t) => t.trim()).filter(Boolean) : (s.mark ? s.mark.tags : []);
    mark = { id, tags, at: opt.at };
  }
  const e = core.markSlideEdit(text, n - 1, mark);
  if (!e) { console.log(on ? '変更なし' : `スライド ${n} に印はありません`); return; }
  const after = core.applyEdits(text, [e]);
  // 検算：枚数が変わらず、混入する形になっていないこと。だめなら書かない
  if (core.parseDeck(after).slides.length !== deck.slides.length) die('印を付けると枚数が変わってしまうので中止しました（原稿は変更していません）');
  const leaks = core.findLeakyMarks(after).filter((l) => mark && l.id === mark.id);
  if (leaks.length) die('この印は発表者ノートに出る形になるので中止しました（原稿は変更していません）');
  fs.writeFileSync(md, after);
  const mk = core.parseDeck(after).slides[n - 1].mark;
  console.log(on ? `=> 印を付けました: ${rel(md)} #${n} 「${s.title}」 id=${mk.id} tags=${mk.tags.join(', ') || '-'}` : `=> 印を外しました: ${rel(md)} #${n} 「${s.title}」`);
  if (on && opt.id !== undefined && String(opt.id) !== mk.id) console.log(`  ⚠ id に使えない文字があったので「${mk.id}」に直しました（半角英数とハイフンだけ）`);
  if (on && s.mark && s.mark.id !== mk.id) console.log(`  ⚠ このスライドには既に印がありました。id を「${s.mark.id}」から「${mk.id}」に変えました（「_from: ${s.mark.id}」で挿入済みのコピーとの対応は切れます）`);
}

function cmdInsert(pos, opt) {
  if (!opt.into) die('--into <md> が要ります');
  if (opt.after === undefined) die('--after <n> が要ります（n 枚目の後ろ。0 で先頭）');
  const dest = needMd(opt.into);
  const after = slideNo(opt.after, '--after');
  let srcMd, id, slideIndex;
  if (opt.from) {
    srcMd = needMd(opt.from);
    if (opt.slide !== undefined) slideIndex = slideNo(opt.slide, '--slide') - 1;
    else id = pos[0];
    if (id === undefined && slideIndex === undefined) die('--from を使うときは --slide <番号> か id を指定してください');
  } else {
    id = pos[0];
    if (!id) die('id を指定してください（list で一覧）');
    const idx = core.buildIndex(REPO);
    let entry;
    try { entry = core.findEntry(idx, id); } catch (e) { die(e.message); }
    if (!entry) die(`id「${id}」の印付きスライドが見つかりません（list で一覧）`);
    srcMd = path.join(REPO, entry.deck);
  }
  let plan;
  try {
    plan = core.adaptSlide({ srcMdPath: srcMd, id, slideIndex, destMdPath: dest, keepColors: !!opt['keep-colors'], keepTypo: !!opt['keep-typo'], repoRoot: REPO, afterIndex: after - 1 });
  } catch (e) { die(e.message); }
  const info = plan.info;
  console.log(`${rel(srcMd)} #${plan.slideIndex + 1} → ${rel(dest)} の ${after} 枚目の後ろ`);
  console.log(`  CSS: frontmatter に ${info.carried} ルール / スライド内 scoped に ${info.scoped} ルール / 既にあって省いたもの ${info.skipped} ルール`);
  console.log(`  色の置き換え: ${info.colorReplacements} か所   素材のコピー: ${plan.assetCopies.length} 個`);
  for (const c of plan.assetCopies) console.log(`    ${rel(c.from)} → ${rel(c.to)}`);
  printWarnings(plan.warnings);
  if (opt['dry-run']) {
    console.log('\n--- 入る本文（--dry-run。何も書いていません）---\n' + plan.slideText);
    const fmEdit = plan.destEdits.find((e) => e.text.includes('{') && !e.text.includes(plan.slideText.slice(0, 20)));
    if (fmEdit) console.log('\n--- frontmatter の style に足す CSS ---\n' + fmEdit.text);
    return;
  }
  core.applyAdaptPlan(plan);
  console.log(`=> 挿入しました。描画して確認してください: npm run png -- ${rel(dest)}`);
}

// ---------------------------------------------------------------- 入口

// オプションはコマンドの前にも後ろにも置ける（--root <dir> index でもよい）。最初の位置引数がコマンド名
const { pos, opt } = parseArgs(process.argv.slice(2), FLAGS);
const cmd = pos.shift() || (opt.help ? '--help' : undefined);
// --root は検証用（リポジトリの写しを相手にする）。marp-cli 本体は常にこのリポジトリの node_modules を使う。
// 省略時：今いるフォルダがリポジトリの形（theme/ と slides/）ならそこ。tools/ を symlink した写しの中で実行しても、
// スクリプトの実体パスから求めた ROOT（＝実リポジトリ）に書いてしまわないように
if (opt.root) REPO = path.resolve(opt.root);
else {
  const cwd = process.cwd();
  const isRepo = (d) => { try { return fs.statSync(path.join(d, 'theme')).isDirectory() && fs.statSync(path.join(d, 'slides')).isDirectory(); } catch (_) { return false; } };
  if (isRepo(cwd) && fs.realpathSync(cwd) !== fs.realpathSync(ROOT)) { REPO = cwd; console.error(`[marp-library] 対象: ${cwd}（今いるフォルダ。変えるには --root）`); }
}

try {
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help' || opt.help) console.log(HELP);
  else if (cmd === 'index') cmdIndex();
  else if (cmd === 'thumbs') cmdThumbs(pos);
  else if (cmd === 'list') cmdList(opt);
  else if (cmd === 'candidates') cmdCandidates(opt);
  else if (cmd === 'corpus') cmdCorpus(opt);
  else if (cmd === 'search') cmdSearch(pos, opt);
  else if (cmd === 'shelf') cmdShelf(pos, opt);
  else if (cmd === 'mark') cmdMark(pos, opt, true);
  else if (cmd === 'unmark') cmdMark(pos, opt, false);
  else if (cmd === 'insert') cmdInsert(pos, opt);
  else { console.error(`知らないコマンド: ${cmd}\n`); console.log(HELP); process.exitCode = 1; }
} catch (e) {
  console.error('\n[ERROR] ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
}
