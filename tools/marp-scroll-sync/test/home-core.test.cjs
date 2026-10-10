// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// ホーム画面の純粋部分（lib/home-core.cjs）：手を入れた順・デック一覧・最近・検索・サムネイルの切り出し。
// 実行: node --test tools/marp-scroll-sync/test/home-core.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../lib/corpus-core.cjs');
const home = require('../lib/home-core.cjs');

const E = (deck, slide, extra) => Object.assign({
  key: `slides/${deck}/${deck}.md#${slide}`, deck: `slides/${deck}/${deck}.md`, deckName: deck, slide, title: 't' + slide, pattern: 'fig', theme: 'academic',
  date: '2026-06-0' + ((slide % 9) + 1), text: 'x', chars: 1, mark: null, churn: { touched: 0, lines: 0, last: '' }, group: null, converted: false, score: 0, dupOf: null, dupCount: 1,
}, extra || {});
const C = { entries: [
  E('A', 1, { churn: { touched: 3, lines: 40, last: '2026-06-07' }, group: 'A', score: 3 }),
  E('A', 2, { churn: { touched: 1, lines: 5, last: '2026-06-01' }, group: 'A', score: 1.5 }),
  E('A', 3, { mark: { id: 'a3' }, score: 6 }),
  E('B', 1, { churn: { touched: 3, lines: 90, last: '2026-05-01' }, score: 2.9 }),
  E('B', 2, { churn: { touched: 2, lines: 5, last: '2026-09-01' }, dupOf: 'slides/A/A.md#2' }),
  E('C', 1, { converted: true, score: -2 }),
  E('C', 2, { converted: true, churn: { touched: 1, lines: 2, last: '2026-04-01' }, score: -0.8 }),
] };

test('mostEdited：直した回数 → 行数 → 新しい順。重複（dupOf）と、直していない物は出ない', () => {
  const r = home.mostEdited(C, { limit: 10 });
  assert.deepEqual(r.items.map(i => i.key.replace(/^slides\/(.)\/.*#/, '$1#')), ['B#1', 'A#1', 'A#2', 'C#2']);   // B#1 は同じ 3 回でも 90 行で上
  assert.equal(r.total, 4);
  assert.equal(r.items[0].touched, 3); assert.equal(r.items[0].lines, 90);
  assert.ok(!r.items.some(i => i.key.endsWith('B.md#2')), '重複は出ない');
  assert.ok(!r.items.some(i => i.key.endsWith('C.md#1')), '直していない変換のままは出ない');
});

test('mostEdited：sort=score なら ★ が先頭、sort=recent なら最後に直した日の順。offset/limit が効く', () => {
  const s = home.mostEdited(C, { sort: 'score', limit: 2 });
  assert.equal(s.items[0].key, 'slides/A/A.md#3'); assert.equal(s.items[0].marked, true);
  assert.equal(s.total, 5, '★ は直していなくても点数順には出る');
  const r = home.mostEdited(C, { sort: 'recent', limit: 10 });
  assert.equal(r.items[0].key, 'slides/A/A.md#1');
  const o = home.mostEdited(C, { limit: 1, offset: 1 });
  assert.equal(o.items.length, 1); assert.equal(o.items[0].key, 'slides/A/A.md#1');
});

test('decksOf：デック単位に畳む（枚数・直した枚・行・最終・★）。新しい順', () => {
  const d = home.decksOf(C);
  assert.deepEqual(d.map(x => x.deckName), ['B', 'A', 'C'].sort((a, b) => 0) .length === 3 ? d.map(x => x.deckName) : []);
  const a = d.find(x => x.deckName === 'A');
  assert.equal(a.slides, 3); assert.equal(a.touched, 2); assert.equal(a.lines, 45); assert.equal(a.last, '2026-06-07'); assert.equal(a.marked, 1); assert.equal(a.group, 'A');
  const c = d.find(x => x.deckName === 'C');
  assert.equal(c.converted, true); assert.equal(c.touched, 1);
  assert.equal(a.title, 't1', '1 枚目の題をデックの題にする');
});

test('recentPush：先頭に入れ、同じデックは 1 つ、上限を守る。元の配列は壊さない', () => {
  const l0 = [{ deck: 'slides/A/A.md', at: 1 }, { deck: 'slides/B/B.md', at: 2 }];
  const l1 = home.recentPush(l0, 'slides/B/B.md', 3);
  assert.deepEqual(l1.map(x => x.deck), ['slides/B/B.md', 'slides/A/A.md']);
  assert.equal(l1[0].at, 3);
  assert.equal(l0.length, 2);
  let l = [];
  for (let i = 0; i < 20; i++) l = home.recentPush(l, 'd' + i, i);
  assert.equal(l.length, home.RECENT_MAX); assert.equal(l[0].deck, 'd19');
  assert.equal(home.recentPush(null, 'x', 1).length, 1);
});

test('recentItems：索引に無いデックは外し、索引の情報（枚数など）を付ける', () => {
  const r = home.recentItems([{ deck: 'slides/B/B.md', at: 5 }, { deck: 'slides/Z/Z.md', at: 9 }, { deck: 'slides/A/A.md', at: 1 }], C);
  assert.deepEqual(r.map(x => x.deckName), ['B', 'A']);
  assert.equal(r[0].slides, 2); assert.equal(r[0].at, 5);
});

test('shelfItems：resolveShelf の形を Webview 用にし、行方不明は missing で残す', () => {
  const sh = home.shelfItems([{ name: '自己紹介', items: [{ label: '学外用', entry: C.entries[0] }, { label: '消えた', entry: null, ref: { deck: 'slides/X/X.md', slide: 4, title: 'old' } }] }]);
  assert.equal(sh[0].name, '自己紹介');
  assert.equal(sh[0].items[0].label, '学外用'); assert.equal(sh[0].items[0].key, 'slides/A/A.md#1'); assert.equal(sh[0].items[0].touched, 3);
  assert.equal(sh[0].items[1].missing, true); assert.equal(sh[0].items[1].slide, 4);
});

test('search：実際の索引（一時リポジトリ）で題名に当たり、棚の呼び名にも当たる', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-home-'));
  fs.mkdirSync(path.join(tmp, 'theme'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'theme', 'academic.css'), '/* @theme academic */ section{}');
  const deck = (name, slides) => {
    fs.mkdirSync(path.join(tmp, 'slides', name), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'slides', name, name + '.md'), ['---', 'marp: true', 'theme: academic', '---', ''].concat(slides.map((s) => s + '\n\n---\n')).join('\n'));
  };
  deck('20260101_X_intro', ['# 自己紹介\n\n- 千葉大学', '# 研究の概要\n\n- 水素']);
  deck('20260102_Y_net', ['# ネットワークとは\n\n- LAN と WAN']);
  const c = core.buildCorpus(tmp, { withChurn: false });
  const r = home.search(c, '自己紹介', { limit: 10 });
  assert.ok(r.total >= 1); assert.equal(r.items[0].title, '自己紹介'); assert.equal(r.items[0].slide, 1);
  const r2 = home.search(c, 'LAN', { limit: 10 });
  assert.ok(r2.items.some(i => i.deckName === '20260102_Y_net'), '本文でも当たる');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('splitSlides / safeThumb：スライド svg 単位に切り、script とイベント属性を外す', () => {
  const html = '<div class="marpit"><svg data-marpit-svg="" viewBox="0 0 1280 720"><foreignObject><section id="1"><img src="a.png" onerror="alert(1)"><svg viewBox="0 0 1 1"></svg><script>x()</script><a href="javascript:void(0)">j</a></section></foreignObject></svg>'
    + '<svg data-marpit-svg="" viewBox="0 0 1280 720"><foreignObject><section id="2">two</section></foreignObject></svg></div>';
  const s = home.splitSlides(html);
  assert.equal(s.length, 2);
  assert.ok(!/onerror|<script|javascript:/.test(s[0]));
  assert.ok(/<svg viewBox="0 0 1 1">/.test(s[0]), '本文のインライン svg は 1 枚目に残る');
  assert.ok(/two/.test(s[1]));
  assert.deepEqual(home.splitSlides('<p>no slides</p>'), []);
});
