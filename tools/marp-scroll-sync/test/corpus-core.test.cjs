// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// lib/corpus-core.cjs の単体テスト（DESIGN.md 7.1・8.2）。
// 合成リポジトリ（os.tmpdir に git init）で、本文の抽出・churn・score・重複のまとめ・cache・検索・棚・CLI を確かめる。
// 実リポジトリには何も書かない。git が無い環境では、git の要るテストだけ skip する。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const C = require('../lib/corpus-core.cjs');
const CLI = path.resolve(__dirname, '..', '..', 'marp-library.mjs');

let GIT = null;
try { GIT = C.gitBin(); } catch (_) { GIT = null; }
const needGit = GIT ? {} : { skip: 'git が見つかりません' };

// ───────────────────────── 合成リポジトリ ─────────────────────────

const FM = (theme, extra) => `---\nmarp: true\ntheme: ${theme}\npaginate: true\n${extra || ''}---\n`;

const INTRO_V1 = `# 自己紹介\n\n- 山田 太郎（やまだ たろう）\n- 見本大学 教育センター\n- 専門は高等教育論です\n`;
const INTRO_V2 = `# 自己紹介\n\n- 山田 太郎（やまだ たろう）\n- 見本大学 教育センター 准教授\n- 専門は高等教育論です\n- 企業を経て、教育の仕事をしています\n`;
const INTRO_V3 = `# 自己紹介\n\n- 山田 太郎（やまだ たろう）\n- 見本大学 教育センター 准教授\n- 専門は高等教育論です\n- 企業を経て、いまは教育の実務を回しています\n\n<div class="takeaway">越境の経験が、生成AIの話の土台です</div>\n`;
const STABLE = `# 変えないスライド\n\n- サーバーとクライアントの関係を説明します\n- この行は一度も直しません\n`;
const SVG_ONLY = `<!-- _class: fig -->\n\n<svg viewBox="0 0 100 50"><rect width="10" height="10"/><text x="1" y="2">ハルシネーション</text><text x="1" y="9">もっともらしい <tspan>誤り</tspan></text></svg>\n`;
const NOISY = `<!--\n_class: split\n_paginate: false\n-->\n\n## 生成AIの **重み** とは\n\n<style scoped>\n.secretcss { color: red; }\n</style>\n\n<div class="box" style="color:#123456">パラメータは [学習](https://example.com/hidden-url) で決まる &amp; 固定される</div>\n\n| 列A | 列B |\n|---|---|\n| Ｓｌｉｄｏ | 投票 |\n\n<!-- これは発表者ノート。ひみつのメモ -->\n`;

const deckA = (intro) => FM('academic') + '\n' + [intro, STABLE, SVG_ONLY, NOISY].join('\n---\n\n');
const CONVERTED = FM('academic') + '\n' + [
  `<div class="ppt-canvas"><div style="left:1px">自己紹介</div><div style="left:2px">変換のままの自己紹介スライドです</div></div>\n`,
  `# 著作権の補足\n\n<div class="ppt-canvas"><div style="left:1px">著作権の話</div></div>\n`,
].join('\n---\n\n');
const STYLED = FM('academic') + '\n' + [1, 2].map((n) => `# 直書き ${n}\n\n` + Array.from({ length: 6 }, (_, i) => `<p style="margin:${i}px">直書きの段落 ${n}-${i}</p>`).join('\n') + '\n').join('\n---\n\n');
const FORK = FM('tsutawaru-academic') + '\n' + [
  INTRO_V3, // A デックの自己紹介と同じ内容（重複の束になる）
  `<!--\n_class: summary\n_lib: star-agenda | 構成, アジェンダ | 2026-09-20\n-->\n\n# 今日の流れ\n\n- はじめに\n- 本題\n- まとめ\n`,
  `# 自己紹介\n\n- これは題名だけ同じで、中身はまったく別のスライドです\n- 共同研究者の紹介を並べています\n- 連絡先はこちら\n`,
].join('\n---\n\n');

function mk(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

function makeRepo(withGit) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-core-')));
  const git = (...a) => execFileSync(GIT, ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = (msg, date) => { git('add', '-A'); git('commit', '-q', '-m', msg, '--date', date + 'T12:00:00'); };
  mk(root, 'theme/academic.css', '/* @theme academic */\nsection { font-size: 23px; }\n.takeaway { font-size: 28px; }\n');
  mk(root, 'theme/tsutawaru-academic.css', '/* @theme tsutawaru-academic */\n@import "academic";\n.fill { background: #eee; }\n');
  mk(root, C.GROUPS_FILE, [
    '# 手本デックの一覧', '', '## A. 手本', '', '| デック | メモ |', '|---|---|', '| `slides/20260601_Test_a-deck` | 何度も直した |', '',
    '## B. 準手本', '', '- slides/20260701_Test_fork/ を見る', '', '## C. 対象外', '', '| `slides/20250101_Old_converted` | 変換のまま |', '',
  ].join('\n'));
  const A = 'slides/20260601_Test_a-deck/20260601_Test_a-deck.md';
  mk(root, A, deckA(INTRO_V1));
  mk(root, 'slides/20250101_Old_converted/20250101_Old_converted.md', CONVERTED);
  mk(root, 'slides/20250202_Old_styled/20250202_Old_styled.md', STYLED);
  mk(root, 'slides/20260701_Test_fork/20260701_Test_fork.md', FORK);
  // 索引に載せないもの
  mk(root, 'slides/20260601_Test_a-deck/work/draft.md', deckA(INTRO_V1));
  mk(root, 'slides/20260601_Test_a-deck/out/x.md', deckA(INTRO_V1));
  mk(root, 'slides/20260601_Test_a-deck/parts/head.md', deckA(INTRO_V1));
  mk(root, 'slides/20260601_Test_a-deck/20260601_Test_a-deck.md.bak.md', deckA(INTRO_V1));
  mk(root, 'slides/_library/ghost.md', deckA(INTRO_V1));
  mk(root, 'slides/20260601_Test_a-deck/原稿.md', '# ただのメモ（marp ではない）\n');
  if (withGit) {
    git('init', '-q');
    commit('v1', '2026-06-01');
    mk(root, A, deckA(INTRO_V2)); commit('v2', '2026-06-05');
    mk(root, A, deckA(INTRO_V3)); commit('v3', '2026-06-09');
  } else mk(root, A, deckA(INTRO_V3));
  return { root, A, git, commit };
}

const byKey = (c, deck, n) => c.entries.find((e) => e.deck === deck && e.slide === n);
const FORKMD = 'slides/20260701_Test_fork/20260701_Test_fork.md';
const CONVMD = 'slides/20250101_Old_converted/20250101_Old_converted.md';

// ───────────────────────── 本文の抽出 ─────────────────────────

test('extractText：ノート・ディレクティブ・style・タグ・記号・URL を除く', () => {
  const { text } = C.extractText(NOISY);
  assert.match(text, /^生成AIの 重み とは/);
  assert.match(text, /パラメータは 学習 で決まる & 固定される/);
  assert.match(text, /列A 列B/);
  for (const ng of ['ひみつ', '_class', '_paginate', 'secretcss', 'hidden-url', '123456', '**', '|', '---', '<', '&amp;']) assert.ok(!text.includes(ng), `残っている: ${ng}`);
});

test('extractText：SVG しか無いスライドは <text> の文字を拾う（本文には混ぜない）', () => {
  const r = C.extractText(SVG_ONLY);
  assert.equal(r.text, '');
  assert.equal(r.svgText, 'ハルシネーション もっともらしい 誤り');
});

test('normalizeForSearch：全角/半角・大文字小文字・長音・空白の揺れを吸収し、元の位置を返せる', () => {
  assert.equal(C.normalizeForSearch('Ｓｌｉｄｏ サーバー 生成 ＡＩ'), 'slidoサバ生成ai');
  assert.equal(C.normalizeForSearch('ｻｰﾊﾞｰ').startsWith('サ'), true); // 半角カナは全角に寄せる（長音は落とす）
  const map = [];
  const n = C.normalizeForSearch('A ーB', map);
  assert.equal(n, 'ab');
  assert.deepEqual(map, [0, 3]);
});

test('jaccard / lineDelta', () => {
  assert.equal(C.jaccard(['a', 'b'], ['a', 'b']), 1);
  assert.equal(C.jaccard(['a', 'b'], ['b', 'c']), 1 / 3);
  assert.equal(C.jaccard([], []), 1);
  assert.equal(C.lineDelta(['a', 'b', 'b'], ['b', 'a', 'b']), 0); // 並べ替えは数えない
  assert.equal(C.lineDelta(['a', 'b'], ['a', 'c', 'd']), 3);
});

// ───────────────────────── 添削マップ・score ─────────────────────────

test('readRevisionGroups：A・B の節だけを拾う。日付の連記を展開する。読めなければ []', () => {
  assert.equal(C.GROUPS_FILE, 'slides/_library/groups.md', '手本デックの一覧は任意のファイル（配布版には無い）');
  const g = C.readRevisionGroups('/nonexistent', '## A. x\n| `slides/20260621+0622_Event_x` |\n## B. y\nslides/20260101_B-deck/\n## C. z\nslides/20250101_C\n');
  assert.deepEqual(g.map((x) => x.name + ':' + x.group), ['20260621_event_x:A', '20260622_event_x:A', '20260101_b-deck:B']);
  assert.deepEqual(C.readRevisionGroups('/nonexistent/repo'), []);
  assert.equal(C.groupOf('slides/20260622_Event_x/a.md', g), 'A');
  assert.equal(C.groupOf('slides/20250101_C/a.md', g), null);
  assert.equal(C.groupOf('slides/any/a.md', []), null);
});

test('scoreOf：★ > 何度も直した > 直していない > pptx 変換のまま（式の順序を固定）', () => {
  const base = { mark: null, churn: { touched: 0, lines: 0 }, tune: 0, group: null, date: '2026-01-01', converted: false };
  const newest = '2026-01-01';
  const star = C.scoreOf({ ...base, mark: { id: 'x' } }, newest);
  const best = C.scoreOf({ ...base, churn: { touched: 50, lines: 99999 }, tune: 9, group: 'A' }, newest); // 印なしの上限
  const many = C.scoreOf({ ...base, churn: { touched: 5, lines: 120 } }, newest);
  const once = C.scoreOf({ ...base, churn: { touched: 1, lines: 4 } }, newest);
  const none = C.scoreOf({ ...base, group: 'A' }, newest);
  const conv = C.scoreOf({ ...base, converted: true }, newest);
  assert.ok(star > best, `★ ${star} > 印なしの上限 ${best}`);
  assert.ok(best <= 5.2 && many > once && once > none && none > conv, `${best} ${many} ${once} ${none} ${conv}`);
  assert.ok(conv < 0);
  // ★ が付いていれば、変換由来でも減点しない。変換のままでも、直した分は足される
  assert.equal(C.scoreOf({ ...base, mark: { id: 'x' }, converted: true }, newest), star);
  assert.ok(C.scoreOf({ ...base, converted: true, churn: { touched: 3, lines: 30 } }, newest) > conv);
  // 新しさは小さな加点（1 回直した古いスライドを、直していない新しいスライドが越えない）
  assert.ok(C.scoreOf({ ...base, date: '2020-01-01', churn: { touched: 1, lines: 4 } }, newest) > C.scoreOf(base, newest));
  // churn が無い（履歴なし）でも落ちない
  assert.equal(typeof C.scoreOf({ ...base, churn: null, date: null }, null), 'number');
});

// ───────────────────────── buildCorpus（git つき） ─────────────────────────

test('buildCorpus：対象・entry の形・group・converted・churn・score・重複の束', needGit, (t) => {
  const { root, A } = makeRepo(true);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = C.buildCorpus(root, { git: GIT });
  assert.deepEqual(Object.keys(c.decks).sort(), [CONVMD, 'slides/20250202_Old_styled/20250202_Old_styled.md', A, FORKMD].sort());
  assert.equal(c.entries.length, 4 + 2 + 2 + 3);
  assert.equal(c.warnings.length, 0);
  assert.match(c.head, /^[0-9a-f]{40}$/);

  const intro = byKey(c, A, 1), stable = byKey(c, A, 2), svg = byKey(c, A, 3), noisy = byKey(c, A, 4);
  assert.equal(intro.key, A + '#1');
  assert.equal(intro.deckName, '20260601_Test_a-deck');
  assert.equal(intro.title, '自己紹介');
  assert.equal(intro.theme, 'academic');
  assert.equal(intro.date, '2026-06-01');
  assert.equal(intro.group, 'A');
  assert.equal(svg.pattern, 'fig');
  assert.equal(svg.hasSvg, true);
  assert.match(svg.text, /ハルシネーション/);
  assert.equal(noisy.pattern, 'split');
  assert.ok(!/ひみつ|secretcss/.test(noisy.text));

  // churn：自己紹介は 2 回直した。ほかは 0 回
  assert.equal(intro.churn.touched, 2);
  assert.ok(intro.churn.lines >= 4);
  assert.equal(intro.churn.last, '2026-06-09');
  assert.deepEqual(stable.churn, { touched: 0, lines: 0, last: '', human: { touched: 0, lines: 0, last: '' } });

  // group・converted
  assert.equal(byKey(c, FORKMD, 1).group, 'B');
  assert.equal(byKey(c, CONVMD, 1).group, null);
  assert.equal(byKey(c, CONVMD, 1).converted, true);              // ppt-canvas
  assert.equal(byKey(c, 'slides/20250202_Old_styled/20250202_Old_styled.md', 1).converted, true); // style 直書きが 1 枚平均 6 個
  assert.equal(intro.converted, false);

  // 印
  const star = byKey(c, FORKMD, 2);
  assert.deepEqual(star.mark, { id: 'star-agenda', tags: ['構成', 'アジェンダ'] });

  // score の順序：★ > 何度も直した > 直していない > 変換のまま
  assert.ok(star.score > intro.score && intro.score > stable.score && stable.score > byKey(c, CONVMD, 2).score,
    `${star.score} ${intro.score} ${stable.score} ${byKey(c, CONVMD, 2).score}`);

  // 重複：フォークの自己紹介（同じ内容）は A デックの自己紹介の束に入る。題名だけ同じ別物は束ねない
  const forkIntro = byKey(c, FORKMD, 1), other = byKey(c, FORKMD, 3);
  assert.equal(forkIntro.dupOf, intro.key);
  assert.equal(intro.dupOf, null);
  assert.equal(intro.dupCount, 2);
  assert.equal(other.dupOf, null);
  assert.equal(other.dupCount, 1);
});

test('buildCorpus：未コミットの手直しも 1 版として数える／textOf で未保存の内容を見る', needGit, (t) => {
  const { root, A } = makeRepo(true);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, A), deckA(INTRO_V3).replace('この行は一度も直しません', 'この行を未コミットで直しました'));
  const c = C.buildCorpus(root, { git: GIT });
  assert.equal(byKey(c, A, 2).churn.touched, 1);
  assert.equal(byKey(c, A, 2).churn.last, 'worktree');
  const live = C.buildCorpus(root, { git: GIT, withChurn: false, textOf: (abs) => (abs.endsWith('a-deck.md') ? deckA(INTRO_V3) + '\n---\n\n# 未保存の新しいスライド\n' : undefined) });
  assert.equal(live.entries.filter((e) => e.deck === A).length, 5);
  assert.equal(live.decks[A].mtimeMs, -1); // 次回はディスクから作り直させる
});

test('buildCorpus：cache（変わっていないデックは読み直さない。churn は HEAD が同じときだけ使い回す）', needGit, (t) => {
  const { root, A, commit } = makeRepo(true);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = C.buildCorpus(root, { git: GIT });
  const roundtrip = JSON.parse(JSON.stringify(first)); // corpus.json を読み直した形
  // cache から来たことが分かるよう、cache 側に目印を付ける
  roundtrip.entries.find((e) => e.key === A + '#2').text = 'CACHE から来た本文';
  roundtrip.entries.find((e) => e.key === A + '#1').churn = { touched: 9, lines: 99, last: '2026-06-09' };

  const again = C.buildCorpus(root, { git: GIT, cache: roundtrip });
  assert.equal(byKey(again, A, 2).text, 'CACHE から来た本文');
  assert.equal(byKey(again, A, 1).churn.touched, 9, 'HEAD が同じなら churn も使い回す');
  assert.equal(again.entries.length, first.entries.length);
  assert.equal(byKey(again, FORKMD, 1).dupOf, A + '#1', '重複の束は毎回作り直す');

  // churn 抜き：md が同じなら cache の churn を引き継ぐ
  const quick = C.buildCorpus(root, { git: GIT, withChurn: false, cache: roundtrip });
  assert.equal(byKey(quick, A, 1).churn.touched, 9);

  // md が変わったデックだけ読み直す（ほかは cache のまま）
  const fork = path.join(root, FORKMD);
  fs.writeFileSync(fork, fs.readFileSync(fork, 'utf8') + '\n---\n\n# 足したスライド\n');
  const third = C.buildCorpus(root, { git: GIT, withChurn: false, cache: roundtrip });
  assert.equal(third.entries.filter((e) => e.deck === FORKMD).length, 4);
  assert.equal(byKey(third, FORKMD, 1).churn, null, '変わったデックの churn は、churn 抜きでは引き継がない');
  assert.equal(byKey(third, A, 2).text, 'CACHE から来た本文');

  // HEAD が動いたら、withChurn のときは数え直す
  commit('v4', '2026-07-02');
  const fourth = C.buildCorpus(root, { git: GIT, cache: roundtrip });
  assert.equal(byKey(fourth, A, 1).churn.touched, 2);

  // 版の違う cache は使わない
  const stale = C.buildCorpus(root, { git: GIT, withChurn: false, cache: { ...roundtrip, version: -1 } });
  assert.equal(byKey(stale, A, 2).text.includes('CACHE'), false);
});

test('buildCorpus：git が無くても（リポジトリでなくても）落ちない', (t) => {
  const { root, A } = makeRepo(false);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const c = C.buildCorpus(root, { git: path.join(root, 'no-such-git') });
  assert.equal(c.entries.length, 11);
  assert.equal(c.head, null);
  assert.equal(byKey(c, A, 1).churn, null);
  assert.equal(typeof byKey(c, A, 1).score, 'number');
  const noMap = fs.rmSync(path.join(root, 'docs'), { recursive: true, force: true });
  assert.equal(noMap, undefined);
  assert.equal(byKey(C.buildCorpus(root, { withChurn: false }), A, 1).group, null, '添削マップが読めなければ group は null');
});

test('readCorpus / writeCorpus：往復できる。壊れた・版違いの索引は null', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-rw-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(C.corpusPath(dir), path.join(dir, 'slides', '_library', 'corpus.json'));
  assert.equal(C.readCorpus(dir), null);
  const c = { version: C.CORPUS_VERSION, generatedAt: 'x', head: null, withChurn: false, decks: {}, entries: [], warnings: [] };
  assert.equal(C.writeCorpus(dir, c), C.corpusPath(dir));
  assert.deepEqual(C.readCorpus(dir), c);
  assert.deepEqual(fs.readdirSync(path.dirname(C.corpusPath(dir))), ['corpus.json'], '一時ファイルを残さない');
  fs.writeFileSync(C.corpusPath(dir), '{ 壊れた');
  assert.equal(C.readCorpus(dir), null);
  fs.writeFileSync(C.corpusPath(dir), JSON.stringify({ ...c, version: 0 }));
  assert.equal(C.readCorpus(dir), null);
});

// ───────────────────────── searchCorpus ─────────────────────────

const ent = (o) => ({
  key: `${o.deck || 'slides/d/d.md'}#${o.slide || 1}`, deck: 'slides/d/d.md', deckName: 'd', slide: 1, title: '', pattern: '', theme: 'academic', date: '2026-01-01',
  text: '', chars: 0, mark: null, churn: null, group: null, converted: false, score: 0, dupOf: null, dupCount: 1, ...o,
});

function sample() {
  const entries = [
    ent({ slide: 1, title: '自己紹介', text: '自己紹介 山田 太郎', score: 0.3 }),
    ent({ slide: 2, title: '自己紹介', text: '自己紹介 山田 太郎 准教授', score: 3.1, deck: 'slides/e/e.md', deckName: '20260620_EdTech', date: '2026-06-20' }),
    ent({ slide: 3, title: '今日の流れ', text: '今日の流れ 最初に自己紹介をします', score: 5.0 }),
    ent({ slide: 4, title: 'Slidoの使い方', text: 'Ｓｌｉｄｏ を開いてください。サーバーに接続します', score: 1, theme: 'tsutawaru-academic', date: '2026-09-01' }),
    ent({ slide: 5, title: '完成スライド', text: '完成した まとめ', score: 7, mark: { id: 'done-summary', tags: ['まとめ', '締め'] }, pattern: 'summary' }),
    ent({ slide: 6, title: '', text: '講師の紹介', pattern: 'intro', score: 0.2 }),
    ent({ slide: 7, title: '自己紹介', text: '自己紹介 山田 太郎 准教授', score: 0.1, deck: 'slides/f/f.md', deckName: 'f' }),
  ];
  entries[6].dupOf = entries[1].key; entries[1].dupCount = 2;
  return { version: C.CORPUS_VERSION, entries };
}

test('searchCorpus：題名の一致を重く見て、その中では手を入れたスライドが上', () => {
  const r = C.searchCorpus(sample(), '自己紹介');
  assert.deepEqual(r.items.map((i) => i.entry.slide), [2, 1, 3, 6]);
  assert.equal(r.total, 4);
  assert.equal(r.items[0].titleHit, true);
  assert.equal(r.items[2].titleHit, false);
  assert.equal(r.items[0].dupCount, 2, '束の大きさ');
  assert.equal(r.items[3].entry.pattern, 'intro', '型 intro は「自己紹介」でも引ける');
  assert.match(r.items[2].snippet, /自己紹介/);
});

test('searchCorpus：AND・揺れ（全角/半角・大文字小文字・長音）・タグ・デック名', () => {
  const c = sample();
  assert.deepEqual(C.searchCorpus(c, 'slido').items.map((i) => i.entry.slide), [4]);
  assert.deepEqual(C.searchCorpus(c, 'ＳＬＩＤＯ　サーバ').items.map((i) => i.entry.slide), [4]);
  assert.deepEqual(C.searchCorpus(c, 'slido 自己紹介').items, []);
  assert.deepEqual(C.searchCorpus(c, '締め').items.map((i) => i.entry.slide), [5]);
  assert.deepEqual(C.searchCorpus(c, 'done-summary').items.map((i) => i.entry.slide), [5]);
  assert.deepEqual(C.searchCorpus(c, 'edtech').items.map((i) => i.entry.slide), [2]);
});

test('searchCorpus：絞り込み・並び・重複のまとめ・ページ送り・空の検索', () => {
  const c = sample();
  assert.deepEqual(C.searchCorpus(c, '', {}).items.map((i) => i.entry.slide), [5, 3, 2, 4, 1, 6], '空なら score 順（束は 1 件）');
  assert.deepEqual(C.searchCorpus(c, '', { onlyMarked: true }).items.map((i) => i.entry.slide), [5]);
  assert.deepEqual(C.searchCorpus(c, '', { theme: 'tsutawaru-academic' }).items.map((i) => i.entry.slide), [4]);
  assert.deepEqual(C.searchCorpus(c, '', { sort: 'recent', limit: 2 }).items.map((i) => i.entry.slide), [4, 2]);
  assert.deepEqual(C.searchCorpus(c, '自己紹介', { dedupe: false }).items.map((i) => i.entry.slide), [2, 1, 7, 3, 6]);
  // 代表が絞り込みで外れたら、束の次点が残る
  assert.deepEqual(C.searchCorpus(c, '准教授', { excludeDeck: 'slides/e/e.md' }).items.map((i) => i.entry.slide), [7]);
  const p1 = C.searchCorpus(c, '', { limit: 2 }), p2 = C.searchCorpus(c, '', { offset: 2, limit: 2 });
  assert.equal(p1.total, 6);
  assert.deepEqual(p1.items.concat(p2.items).map((i) => i.entry.slide), [5, 3, 2, 4]);
  // 壊れた入力でも落ちない
  assert.deepEqual(C.searchCorpus(null, 'x'), { total: 0, items: [] });
  assert.deepEqual(C.searchCorpus({}, ''), { total: 0, items: [] });
});

test('searchCorpus：約 4,000 件で 1 回 30ms 以内', (t) => {
  if (process.env.CI) return t.skip('CI の共有ランナーでは速さを測らない');
  const words = ['生成AI', 'ハルシネーション', '著作権', '自己紹介', 'Slido', '重み', 'ネットワーク', '学習', '推論', '評価'];
  const entries = [];
  for (let i = 0; i < 4000; i++) {
    const w = words[i % words.length];
    entries.push(ent({ slide: i + 1, deck: `slides/d${i % 170}/d.md`, title: `${w} その${i % 37}`, text: (`${w} について説明します。` + words.join(' と ')).repeat(6).slice(0, 600), score: (i % 50) / 10 }));
  }
  const c = { version: 1, entries };
  C.searchCorpus(c, '自己紹介'); // 正規化の cache を温める（拡張でも索引を読んだ直後に 1 回だけかかる）
  for (const q of ['自己紹介', '重み 学習', 'slido', '']) {
    const t0 = process.hrtime.bigint();
    const r = C.searchCorpus(c, q);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(r.total > 0);
    assert.ok(ms < 30, `「${q}」に ${ms.toFixed(1)}ms`);
  }
});

// ───────────────────────── 棚 ─────────────────────────

function shelfRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-shelf-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('readShelf：無ければ空の棚。未知のキーを保ち、重複をまとめ、読めない項目で落ちない', (t) => {
  const root = shelfRepo(t);
  const empty = C.readShelf(root);
  assert.deepEqual(JSON.parse(JSON.stringify(empty)), { version: 1, shelves: [] });
  assert.equal(empty.exists, false);
  assert.equal(empty.broken, false);
  assert.deepEqual(empty.warnings, []);

  fs.mkdirSync(path.dirname(C.shelfPath(root)), { recursive: true });
  fs.writeFileSync(C.shelfPath(root), '﻿' + JSON.stringify({
    version: 1, memo: '手で足したキー',
    shelves: [
      { name: ' 自己紹介 ', color: 'red', items: [
        { label: '学外用', deck: './slides/a/a.md', id: 'self-ext', slide: 2, title: '自己紹介', note: '未知のキー' },
        { label: '学外用（重複）', deck: 'slides/a/a.md', id: 'self-ext' },
        { deck: 'slides/b/b.md', slide: '3', title: '自己紹介 3枚構成' },
        { label: 'deck なし' }, 42, null,
      ] },
      'ごみ',
      { name: '自己紹介', items: [{ label: '別の棚に書いた分', deck: 'slides\\c\\c.md', slide: 1 }] },
      { items: 'x' },
    ],
  }));
  const s = C.readShelf(root);
  assert.equal(s.broken, false);
  assert.equal(s.memo, '手で足したキー');
  assert.deepEqual(s.shelves.map((v) => v.name), ['自己紹介', '（名前なし）']);
  assert.equal(s.shelves[0].color, 'red');
  assert.deepEqual(s.shelves[0].items.map((i) => i.label), ['学外用', '自己紹介 3枚構成', '別の棚に書いた分']);
  assert.equal(s.shelves[0].items[0].note, '未知のキー');
  assert.equal(s.shelves[0].items[0].deck, 'slides/a/a.md');
  assert.equal(s.shelves[0].items[1].slide, 3);
  assert.equal(s.shelves[0].items[2].deck, 'slides/c/c.md');
  assert.ok(s.warnings.length >= 4, s.warnings.join(' / '));
});

test('readShelf / writeShelf：壊れた shelf.json は空の棚として読み、上書きしない', (t) => {
  const root = shelfRepo(t);
  const p = C.shelfPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  for (const bad of ['{ "version": 1, "shelves": [ { "name": "自己紹介", ', '[1,2]', '{"shelves": {"a": 1}}', '']) {
    fs.writeFileSync(p, bad);
    const s = C.readShelf(root);
    assert.equal(s.broken, true, bad);
    assert.deepEqual(s.shelves, []);
    assert.ok(s.warnings.length > 0);
    const add = C.shelfAdd(s, { shelf: '自己紹介', label: 'x', ref: { deck: 'slides/a/a.md', slide: 1 } });
    assert.equal(add.ok, true);
    const w = C.writeShelf(root, add.shelf);
    assert.equal(w.ok, false);
    assert.match(w.reason, /上書きしません/);
    assert.equal(fs.readFileSync(p, 'utf8'), bad, '壊れたファイルはそのまま');
  }
  // 直せば書ける。warnings などの付帯情報はファイルに出さない。一時ファイルを残さない
  fs.writeFileSync(p, '{}');
  const ok = C.readShelf(root);
  assert.equal(ok.broken, false);
  const w = C.writeShelf(root, C.shelfAdd(ok, { shelf: '自己紹介', label: '学外用', ref: { deck: 'slides/a/a.md', slide: 1, title: '自己紹介' } }).shelf);
  assert.deepEqual(w, { ok: true, path: p });
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { version: 1, shelves: [{ name: '自己紹介', items: [{ label: '学外用', deck: 'slides/a/a.md', slide: 1, title: '自己紹介' }] }] });
  assert.deepEqual(fs.readdirSync(path.dirname(p)), ['shelf.json']);
  assert.ok(fs.readFileSync(p, 'utf8').endsWith('}\n'));
});

test('resolveShelf：id → 同じデックで題名一致 → slide 番号。行方不明でも消さない', () => {
  const corpus = { entries: [
    ent({ deck: 'slides/a/a.md', slide: 1, title: '表紙' }),
    ent({ deck: 'slides/a/a.md', slide: 2, title: '自己紹介' }),
    ent({ deck: 'slides/a/a.md', slide: 3, title: '別の話' }),
    ent({ deck: 'slides/a/a.md', slide: 7, title: '自己紹介' }),
    ent({ deck: 'slides/moved/moved.md', slide: 4, title: '改題した自己紹介', mark: { id: 'self-ext', tags: [] } }),
    ent({ deck: 'slides/b/b.md', slide: 1, title: 'コピー', mark: { id: 'twice', tags: [] } }),
    ent({ deck: 'slides/c/c.md', slide: 9, title: 'コピー', mark: { id: 'twice', tags: [] } }),
  ].map((e) => ({ ...e, key: `${e.deck}#${e.slide}` })) };
  const shelf = { version: 1, shelves: [{ name: '自己紹介', items: [
    { label: 'id が最優先（デックも題名も番号も違っていても追える）', deck: 'slides/a/a.md', id: 'self-ext', slide: 3, title: '別の話' },
    { label: '題名（番号がずれた。近いほうを選ぶ）', deck: 'slides/a/a.md', slide: 6, title: '自己紹介' },
    { label: '題名（番号なしなら最初の 1 枚）', deck: 'slides/a/a.md', title: '自己紹介！' },
    { label: '番号（題名が変わった）', deck: 'slides/a/a.md', slide: 3, title: '昔の題名' },
    { label: '同じ id が 2 つあれば同じデックを優先', deck: 'slides/c/c.md', id: 'twice' },
    { label: '行方不明：id が無くなり、題名も番号も合わない', deck: 'slides/a/a.md', id: 'gone', slide: 99, title: '消えた' },
    { label: '行方不明：デックが無い', deck: 'slides/none/none.md', slide: 1, title: '表紙' },
  ] }] };
  const before = JSON.stringify(shelf);
  const r = C.resolveShelf(shelf, corpus);
  assert.equal(JSON.stringify(shelf), before, '棚を書き換えない');
  assert.equal(r.length, 1);
  assert.equal(r[0].name, '自己紹介');
  assert.deepEqual(r[0].items.map((i) => [i.entry && i.entry.key, i.how]), [
    ['slides/moved/moved.md#4', 'id'],
    ['slides/a/a.md#7', 'title'],
    ['slides/a/a.md#2', 'title'],
    ['slides/a/a.md#3', 'slide'],
    ['slides/c/c.md#9', 'id'],
    [null, null],
    [null, null],
  ]);
  assert.equal(r[0].items[5].label, shelf.shelves[0].items[5].label);
  assert.deepEqual(r[0].items[5].ref, shelf.shelves[0].items[5]);
  // 索引が無くても落ちず、全部が行方不明として残る
  assert.equal(C.resolveShelf(shelf, null)[0].items.filter((i) => i.entry === null).length, 7);
  assert.deepEqual(C.resolveShelf(null, corpus), []);
});

test('棚の編集（純粋関数）：足す・呼び名・並べ替え・棚をまたぐ移動・外す・棚の名前と順序', () => {
  const e1 = ent({ deck: 'slides/a/a.md', slide: 2, title: '自己紹介', mark: { id: 'self-ext', tags: [] } });
  const e2 = ent({ deck: 'slides/b/b.md', slide: 5, title: '自己紹介' });
  const e3 = ent({ deck: 'slides/c/c.md', slide: 1, title: '連絡先' });
  let s = { version: 1, shelves: [], memo: 'keep' };
  const frozen = JSON.stringify(s);
  let r = C.shelfAdd(s, { shelf: '自己紹介', label: '自己紹介 学外用', entry: e1 });
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(s), frozen, '引数を変えない');
  assert.deepEqual(r.shelf.shelves[0].items[0], { label: '自己紹介 学外用', deck: 'slides/a/a.md', id: 'self-ext', slide: 2, title: '自己紹介' });
  assert.equal(r.shelf.memo, 'keep');
  s = r.shelf;
  s = C.shelfAdd(s, { shelf: '自己紹介', label: '3枚構成の1枚目', entry: e2 }).shelf;
  s = C.shelfAdd(s, { shelf: '自己紹介', entry: e3, at: 0 }).shelf; // 呼び名を省くと題名。at で位置
  assert.deepEqual(s.shelves[0].items.map((i) => i.label), ['連絡先', '自己紹介 学外用', '3枚構成の1枚目']);
  // 同じスライドをもう一度足すと、増やさず呼び名だけ直す
  r = C.shelfAdd(s, { shelf: '自己紹介', label: '学外用（新）', entry: e1 });
  assert.equal(r.existed, true);
  assert.deepEqual(r.shelf.shelves[0].items.map((i) => i.label), ['連絡先', '学外用（新）', '3枚構成の1枚目']);
  s = r.shelf;
  // 足せないもの
  assert.equal(C.shelfAdd(s, { label: 'x', entry: e1 }).ok, false);
  assert.equal(C.shelfAdd(s, { shelf: 'x', label: 'x', ref: { deck: 'slides/a/a.md' } }).ok, false);
  assert.equal(C.shelfAdd(s, { shelf: 'x', label: 'x', ref: { slide: 1 } }).ok, false);
  assert.equal(C.shelfAdd(s, { shelf: 'x', label: 'x', ref: { slide: 1 } }).shelf, s, '失敗時は元の棚を返す');

  // 呼び名（番号でも、今の呼び名でも指せる）
  s = C.shelfRename(s, { shelf: '自己紹介', index: 0, to: '連絡先 共通' }).shelf;
  s = C.shelfRename(s, { shelf: '自己紹介', label: '学外用（新）', to: '自己紹介 学外用' }).shelf;
  assert.deepEqual(s.shelves[0].items.map((i) => i.label), ['連絡先 共通', '自己紹介 学外用', '3枚構成の1枚目']);
  assert.equal(C.shelfRename(s, { shelf: '自己紹介', index: 9, to: 'x' }).ok, false);
  assert.equal(C.shelfRename(s, { shelf: '自己紹介', index: 0, to: '  ' }).ok, false);
  assert.equal(C.shelfRename(s, { shelf: '無い棚', index: 0, to: 'x' }).ok, false);

  // 並べ替え（to は移した後の位置）
  s = C.shelfMove(s, { shelf: '自己紹介', index: 0, to: 2 }).shelf;
  assert.deepEqual(s.shelves[0].items.map((i) => i.label), ['自己紹介 学外用', '3枚構成の1枚目', '連絡先 共通']);
  s = C.shelfMove(s, { shelf: '自己紹介', label: '連絡先 共通', to: 0 }).shelf;
  assert.deepEqual(s.shelves[0].items.map((i) => i.label), ['連絡先 共通', '自己紹介 学外用', '3枚構成の1枚目']);
  assert.deepEqual(C.shelfMove(s, { shelf: '自己紹介', index: 0, to: 99 }).shelf.shelves[0].items.map((i) => i.label), ['自己紹介 学外用', '3枚構成の1枚目', '連絡先 共通']);
  // 別の棚へ（無ければ作る）。同じスライドがある棚へは移せない
  s = C.shelfMove(s, { shelf: '自己紹介', index: 0, toShelf: '締め' }).shelf;
  assert.deepEqual(s.shelves.map((v) => [v.name, v.items.length]), [['自己紹介', 2], ['締め', 1]]);
  const dupTarget = C.shelfAdd(s, { shelf: '締め', label: 'x', entry: e1 }).shelf;
  assert.equal(C.shelfMove(dupTarget, { shelf: '自己紹介', index: 0, toShelf: '締め' }).ok, false);

  // 棚の名前・順序
  assert.equal(C.shelfRenameShelf(s, { shelf: '締め', to: '自己紹介' }).ok, false, '既にある名前には変えない');
  s = C.shelfRenameShelf(s, { shelf: '締め', to: '連絡先' }).shelf;
  s = C.shelfMoveShelf(s, { shelf: '連絡先', to: 0 }).shelf;
  assert.deepEqual(s.shelves.map((v) => v.name), ['連絡先', '自己紹介']);
  assert.equal(C.shelfMoveShelf(s, { shelf: '連絡先' }).ok, false);

  // 外す。中身のある棚は消さない。空の棚は消せる
  assert.equal(C.shelfRemove(s, { shelf: '連絡先' }).ok, false);
  s = C.shelfRemove(s, { shelf: '連絡先', index: 0 }).shelf;
  assert.deepEqual(s.shelves.map((v) => [v.name, v.items.length]), [['連絡先', 0], ['自己紹介', 2]]);
  s = C.shelfRemove(s, { shelf: '連絡先' }).shelf;
  assert.deepEqual(s.shelves.map((v) => v.name), ['自己紹介']);
  assert.equal(C.shelfRemove(s, { shelf: '自己紹介', label: '無い呼び名' }).ok, false);
  // 同じ呼び名が 2 つあるときは、呼び名では指せない（番号で指す）
  const twin = C.shelfAdd(s, { shelf: '自己紹介', label: '自己紹介 学外用', entry: e3 }).shelf;
  assert.equal(C.shelfRemove(twin, { shelf: '自己紹介', label: '自己紹介 学外用' }).ok, false);
  assert.equal(C.shelfRemove(twin, { shelf: '自己紹介', index: 2 }).ok, true);
});

test('searchCorpus：棚の呼び名と棚名にも当たり、棚のスライドを先頭に出す', () => {
  const c = sample();
  const E = (n) => c.entries[n - 1];
  const shelf = C.resolveShelf({ version: 1, shelves: [
    { name: '定番', items: [
      { label: '講師プロフィール 学外用', deck: E(1).deck, slide: 1, title: '自己紹介' },
      { label: 'よく使う重複版', deck: 'slides/f/f.md', slide: 7, title: '自己紹介' },
      { label: '行方不明', deck: 'slides/none.md', slide: 1 },
    ] },
    { name: '投票', items: [{ label: '会場への問いかけ', deck: E(4).deck, slide: 4, title: 'Slidoの使い方' }] },
  ] }, { entries: c.entries.map((e) => ({ ...e })) });
  // resolve は deck+slide で引く。sample の entry は deck が key と食い違うものがあるので、key で照合できる形に直す
  shelf[0].items[0].entry = E(1); shelf[0].items[1].entry = E(7); shelf[1].items[0].entry = E(4);

  // 呼び名で引ける（本文にも題名にも無い語）
  let r = C.searchCorpus(c, 'プロフィール', { shelf });
  assert.deepEqual(r.items.map((i) => i.entry.slide), [1]);
  assert.deepEqual(r.items[0].shelf, { name: '定番', label: '講師プロフィール 学外用' });
  // 棚名で引ける
  assert.deepEqual(C.searchCorpus(c, '投票', { shelf }).items.map((i) => i.entry.slide), [4]);
  // 棚のスライドが先頭。棚の 2 枚は同じ束でも両方出る（自分で呼び名を付けて区別したもの）。束の代表（2）は重ねて出さない…ではなく、
  // 代表は棚に無いので、束としては棚の版に代表される
  r = C.searchCorpus(c, '自己紹介', { shelf });
  assert.deepEqual(r.items.map((i) => i.entry.slide), [1, 7, 3, 6]);
  assert.equal(r.items[2].shelf, null);
  // 空の検索：棚に並べた順 → そのあと score 順
  r = C.searchCorpus(c, '', { shelf });
  assert.deepEqual(r.items.map((i) => i.entry.slide), [1, 7, 4, 5, 3, 6]);
  // 絞り込みは棚にも効く
  assert.deepEqual(C.searchCorpus(c, '', { shelf, onlyMarked: true }).items.map((i) => i.entry.slide), [5]);
  // 棚を渡さなければ従来どおり
  assert.deepEqual(C.searchCorpus(c, 'プロフィール').items, []);
  // 壊れた棚でも落ちない
  assert.equal(C.searchCorpus(c, '自己紹介', { shelf: [null, { items: [null, { entry: null }] }, { name: 'x' }] }).total, 4);
});

// ───────────────────────── CLI ─────────────────────────

test('CLI：corpus / search / shelf / candidates（--root の合成リポジトリ。実リポジトリには書かない）', needGit, (t) => {
  const { root, A } = makeRepo(true);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...a) => execFileSync(process.execPath, [CLI, '--root', root, ...a], { encoding: 'utf8', cwd: root, env: { ...process.env, GIT }, stdio: ['ignore', 'pipe', 'pipe'] });
  const fail = (...a) => { try { run(...a); } catch (e) { return String(e.stderr) + String(e.stdout); } throw new Error('失敗するはず: ' + a.join(' ')); };

  const out = run('corpus');
  assert.match(out, /=> 11 枚（4 デック）/);
  assert.ok(fs.existsSync(C.corpusPath(root)));
  const other = path.join(root, 'elsewhere.json');
  run('corpus', '--no-churn', '--out', other);
  assert.equal(JSON.parse(fs.readFileSync(other, 'utf8')).entries.length, 11);

  const hits = JSON.parse(run('search', '自己紹介', '--json'));
  assert.equal(hits[0].key, A + '#1');
  assert.equal(hits[0].churn.touched, 2);
  assert.deepEqual(JSON.parse(run('search', '--marked', '--json')).map((e) => e.mark.id), ['star-agenda']);
  assert.deepEqual(JSON.parse(run('search', '自己紹介', '--theme', 'tsutawaru-academic', '--json')).map((e) => e.key).sort(), [FORKMD + '#1', FORKMD + '#3']);
  assert.match(run('search', 'どこにもない語'), /見つかりません/);

  // 棚
  assert.match(run('shelf', 'list'), /棚はまだありません/);
  run('shelf', 'add', path.join(root, FORKMD), '3', '--shelf', '自己紹介', '--label', '共同研究者の紹介');
  run('shelf', 'add', path.join(root, FORKMD), '2', '--shelf', '自己紹介', '--label', '今日の流れ 定番');
  run('shelf', 'add', path.join(root, A), '1', '--shelf', '自己紹介', '--label', '自己紹介 学外用', '--at', '1');
  let s = JSON.parse(fs.readFileSync(C.shelfPath(root), 'utf8'));
  assert.deepEqual(s.shelves[0].items.map((i) => i.label), ['自己紹介 学外用', '共同研究者の紹介', '今日の流れ 定番']);
  assert.equal(s.shelves[0].items[2].id, 'star-agenda');
  run('shelf', 'move', '--shelf', '自己紹介', '今日の流れ 定番', '--to', '1');
  run('shelf', 'rename', '--shelf', '自己紹介', '2', '--label', '自己紹介 学外用（3行）');
  run('shelf', 'move', '--shelf', '自己紹介', '3', '--to-shelf', '紹介いろいろ');
  run('shelf', 'rename', '--shelf', '紹介いろいろ', '--name', '人の紹介');
  run('shelf', 'move', '--shelf', '人の紹介', '--to', '1');
  s = JSON.parse(fs.readFileSync(C.shelfPath(root), 'utf8'));
  assert.deepEqual(s.shelves.map((v) => [v.name, v.items.map((i) => i.label)]), [['人の紹介', ['共同研究者の紹介']], ['自己紹介', ['今日の流れ 定番', '自己紹介 学外用（3行）']]]);
  const list = run('shelf', 'list');
  assert.match(list, /■ 人の紹介（1 枚）/);
  assert.match(list, /2\. 自己紹介 学外用（3行）\s+— slides\/20260601_Test_a-deck/);
  // 検索は呼び名に当たり、棚のスライドが先頭
  const viaLabel = run('search', '3行');
  assert.match(viaLabel, /棚：自己紹介 ／ 自己紹介 学外用（3行）/);
  assert.equal(JSON.parse(run('search', '自己紹介', '--json'))[0].key, A + '#1');
  assert.deepEqual(JSON.parse(run('search', '3行', '--no-shelf', '--json') || '[]'), []);
  // 元のスライドが消えても、棚には行方不明として残る
  fs.writeFileSync(path.join(root, FORKMD), FM('tsutawaru-academic') + '\n# 全部書き直した\n');
  assert.match(run('shelf', 'list'), /共同研究者の紹介\s+— ⚠ 行方不明/);
  run('shelf', 'remove', '--shelf', '人の紹介', '1');
  run('shelf', 'remove', '--shelf', '人の紹介');
  assert.deepEqual(JSON.parse(fs.readFileSync(C.shelfPath(root), 'utf8')).shelves.map((v) => v.name), ['自己紹介']);
  assert.match(fail('shelf', 'remove', '--shelf', '自己紹介'), /まだ 2 枚/);
  assert.match(fail('shelf', 'add', path.join(root, A), '1'), /--shelf/);
  // 壊れた shelf.json は上書きしない
  fs.writeFileSync(C.shelfPath(root), '{ こわれた');
  assert.match(fail('shelf', 'add', path.join(root, A), '2', '--shelf', '自己紹介'), /shelf\.json/);
  assert.equal(fs.readFileSync(C.shelfPath(root), 'utf8'), '{ こわれた');
  assert.match(run('shelf', 'list'), /棚はまだありません/);

  // candidates は corpus-core の churnOf を使う（出力の形は従来どおり）
  const cand = run('candidates', '--deck', path.join(root, A));
  assert.match(cand, /touched= 2 churn=\s*\d+\s+#\s+1 ［-］ 自己紹介\s+最終 2026-06-09/);
  assert.match(cand, /mark slides\/20260601_Test_a-deck\/20260601_Test_a-deck\.md 1 --id /);
});
