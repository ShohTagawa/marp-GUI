// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 通し試験（E2E）：仮想 VS Code の上で本物の extension.js を動かし、本物の Webview HTML を Chrome に読み込んでつなぐ。
//   node --test tools/marp-scroll-sync/test/e2e.test.cjs
//   作業フォルダ：環境変数 SS_E2E_DIR（無ければ OS の一時フォルダ）。SS_E2E_KEEP=1 で終了後も残す（PNG 目視用）。
// 実デック（slides/ の原本）は読むだけ。作業フォルダへコピーしてから触る。
// LEC のコピーの末尾には、実デックに無い記法（自動リンク・インラインコード・コードブロック・Markdown の表）を
// 確かめるための合成スライドを1枚足している（SYNTH）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./helpers/e2e-harness.cjs');
const SPLIT = require('../lib/slide-split.cjs');

const LEC = 'sample-lecture';   // 見本：academic・橙（--accent #C8611C）
const LAY = 'sample-layouts';   // 見本：tsutawaru-academic・20 枚
const DEST = 'sample-parts';   // theme: tsutawaru-academic（LEC は academic・橙）＝テーマ違いの貼り付け先
const WORK = process.env.SS_E2E_DIR || path.join(os.tmpdir(), 'marp-scroll-sync-e2e');
const Q = 400;   // settle の静穏時間。単クリック逆引きの 250ms 待ちより長くする

const SYNTH = [
  '', '---', '', '<!-- _class: wrap -->', '', '## E2E 合成スライド', '',
  '- 公式は <https://example.com/docs> を見る',
  '- コマンドは `dig example.com` を使う',
  '- 前半**太字の語**後半の文',
  '', '```js', 'const answer = 42;', '```', '',
  '| 項目 | 内容 |', '|---|---|', '| 甲セル | 乙セル |', '',
].join('\n');

let browser;
let repoSeq = 0;
const haveChrome = !!H.findChrome();

test.before(async () => { if (haveChrome) browser = await H.launch(); });
test.after(async () => {
  if (browser) await browser.close();
  if (!process.env.SS_E2E_KEEP) fs.rmSync(WORK, { recursive: true, force: true });
});

function freshRepo(decks, o) {
  const repo = H.makeRepo(path.join(WORK, 'repo-' + (++repoSeq)), decks);
  if (o && o.synth && repo.md[LEC]) fs.appendFileSync(repo.md[LEC], SYNTH);
  return repo;
}
async function session(deck, o) {
  o = o || {};
  const repo = o.repo || freshRepo(o.decks || [deck], { synth: o.synth });
  const S = await H.openSession(Object.assign({ browser, mdPath: repo.md[deck] }, o.session || {}));
  S.repo = repo;
  return S;
}
const lineOf = (text, needle, nth) => {
  const L = text.split('\n'); let n = nth || 0;
  for (let i = 0; i < L.length; i++) if (L[i].includes(needle) && n-- === 0) return i;
  throw new Error('原稿に無い: ' + needle);
};
const slideOfLine = (text, line) => SPLIT.slideIndexForLine(SPLIT.slideStartLines(text), line);
const slideOf = (text, needle, nth) => slideOfLine(text, lineOf(text, needle, nth));
const noErrors = (S, label) => {
  assert.deepEqual(S.consoleErrors, [], label + ': ブラウザのコンソールエラー');
  assert.deepEqual(S.extErrors, [], label + ': 拡張側の console.error');
};
const failed = (S, mk) => S.sinceW(mk, 'editResult').filter(m => !m.ok);
// 再描画は、変わったスライドだけの patch か、全体の render のどちらかで届く（DESIGN.md 8.4）
const redraws = (S, mk) => S.sinceW(mk).filter(m => m.type === 'render' || m.type === 'patch');

/** ダブルクリック → sub の直後にキャレット → 打鍵 → キー。戻り値に前後の原稿と目印 */
async function editText(S, index, sub, typed, o) {
  o = o || {};
  const before = S.doc.getText(), shown = await H.slideText(S.page, index), mk = S.mark(), depth = S.undoDepth();
  const pt = await H.textPoint(S.page, index, sub, o);
  await H.dbl(S.page, pt);
  const info = await H.pageInfo(S.page);
  if (o.svg) {
    assert.notEqual(info.svgInput, null, 'SVG の入力欄が開く');
    await S.page.keyboard.press('End');
  } else {
    assert.ok(info.editingTag, `「${sub}」で編集が始まる`);
    assert.ok(await H.caretAt(S.page, o.caretSub || sub, 'after'), 'キャレットを置ける');
  }
  if (o.raw) await S.page.evaluate((t) => document.execCommand('insertText', false, t), typed);
  else if (typed) await S.page.keyboard.type(typed);
  if (o.beforeKey) await o.beforeKey();
  if (o.shift) await S.page.keyboard.down('Shift');
  await S.page.keyboard.press(o.key || 'Enter');
  if (o.shift) await S.page.keyboard.up('Shift');
  await S.settle(Q);
  return { before, after: S.doc.getText(), shown, mk, depth, pt, info };
}
/** 1行だけが sub→sub+typed に変わり、検算の警告が無く、undo 1回で完全に戻る */
async function expectOneLineEdit(S, index, sub, typed, o) {
  const r = await editText(S, index, sub, typed, o);
  const d = H.lineDiff(r.before, r.after);
  assert.equal(d.removed.length, 1, `「${sub}」: 変わるのは1行（removed=${JSON.stringify(d.removed)} added=${JSON.stringify(d.added)}）`);
  assert.equal(d.added.length, 1);
  const want = (o && o.expectLine) ? o.expectLine(d.removed[0]) : d.removed[0].replace(sub, sub + typed);
  assert.equal(d.added[0], want, '原稿のその箇所だけが変わる');
  assert.equal(S.undoDepth(), r.depth + 1, '1操作＝1 WorkspaceEdit');
  assert.deepEqual(failed(S, r.mk), [], 'editResult ok:false が来ない');
  const info = await H.pageInfo(S.page);
  assert.ok(!/ずれました/.test(info.toast), '検算の警告が出ない: ' + info.toast);
  const renders = redraws(S, r.mk);
  assert.ok(renders.length >= 1, '再描画される');
  assert.ok((await H.slideText(S.page, index)).includes((o && o.shownSub) || (sub + typed)), '再描画後の表示に打った文字がある');
  await undoFromPreview(S);
  assert.equal(S.doc.getText(), r.before, 'undo 1回で原稿が完全に元へ戻る');
  assert.equal(S.undoDepth(), r.depth);
  assert.equal(await H.slideText(S.page, index), r.shown, 'undo 後の表示も元どおり');
  return Object.assign(r, { diff: d });
}
async function undoFromPreview(S) {
  const mk = S.mark();
  await S.page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  await S.page.keyboard.down('Control'); await S.page.keyboard.press('z'); await S.page.keyboard.up('Control');
  await S.settle(Q);
  assert.equal(S.sinceE(mk, 'undo').length, 1, 'undo メッセージが拡張へ届く');
}
/** 書けない編集：原稿が1バイトも変わらず、ok:false が届き、表示が元へ戻る */
async function expectRefused(S, index, sub, typed, o) {
  const r = await editText(S, index, sub, typed, o);
  assert.equal(r.after, r.before, `「${sub}」: 原稿は1バイトも変わらない`);
  assert.equal(S.undoDepth(), r.depth);
  const bad = failed(S, r.mk);
  const unsupported = S.sinceE(r.mk, 'editCommit').length === 0;   // ブラウザ側で unsupported と判断した場合は送られない
  assert.ok(bad.length >= 1 || unsupported, 'editResult ok:false が届く（またはブラウザ側で断る）');
  assert.equal(await H.slideText(S.page, index), r.shown, '表示が元へ戻る');
  return Object.assign(r, { bad });
}
/** 開いている検索ギャラリーを「★ 完成だけ」に絞り、並んだカードの key を返す */
async function markedKeys(S) {
  await S.page.waitForSelector('.ss-gallery.ss-open.ss-corpus', { timeout: 3000 });
  const mk = S.mark();
  await S.page.evaluate(() => { const c = document.querySelector('.ss-gal-check.ss-gal-corpus input'); if (!c.checked) c.click(); });
  await S.waitFor(() => S.sinceW(mk, 'corpusResults').length >= 1, '★ 完成だけ の応答', 5000);
  await S.settle(Q);
  return S.page.evaluate(() => Array.from(document.querySelectorAll('.ss-gal-grid > .ss-gal-pick')).map(c => c.getAttribute('data-key')));
}
async function moveCursor(S, line) {
  S.editor.selection = new S.vscode.Selection(line, 0, line, 0);
  await S.settle(Q);
}
async function clickOp(S, op) {
  await S.page.evaluate(() => window.scrollBy(0, 0));
  const sel = `.ss-ops button[data-op="${op}"]`;
  await S.page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel);
  await S.page.click(sel);
  await S.settle(Q);
}

const T = (name, o, fn) => { if (typeof o === 'function') { fn = o; o = {}; } return test(name, Object.assign({ skip: haveChrome ? false : 'Chrome が見つからない', timeout: 180000 }, o), fn); };

// ---------- 1. 開く ----------
T('1. プレビューを開く：枚数・バッジ・操作ボタン・★・コンソールエラー無し', async () => {
  for (const deck of [LEC, LAY]) {
    const S = await session(deck);
    try {
      assert.equal(S.activateError, null);
      const n = H.marpRender(S.doc.getText()).slides;
      const info = await H.pageInfo(S.page);
      assert.equal(info.slides, n, deck + ': 枚数が marp-core と同じ');
      assert.equal(info.badge, `Slide 1/${n}`);
      assert.equal(info.current, 0);
      assert.deepEqual(info.ops, ['new', 'duplicate', 'moveUp', 'moveDown', 'delete', 'mark', 'library']);
      assert.equal(info.stars, 0, '印の無いデックに ★ は出ない');
      assert.equal(S.loads, 1);
      noErrors(S, deck);
    } finally { await S.close(); }
  }
});

// ---------- 2. 3. 直接編集 ----------
T('2. 箇条書きをダブルクリック→打鍵→Enter：1行だけ変わり、undo 1回で戻る', async () => {
  const S = await session(LEC);
  try {
    const t = S.doc.getText();
    const si = slideOf(t, '- 同期プレビューとは何かを理解する');
    await expectOneLineEdit(S, si, 'とは何かを理解する', 'Ｅ２Ｅ');
    // Esc：破棄。原稿は変わらず、表示も戻り、何も送られない
    const r = await editText(S, si, 'とは何かを理解する', '捨てる', { key: 'Escape' });
    assert.equal(r.after, t); assert.equal(S.sinceE(r.mk, 'editCommit').length, 0);
    assert.equal(await H.slideText(S.page, si), r.shown);
    // 外をクリック（blur）：確定。そのクリックで原稿へ飛ばない（逆引きを送らない）
    const mk = S.mark();
    const pt = await H.textPoint(S.page, si, 'とは何かを理解する');
    await H.dbl(S.page, pt); await H.caretAt(S.page, 'とは何かを理解する', 'after');
    await S.page.keyboard.type('確定');
    const blank = await S.page.evaluate((i) => { const b = document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[i].getBoundingClientRect(); return { x: b.right - 30, y: b.top + b.height * 0.75 }; }, si);
    await S.page.mouse.click(blank.x, blank.y);
    await S.settle(Q);
    assert.equal(S.sinceE(mk, 'editCommit').length, 1, 'blur で確定');
    assert.equal(S.doc.lineAt(lineOf(t, '- 同期プレビューとは何かを理解する')).text, '- 同期プレビューとは何かを理解する確定');
    assert.deepEqual(S.sinceE(mk).filter(m => /^reveal/.test(m.type)), [], '確定のクリックで逆引きしない');
    await undoFromPreview(S);
    assert.equal(S.doc.getText(), t);
    // プレビューを開き直しても動く（html を読み込み直す）
    await S.exec('marpScrollSync.openPreview'); await S.settle(Q);
    assert.equal(S.loads, 2); assert.equal(S.panels.length, 1, 'パネルは作り直さない');
    await expectOneLineEdit(S, si, 'とは何かを理解する', '再');
    noErrors(S, '2');
  } finally { await S.close(); }
});

T('3a. takeaway / page-title / html_block 内の div / 太字の外側（LEC）', async () => {
  const S = await session(LEC, { synth: true });
  try {
    const t = S.doc.getText();
    await expectOneLineEdit(S, slideOf(t, '<div class="takeaway">今日のゴール'), 'ひとつ直してみる', '！');
    await expectOneLineEdit(S, slideOf(t, '<div class="page-title">こんな「面倒」</div>'), 'こんな「面倒」', '集');
    // 太字の外側（**締切を見落とす** の前の地の文）
    await expectOneLineEdit(S, slideOf(t, '- 原稿の**誤字を見落とす**'), '原稿の', 'ＸＹ');
    // 太字の内側
    await expectOneLineEdit(S, slideOf(t, '- 原稿の**誤字を見落とす**'), '誤字を見落とす', '点');
    // 合成スライド：太字の直後の地の文・Markdown の表のセル
    const si = slideOf(t, '## E2E 合成スライド');
    await expectOneLineEdit(S, si, '後半の文', '末');
    await expectOneLineEdit(S, si, '乙セル', '改');
    noErrors(S, '3a');
  } finally { await S.close(); }
});

T('3b. HTML の表のセル・同じ語が複数ある箇所・html_block の div・インライン SVG の text', async () => {
  const S = await session(LEC);
  try {
    const t = S.doc.getText();
    const si = slideOf(t, '<tr><td class="l">リフレクションシート</td>');
    await expectOneLineEdit(S, si, 'リフレクションシート', '提出');
    // 「6/16（火）」は同じスライドに4回。3個目（リフレクションシートの行）だけが変わること
    const r = await expectOneLineEdit(S, si, '6/16（火）', '正午', { occurrence: 2 });
    assert.ok(r.diff.removed[0].includes('リフレクションシート'), '3個目の行が変わる: ' + r.diff.removed[0]);
    const r0 = await expectOneLineEdit(S, si, '6/16（火）', '朝', { occurrence: 0 });
    assert.ok(r0.diff.removed[0].includes('視聴期限'), '1個目の行が変わる: ' + r0.diff.removed[0]);
    await expectOneLineEdit(S, si, '公開が遅れたため', '、', {});
    await expectOneLineEdit(S, si, '仕組みを知らなければ答えの正否を判断できない', '！');   // html の div の中の <strong>（後ろに <br>）
    // インライン SVG
    const sv = slideOf(t, '>ページ表示</text>');
    const rs = await expectOneLineEdit(S, sv, 'ページ表示', '完了', { svg: true });
    assert.ok(/<text[^>]*>ページ表示完了<\/text>/.test(rs.diff.added[0]), '該当 <text> の中だけ');
    // 同じ文字「→」が5個並ぶ SVG の3個目
    const ra = await expectOneLineEdit(S, sv, '→', '▶', { svg: true, occurrence: 2, exact: true });
    assert.equal(lineOf(r.before, '>→</text>', 2), ra.diff.start, '3個目の → の行');
    noErrors(S, '3b');
  } finally { await S.close(); }
});

// 回帰：テキストノードの先頭の空白より前に打った文字が、原稿では空白の後ろに入っていた（source-map.cjs の planEdgeEdit で修正）。
// 期待：打ったとおり「…docs>X を見る」と書く（または書かずに断る）。
T('3c. 要素の直後（次のノードの先頭の空白より前）に打った文字の位置', async () => {
  const S = await session(LEC, { synth: true });
  try {
    const t = S.doc.getText();
    const si = slideOf(t, '## E2E 合成スライド');
    const r = await editText(S, si, 'example.com/docs', 'X');   // リンクの末尾にキャレット → Chrome は <a> の外（次のノードの先頭）に入れる
    const shownTyped = r.after === r.before ? null : H.lineDiff(r.before, r.after).added[0];
    assert.ok(shownTyped === null || shownTyped === '- 公式は <https://example.com/docs>X を見る', '打った位置と原稿の位置が同じ（または書かない）: ' + shownTyped);
  } finally { await S.close(); }
});

// ---------- 4. 箇条書きの追加と削除 ----------
T('4. Shift+Enter：確定＋下に箇条書き＋編集開始 → 打鍵 → Enter。空の箇条書きで Backspace', async () => {
  const S = await session(LEC);
  try {
    const t0 = S.doc.getText();
    const si = slideOf(t0, '- 「原稿＋プレビュー」のしくみを知る');
    const ln = lineOf(t0, '- 「原稿＋プレビュー」のしくみを知る');
    const shown0 = await H.slideText(S.page, si);
    const r = await editText(S, si, 'のしくみを知る', '追', { shift: true });
    assert.equal(S.undoDepth(), r.depth + 1, '文字の確定＋箇条書きの追加で WorkspaceEdit は1回');
    let d = H.lineDiff(t0, S.doc.getText());
    assert.deepEqual(d.added, ['- 「原稿＋プレビュー」のしくみを知る追', '- '].slice(0, d.added.length), JSON.stringify(d));
    assert.equal(S.doc.lineAt(ln + 1).text.trimEnd(), '-', '直下に同じ記号の空の箇条書き');
    assert.equal(S.sinceW(r.mk, 'startEdit').length, 1, 'startEdit が届く');
    let info = await H.pageInfo(S.page);
    assert.equal(info.editingTag, 'li', '新しい箇条書きの編集が始まっている');
    assert.equal((info.editingText || '').trim(), '');
    const t1 = S.doc.getText();
    await S.page.keyboard.type('新しい項目');
    await S.page.keyboard.press('Enter');
    await S.settle(Q);
    assert.equal(S.doc.lineAt(ln + 1).text, '- 新しい項目');
    d = H.lineDiff(t0, S.doc.getText());
    assert.equal(d.added.length, 2, '原稿は2行ぶんだけ変わる: ' + JSON.stringify(d));
    assert.equal(d.removed.length, 1);
    assert.equal(S.undoDepth(), r.depth + 2);
    assert.deepEqual(failed(S, r.mk), []);
    assert.ok(!/ずれました/.test((await H.pageInfo(S.page)).toast));
    await undoFromPreview(S);
    assert.equal(S.doc.getText(), t1, 'undo 1回目：2つ目の操作だけ戻る');
    await undoFromPreview(S);
    assert.equal(S.doc.getText(), t0, 'undo 2回目：完全に元へ戻る');
    assert.equal(await H.slideText(S.page, si), shown0);

    // 空の箇条書きで Backspace → その行が消える
    const r2 = await editText(S, si, 'のしくみを知る', '', { shift: true });
    assert.equal(S.doc.lineAt(ln + 1).text.trimEnd(), '-');
    assert.equal((await H.pageInfo(S.page)).editingTag, 'li');
    const mk = S.mark();
    await S.page.keyboard.press('Backspace');
    await S.settle(Q);
    assert.equal(S.sinceE(mk, 'bulletDelete').length, 1);
    assert.equal(S.doc.getText(), t0, '空の箇条書きが消えて元の原稿と同じ');
    assert.equal((await H.pageInfo(S.page)).editingTag, null);
    assert.equal(await H.slideText(S.page, si), shown0);
    assert.deepEqual(failed(S, r2.mk), []);
    noErrors(S, '4');
  } finally { await S.close(); }
});

// ---------- 5. 書けない編集 ----------
T('5. 書けない編集：自動リンク・インラインコード・コードブロック・改行の混入', async () => {
  const S = await session(LEC, { synth: true });
  try {
    const t = S.doc.getText();
    const si = slideOf(t, '## E2E 合成スライド');
    const a = await expectRefused(S, si, 'example.com/docs', 'X', { caretSub: 'example' });
    assert.ok(a.bad.length && /リンク/.test(a.bad[0].message), '自動リンク: ' + JSON.stringify(a.bad));
    // インラインコード：区切り記号（`）に触れる編集は断る。触れない編集は書ける（lib/source-map.cjs の方針）
    const b = await expectRefused(S, si, 'dig example.com', '`', { caretSub: 'dig' });
    assert.ok(b.bad.length && /コード/.test(b.bad[0].message), 'インラインコード: ' + JSON.stringify(b.bad));
    await expectOneLineEdit(S, si, 'dig example.com', 'X', { caretSub: 'dig', expectLine: (l) => l.replace('`dig ', '`digX '), shownSub: 'digX example.com' });
    // コードブロック（pre）は編集の入口で断る：ダブルクリックしても編集が始まらず、打鍵しても原稿は変わらない
    {
      const pt = await H.textPoint(S.page, si, 'answer');
      await H.dbl(S.page, pt);
      assert.equal((await H.pageInfo(S.page)).editingTag, null, 'pre の中では編集が始まらない');
      await S.page.keyboard.type('X'); await S.page.keyboard.press('Enter'); await S.settle(Q);
      assert.equal(S.doc.getText(), t);
    }
    // 改行の混入（貼り付け以外の経路を想定して insertText で直接入れる）
    const c = await expectRefused(S, si, '後半の文', '一行目\n二行目', { raw: true });
    assert.ok(!c.bad.length || /改行|書き戻せません|確定できません/.test(c.bad[0].message), JSON.stringify(c.bad));
    // 案内：原稿側の該当行が選択される
    assert.equal(S.editor.selection.start.line, lineOf(t, '- 前半**太字の語**後半の文'));
    noErrors(S, '5');
  } finally { await S.close(); }
});

T('5b. 改行入りの貼り付けは1行にして入る（paste）', async () => {
  const S = await session(LEC);
  try {
    const t = S.doc.getText();
    const si = slideOf(t, '- 実際にテストを行ってみる');
    await expectOneLineEdit(S, si, '実際にテストを行ってみる', '', {
      beforeKey: () => S.page.evaluate(() => {
        const dt = new DataTransfer(); dt.setData('text/plain', 'Ａ\n  Ｂ');
        document.querySelector('.ss-editing').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }),
      expectLine: (old) => old + 'Ａ Ｂ',
    }).catch((e) => { throw e; });
  } finally { await S.close(); }
});

// ---------- 6. version 不一致 ----------
T('6. 編集中に原稿が先に変わった（version 不一致）→ 書かれない', async () => {
  const S = await session(LEC);
  try {
    const t = S.doc.getText();
    const si = slideOf(t, '- 実際にテストを行ってみる');
    let typed;
    const r = await editText(S, si, '実際にテストを行ってみる', '！', {
      beforeKey: async () => { typed = S.doc.getText().replace('今日のテーマは', '本日のテーマは'); assert.notEqual(typed, t); S.typeInDoc(typed); },
    });
    assert.equal(r.after, typed, 'プレビューの編集は書かれない（原稿側の打鍵だけが残る）');
    const bad = failed(S, r.mk);
    assert.equal(bad.length, 1);
    assert.match(bad[0].message, /原稿が先に変わりました/);
    await H.sleep(900); await S.settle(Q);
    assert.ok(!(await H.slideText(S.page, si)).includes('行ってみる！'), '表示に打った文字が残らない');
    noErrors(S, '6');
  } finally { await S.close(); }
});

// ---------- 7. スライド操作 ----------
T('7. スライド操作：複製・上へ・下へ・削除（キャンセル／削除）・新規', async () => {
  const S = await session(LEC);
  try {
    const t0 = S.doc.getText();
    const n = H.marpRender(t0).slides;
    const i = slideOf(t0, '<div class="page-title">こんな「面倒」</div>');
    const titleOf = (k) => S.page.evaluate((k) => {
      const f = document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[k];
      const p = f && f.querySelector('.page-title'); return p ? p.textContent : null;
    }, k);
    const check = async (label, count, cur, title) => {
      const info = await H.pageInfo(S.page);
      assert.equal(H.marpRender(S.doc.getText()).slides, count, label + ': marp-core の枚数');
      assert.equal(info.slides, count, label + ': プレビューの枚数');
      assert.equal(info.current, cur, label + ': 青枠の位置');
      assert.equal(info.badge, `Slide ${cur + 1}/${count}`, label + ': バッジ');
      if (title !== undefined) assert.equal(await titleOf(cur), title, label + ': 青枠のスライドの中身');
      assert.equal(slideOfLine(S.doc.getText(), S.editor.selection.active.line), cur, label + ': 原稿のカーソル');
    };
    await moveCursor(S, lineOf(t0, '<div class="page-title">こんな「面倒」</div>'));
    await check('移動', n, i, 'こんな「面倒」');

    // 上へ・下へ（複製より先に試す。同じ中身の2枚を入れ替えても原稿は変わらないため）
    let depth = S.undoDepth();
    await clickOp(S, 'moveUp');
    await check('上へ', n, i - 1, 'こんな「面倒」');
    assert.equal(S.undoDepth(), ++depth);
    await clickOp(S, 'moveDown');
    await check('下へ', n, i, 'こんな「面倒」');
    assert.equal(S.undoDepth(), ++depth);
    assert.equal(S.doc.getText(), t0, '上へ→下へで元の原稿と同じ');

    await clickOp(S, 'duplicate');
    await check('複製', n + 1, i + 1, 'こんな「面倒」');
    assert.equal(await titleOf(i), 'こんな「面倒」');
    assert.equal(S.undoDepth(), ++depth);

    const tDup = S.doc.getText();
    S.answers.message.push(undefined);                       // 確認をキャンセル
    await clickOp(S, 'delete');
    assert.equal(S.doc.getText(), tDup, 'キャンセルなら何も変わらない');
    assert.match(S.asked.message.at(-1).message, new RegExp(`スライド ${i + 2} を削除`));
    S.answers.message.push('削除');
    await clickOp(S, 'delete');
    assert.equal(S.undoDepth(), ++depth);
    assert.equal(H.marpRender(S.doc.getText()).slides, n);
    assert.equal(S.doc.getText(), t0, '複製→削除で元の原稿と同じ');
    const info = await H.pageInfo(S.page);
    assert.equal(info.slides, n);
    assert.ok(info.current === i + 1 || info.current === i, '削除後の青枠は隣のスライド: ' + info.current);
    assert.equal(slideOfLine(S.doc.getText(), S.editor.selection.active.line), info.current, '青枠と原稿のカーソルが同じスライド');

    // 新規（型を選ぶ）
    await moveCursor(S, lineOf(t0, '<div class="page-title">こんな「面倒」</div>'));
    S.answers.quickPick.push((items) => items.find(x => /message/i.test(x.label + ' ' + (x.description || ''))) || items[1]);
    await clickOp(S, 'new');
    assert.equal(S.asked.quickPick.length, 1);
    assert.ok(S.asked.quickPick[0].items.length >= 5, '型が出る');
    await check('新規', n + 1, i + 1);
    assert.equal(await titleOf(i), 'こんな「面倒」');
    assert.equal(S.undoDepth(), ++depth);
    S.answers.quickPick.push(undefined);                     // 型の選択をキャンセル
    const tNew = S.doc.getText();
    await clickOp(S, 'new');
    assert.equal(S.doc.getText(), tNew);
    await undoFromPreview(S);
    assert.equal(S.doc.getText(), t0);
    assert.deepEqual(failed(S, { w: 0 }), []);
    noErrors(S, '7');
  } finally { await S.close(); }
});

T('7b. 端のスライド：1枚目を上へ・最後を下へは断る（原稿は変わらない）', async () => {
  const S = await session(LEC);
  try {
    const t0 = S.doc.getText();
    let mk = S.mark();
    await clickOp(S, 'moveUp');
    assert.equal(S.doc.getText(), t0);
    assert.equal(failed(S, mk).length, 1, '断った理由が届く');
    const n = (await H.pageInfo(S.page)).slides;
    await moveCursor(S, S.doc.lineCount - 1);
    assert.equal((await H.pageInfo(S.page)).current, n - 1);
    mk = S.mark();
    await clickOp(S, 'moveDown');
    assert.equal(S.doc.getText(), t0);
    assert.equal(failed(S, mk).length, 1);
    noErrors(S, '7b');
  } finally { await S.close(); }
});

T('7c. 編集中（未確定）に複製ボタン：文字が確定してから複製される', async () => {
  const S = await session(LEC);
  try {
    const t0 = S.doc.getText();
    const n = H.marpRender(t0).slides;
    const ln = lineOf(t0, '- 実際にテストを行ってみる'), si = slideOfLine(t0, ln);
    await moveCursor(S, SPLIT.slideStartLines(t0)[si]);
    const pt = await H.textPoint(S.page, si, '実際にテストを行ってみる');
    await H.dbl(S.page, pt); await H.caretAt(S.page, '実際にテストを行ってみる', 'after');
    await S.page.keyboard.type('★');
    const mk = S.mark();
    await clickOp(S, 'duplicate');
    assert.deepEqual(S.sinceE(mk).filter(m => m.type === 'editCommit' || m.type === 'slideOp').map(m => m.type), ['editCommit', 'slideOp']);
    assert.deepEqual(failed(S, mk), []);
    const t1 = S.doc.getText();
    assert.equal(H.marpRender(t1).slides, n + 1);
    assert.equal(t1.split('- 実際にテストを行ってみる★').length - 1, 2, '確定した文字ごと複製される');
    assert.equal(S.undoDepth(), 2);
    assert.equal((await H.pageInfo(S.page)).current, si + 1);
    noErrors(S, '7c');
  } finally { await S.close(); }
});

T('7d. プレビューを開かずにコマンドで複製・削除（カーソルのあるスライドが対象）', async () => {
  const S = await session(LEC, { session: { open: false } });
  try {
    const t0 = S.doc.getText();
    const n = H.marpRender(t0).slides;
    const ln = lineOf(t0, '<div class="page-title">こんな「面倒」</div>');
    await moveCursor(S, ln);
    await S.exec('marpScrollSync.duplicateSlide'); await S.settle(Q);
    assert.equal(H.marpRender(S.doc.getText()).slides, n + 1);
    assert.equal(S.doc.getText().split('<div class="page-title">こんな「面倒」</div>').length - 1, 2);
    S.answers.message.push('削除');
    await S.exec('marpScrollSync.deleteSlide'); await S.settle(Q);
    assert.equal(S.doc.getText(), t0);
    assert.equal(S.panels.length, 0);
    assert.deepEqual(S.extErrors, []);
  } finally { await S.close(); }
});

// ---------- 8. 9. 印とライブラリ ----------
T('8. 9. 印（★）→ 別テーマ・別配色のデックへ libraryInsert', async () => {
  const repo = freshRepo([LEC, DEST, LAY]);
  let S = await session(LEC, { repo });
  const today = new Date();
  try {
    const t0 = S.doc.getText();
    const comments0 = H.marpRender(t0).comments;
    const html0 = H.marpRender(t0).html;
    const ln = lineOf(t0, '<div class="page-title">開始の前に</div>');
    const i = slideOfLine(t0, ln);
    await moveCursor(S, ln);
    S.answers.inputBox.push('e2e-lec-prep', '準備, slido');
    await clickOp(S, 'mark');
    assert.equal(S.asked.inputBox.length, 2, 'id とタグを聞く');
    const t1 = S.doc.getText();
    const d = H.lineDiff(t0, t1);
    assert.equal(d.removed.length, 1); assert.equal(d.removed[0], '<!-- _class: summary -->');
    const block = d.added.join('\n');
    assert.match(block, /^<!--\n_class: summary\n_lib: e2e-lec-prep \| 準備, slido \| \d{4}-\d{2}-\d{2}\n-->$/, '_class と同じコメントに _lib が同居: ' + block);
    const r1 = H.marpRender(t1);
    assert.deepEqual(r1.comments, comments0, '発表者ノートが増えない');
    assert.equal(r1.html, html0, 'marp-core の HTML が変わらない');
    let info = await H.pageInfo(S.page);
    assert.equal(info.stars, 1, 'プレビューの ★ が点く'); assert.ok(info.markOn);
    assert.equal(info.current, i);
    assert.equal(S.undoDepth(), 1);

    // もう一度で外れる
    await clickOp(S, 'mark');
    info = await H.pageInfo(S.page);
    assert.equal(info.stars, 0); assert.ok(!info.markOn);
    assert.deepEqual(H.marpRender(S.doc.getText()).comments, comments0);
    assert.equal(H.marpRender(S.doc.getText()).html, html0);
    assert.ok(!/_lib/.test(S.doc.getText()));

    // 付け直して保存（台帳はディスクの原稿から作られる）
    S.answers.inputBox.push('e2e-lec-prep', '準備, slido');
    await clickOp(S, 'mark');
    assert.match(S.doc.getText(), /_lib: e2e-lec-prep/);
    // 保存前：ギャラリーに出るか（未保存の印の扱い）。📚 は検索つきのギャラリー（8章）。「★ 完成だけ」で絞って確かめる
    await H.sleep(1800);   // 原稿を触ってから索引へ映るまで（corpus-vscode の DIRTY_MS＝1.5 秒）
    await clickOp(S, 'library');
    const unsavedIds = await markedKeys(S);
    await S.page.keyboard.press('Escape');
    await S.doc.save();
    noErrors(S, '8');
    S.unsavedIds = unsavedIds;
  } finally { await S.close(); }
  const unsavedIds = S.unsavedIds;

  // 9. 貼り付け先（別テーマ）
  S = await session(DEST, { repo });
  try {
    const t0 = S.doc.getText();
    const n = H.marpRender(t0).slides;
    await clickOp(S, 'library');
    let info = await H.pageInfo(S.page);
    assert.ok(info.galleryOpen, 'ギャラリーが開く');
    const keys = await markedKeys(S);
    assert.equal(keys.length, 1, '★ 完成だけ に絞ると 1 枚: ' + JSON.stringify(keys));
    assert.match(keys[0], new RegExp(LEC), '印を付けた LEC のスライド');
    S.answers.message.push(undefined);
    // クリック＝選択 →「ここに挿入」（8.1。全面ギャラリーではクリックで即挿入しない）
    await S.page.click('.ss-gal-grid > .ss-gal-pick[data-key="' + keys[0] + '"] .ss-gal-name');
    assert.equal(S.doc.getText(), t0, '選んだだけでは原稿は変わらない');
    await S.page.click('.ss-gal-insert');
    await S.settle(Q);
    const t1 = S.doc.getText();
    assert.equal(S.undoDepth(), 1, '挿入は WorkspaceEdit 1回');
    assert.equal(H.marpRender(t1).slides, n + 1);
    info = await H.pageInfo(S.page);
    assert.equal(info.slides, n + 1); assert.equal(info.current, 1, '入れたスライドへ青枠が移る');
    assert.ok(!info.galleryOpen);
    const deck = SPLIT.splitDeck(t1);
    const body = deck.lines.slice(deck.slides[1].startLine, deck.slides[1].endLine + 1).join('\n');
    assert.match(body, /開始の前に/); assert.match(body, /_from: e2e-lec-prep/); assert.ok(!/_lib:/.test(body), '_lib は写さない');
    const fm = t1.slice(0, t1.indexOf('\n---', 4));
    assert.match(fm, /\.sec-qr-row/, 'デック固有 CSS が frontmatter の style へ入る');
    assert.ok(!/--accent:\s*#C8611C/i.test(fm), ':root は運ばない');
    const img = /src="(\.\/src\/slido-qr[^"]*)"/.exec(body);
    assert.ok(img, '素材の参照がある');
    assert.ok(fs.existsSync(path.join(path.dirname(S.doc.uri.fsPath), img[1])), '素材が貼り付け先の src/ に入る');
    assert.ok(S.asked.message.some(m => /テーマ|theme/i.test(m.message)), 'テーマ違いの警告が出る: ' + JSON.stringify(S.asked.message.map(m => m.message)));
    assert.deepEqual(H.marpRender(t1).comments.slice(2), H.marpRender(t0).comments.slice(1), '後ろのスライドのノートはそのまま');
    await S.doc.save();   // SS_E2E_KEEP=1 のとき、この md を marp-cli で PNG にして目視する
    await undoFromPreview(S);
    assert.equal(S.doc.getText(), t0, 'undo 1回で原稿が元へ戻る');
    noErrors(S, '9');
    if (process.env.SS_E2E_KEEP) { S.typeInDoc(t1); fs.writeFileSync(S.doc.uri.fsPath, t1); }
  } finally { await S.close(); }
  unsavedGallery = unsavedIds;
});

let unsavedGallery = null;
// 回帰：印を付けた直後（未保存）は、📚 のギャラリーにそのスライドが出なかった（台帳をディスクの原稿だけから作っていた）
T('9b. 保存前の印もギャラリーに出る', async () => {
  assert.notEqual(unsavedGallery, null, '8. 9. の試験が先に走っていること');
  assert.equal(unsavedGallery.length, 1, JSON.stringify(unsavedGallery));
  assert.match(unsavedGallery[0], new RegExp(LEC));
});

T('8b. _class の無いスライドに印：見た目（marp-core の HTML）とノートが変わらない', async () => {
  const S = await session(LAY);
  try {
    const t0 = S.doc.getText();
    const deck = SPLIT.splitDeck(t0);
    const k = deck.slides.findIndex((s, idx) => idx > 0 && !/_class/.test(deck.lines.slice(s.startLine, s.endLine + 1).join('\n')));
    if (k < 0) return;   // 該当なし
    const r0 = H.marpRender(t0);
    await moveCursor(S, deck.slides[k].startLine + 1);
    S.answers.inputBox.push('e2e-lay-noclass', '');
    await clickOp(S, 'mark');
    const t1 = S.doc.getText();
    assert.match(t1, /_lib: e2e-lay-noclass/);
    const r1 = H.marpRender(t1);
    assert.equal(r1.html, r0.html, 'HTML が変わらない'); assert.deepEqual(r1.comments, r0.comments);
    assert.equal((await H.pageInfo(S.page)).stars, 1);
    await undoFromPreview(S);
    assert.equal(S.doc.getText(), t0);
    noErrors(S, '8b');
  } finally { await S.close(); }
});

// ---------- 10. tuneSelect ----------
T('10. プレビューで文字を選択 → 原稿の選択が同じ文字 → A+ で ss-tune、赤（テーマ）で var(--accent)', async () => {
  const S = await session(LEC);
  try {
    const t0 = S.doc.getText();
    const si = slideOf(t0, '- 実際にテストを行ってみる');
    const ln = lineOf(t0, '- 実際にテストを行ってみる');
    const a = await H.textPoint(S.page, si, 'テスト', { where: 'start' });
    const b = await H.textPoint(S.page, si, 'テスト', { where: 'end' });
    const mk = S.mark();
    await S.page.mouse.move(a.x, a.y); await S.page.mouse.down(); await S.page.mouse.move(b.x, b.y, { steps: 6 }); await S.page.mouse.up();
    await S.settle(Q);
    assert.equal(S.sinceE(mk, 'tuneSelect').length, 1, 'tuneSelect が届く');
    assert.equal(S.sinceE(mk, 'revealLine').length, 0, '行全体の選択で上書きされない');
    assert.equal(S.doc.getText(S.editor.selection), 'テスト', '原稿側の選択が同じ文字');
    assert.equal(S.editor.selection.start.line, ln);
    const px = S.sinceE(mk, 'tuneSelect')[0].px;
    await S.page.evaluate(() => Array.from(document.querySelectorAll('#ss-tuner button')).find(x => x.textContent === 'A+').click());
    await S.settle(Q);
    assert.equal(S.doc.lineAt(ln).text, `- 実際に<span class="ss-tune" style="font-size:${Math.round(px) + 1}px !important">テスト</span>を行ってみる`);
    await S.page.evaluate(() => document.querySelector('.ss-sw[data-c="var(--accent)"]').click());
    await S.settle(Q);
    assert.equal(S.doc.lineAt(ln).text, `- 実際に<span class="ss-tune" style="font-size:${Math.round(px) + 1}px !important; color:var(--accent) !important">テスト</span>を行ってみる`);
    assert.equal(H.lineDiff(t0, S.doc.getText()).added.length, 1);
    const color = await S.page.evaluate((i) => {
      const f = document.querySelectorAll('div.marpit > svg[data-marpit-svg]')[i];
      const e = Array.from(f.querySelectorAll('.ss-tune')).find(x => x.textContent === 'テスト'); return e ? getComputedStyle(e).color : null;
    }, si);
    assert.equal(color, 'rgb(200, 97, 28)', 'LEC の --accent（#C8611C）で描かれる');
    noErrors(S, '10');
  } finally { await S.close(); }
});

// ---------- 11. 退行 ----------
T('11. 退行：単クリック逆引き・j/k/↑↓ のスライド送り・原稿を打って 150ms 後の再描画', async () => {
  const S = await session(LEC);
  try {
    const t0 = S.doc.getText();
    const si = slideOf(t0, '- 実際にテストを行ってみる');
    const ln = lineOf(t0, '- 実際にテストを行ってみる');
    await moveCursor(S, SPLIT.slideStartLines(t0)[si]);
    let mk = S.mark();
    const pt = await H.textPoint(S.page, si, '実際にテストを行ってみる');
    await S.page.mouse.click(pt.x, pt.y);
    await S.settle(Q);
    const rv = S.sinceE(mk, 'revealLine');
    assert.equal(rv.length, 1); assert.equal(rv[0].line, ln);
    assert.equal(S.editor.selection.start.line, ln); assert.equal(S.doc.getText(S.editor.selection), '- 実際にテストを行ってみる');
    assert.equal(S.focus.at(-1).preserveFocus, false, '原稿へフォーカスを渡す');
    assert.equal(S.doc.getText(), t0);

    const starts = SPLIT.slideStartLines(t0);
    for (const [key, d] of [['j', +1], ['ArrowDown', +1], ['k', -1], ['ArrowUp', -1], ['PageDown', +1]]) {
      const cur = (await H.pageInfo(S.page)).current;
      mk = S.mark();
      await S.page.evaluate(() => { window.getSelection().removeAllRanges(); });
      await S.page.keyboard.press(key);
      await S.settle(Q);
      const g = S.sinceE(mk, 'gotoSlide');
      assert.equal(g.length, 1, key + ': gotoSlide が1回'); assert.equal(g[0].index, cur + d);
      assert.equal((await H.pageInfo(S.page)).current, cur + d);
      assert.equal(S.editor.selection.active.line, starts[cur + d], key + ': 原稿のカーソルがスライド先頭へ');
      assert.equal(S.sinceW(mk, 'scrollToSlide').length, 0, key + ': プレビューを押し戻さない');
    }

    // 原稿を打つ → すぐには描き直さず、150ms 後に1回（8.4 で 700ms → 150ms）
    mk = S.mark();
    S.typeInDoc(t0.replace('- 実際にテストを行ってみる', '- 実際にテストを行ってみる（打鍵）'));
    await H.sleep(60);
    assert.equal(redraws(S, mk).length, 0, '60ms ではまだ描き直さない（デバウンス 150ms）');
    await S.waitFor(() => redraws(S, mk).length === 1, '150ms 後の再描画', 1500);
    await S.settle(Q);
    assert.equal(redraws(S, mk).length, 1);
    assert.equal(redraws(S, mk)[0].type, 'patch', '枚数が同じなら patch（変わったスライドだけ）');
    assert.deepEqual(redraws(S, mk)[0].slides.map(x => x.index), [si]);
    assert.ok((await H.slideText(S.page, si)).includes('（打鍵）'));
    assert.equal(S.loads, 1, 'ページは読み込み直さない（patch / render メッセージで差し替え）');
    noErrors(S, '11');
  } finally { await S.close(); }
});

// ---------- 12. 故障注入 ----------
for (const [label, re] of [['source-map', /source-map\.cjs$/], ['slide-ops', /slide-ops\.cjs$/], ['folding-vscode', /folding-vscode\.cjs$/], ['library-vscode', /library-vscode\.cjs$/], ['library-core', /library-core\.cjs$/]]) {
  T(`12. 故障注入：lib/${label} を読み込めなくても、プレビューが開き、逆引きと再描画が動く`, async () => {
    const S = await session(LEC, { session: { failRequire: re } });
    try {
      assert.equal(S.activateError, null, 'activate が通る: ' + (S.activateError && S.activateError.stack));
      const t0 = S.doc.getText();
      const info = await H.pageInfo(S.page);
      assert.equal(info.slides, H.marpRender(t0).slides);
      const si = slideOf(t0, '- 実際にテストを行ってみる'), ln = lineOf(t0, '- 実際にテストを行ってみる');
      await moveCursor(S, SPLIT.slideStartLines(t0)[si]);
      assert.equal((await H.pageInfo(S.page)).current, si, 'カーソル追従');
      let mk = S.mark();
      const pt = await H.textPoint(S.page, si, '実際にテストを行ってみる');
      await S.page.mouse.click(pt.x, pt.y);
      await S.settle(Q);
      assert.equal(S.editor.selection.start.line, ln, '逆引きが動く');
      mk = S.mark();
      S.typeInDoc(t0.replace('- 実際にテストを行ってみる', '- 実際にテストを行ってみる（打鍵）'));
      await S.waitFor(() => redraws(S, mk).length === 1, '再描画', 2000);
      await S.settle(Q);
      assert.ok((await H.slideText(S.page, si)).includes('（打鍵）'));
      assert.deepEqual(S.consoleErrors, []);

      // 落ちた部品に頼る操作は、原稿を変えずに断る
      const t1 = S.doc.getText();
      if (label === 'source-map') {
        const r = await editText(S, si, '（打鍵）', 'X');
        assert.equal(r.after, t1); assert.equal(failed(S, r.mk).length, 1);
        assert.equal(await H.slideText(S.page, si), r.shown, '表示が元へ戻る');
      }
      if (label === 'slide-ops') { mk = S.mark(); await clickOp(S, 'duplicate'); assert.equal(S.doc.getText(), t1); assert.equal(failed(S, mk).length, 1); }
      if (label === 'library-vscode' || label === 'library-core') { mk = S.mark(); await clickOp(S, 'mark'); assert.equal(S.doc.getText(), t1); assert.equal(failed(S, mk).length, 1); }
      if (label !== 'slide-ops') { await clickOp(S, 'duplicate'); assert.equal(H.marpRender(S.doc.getText()).slides, info.slides + 1, '他の部品は動く'); }
    } finally { await S.close(); }
  });
}
