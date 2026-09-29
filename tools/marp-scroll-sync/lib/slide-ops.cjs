// スライド単位の操作（複製・削除・移動・新規・箇条書きの追加/削除）→ 編集の計算（vscode 非依存・純粋関数）。
// DESIGN.md 2.4。どの関数も原稿を書き換えず、{ ok, edits:[{start,end,text}], revealLine } を返すだけ。
//   - offset は doc.getText() と同じ UTF-16 オフセット。edits は互いに重ならない。
//   - 改行コードは原稿に合わせる（CRLF の原稿に LF を混ぜない）。
//   - 返す前に、編集を当てた結果を slideStartLines で数え直す。期待枚数と違えば ok:false にして何も書かせない
//     （「位置が一意に確定したときだけ書く」＝DESIGN.md 0 の絶対条件。区切り --- は前の行しだいで
//      setext 見出しに化けるので、机上の計算だけを信用しない）。
'use strict';

const { slideStartLines, LIB_KEY } = require('./slide-split.cjs');

// ---------------------------------------------------------------- 共通の下ごしらえ

/** 原稿の改行コード。CRLF が1つでもあれば CRLF とみなす（VS Code の doc.eol と同じく、文書に1種類の前提） */
function detectEol(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

/**
 * 行と、その行頭のオフセットを求める。lines は slide-split と同じ split(/\r?\n/)（行番号を共有するため）。
 * offs[k] は k 行目の行頭、offs[lines.length] は text.length（EOF。最後の行に改行が無いときの挿入位置に使う）。
 */
function indexLines(text) {
  const lines = [];
  const offs = [];
  const re = /\r?\n/g;
  let pos = 0, m;
  while ((m = re.exec(text))) {
    lines.push(text.slice(pos, m.index));
    offs.push(pos);
    pos = m.index + m[0].length;
  }
  lines.push(text.slice(pos));
  offs.push(pos);
  offs.push(text.length);
  return { lines, offs };
}

/**
 * デックを「本文の並び」に分解する。
 *   bodies[i] = { start, end, contentEnd, startLine, endLine }
 *     start〜end       … 本文（区切り --- の次行の行頭から、次の区切り --- の行頭まで。最後は EOF まで）
 *     contentEnd       … 本文の最後の「空でない行」の行末（改行の手前）。ここから end までを tail と呼ぶ
 *     tail             … 行末の改行＋末尾の空行。区切り --- の前の空行はここに入る
 *   本文を content（中身）と tail（末尾の空白）に分けておくのは、最後のスライドだけ tail の事情が違うため
 *   （ファイル末尾の改行の有無は「位置」の性質、区切り前の空行は「次に --- が来る」ための性質）。
 */
function parseDeck(text) {
  const { lines, offs } = indexLines(text);
  const starts = slideStartLines(text);
  const bodies = starts.map((s, i) => {
    const last = i === starts.length - 1;
    const endLine = last ? lines.length : starts[i + 1] - 1; // 次の区切り --- の行（最後は行数）
    let L = endLine - 1;
    while (L >= s && lines[L].trim() === '') L--;
    const start = offs[Math.min(s, lines.length)];
    const end = last ? text.length : offs[endLine];
    const contentEnd = L >= s ? offs[L] + lines[L].length : start;
    return { start, end, contentEnd, startLine: s, endLine, lastContentLine: L >= s ? L : -1 };
  });
  return { lines, offs, starts, bodies, eol: detectEol(text) };
}

function countEols(s) {
  const m = s.match(/\r?\n/g);
  return m ? m.length : 0;
}

/**
 * content の後ろに区切り --- を置けるよう、tail を必要なだけ伸ばす。
 * 区切りの直前が空行でないと、--- は段落の setext 見出し（h2）になりページが分かれない。
 * 例外は直前の行で HTML コメントが閉じているとき（発表者ノート直後の ---）。このときは元の書き方を保つ。
 */
function tailBeforeSeparator(content, tail, eol) {
  let t = tail;
  if (!/\n$/.test(t)) t += eol;                 // --- を行頭に置くための改行
  if (countEols(t) >= 2) return t;               // 空行がある
  if (content.trim() === '') return t;           // 中身が空：tail そのものが空行なので、これ以上は足さない
  const lastLine = content.slice(content.lastIndexOf('\n') + 1);
  if (/-->\s*$/.test(lastLine)) return t;        // コメントが閉じた直後は空行が無くても区切りになる
  return t + eol;
}

/** 編集を当てる（テスト・CLI・検算用）。edits は重ならない前提。後ろから当てるので順不同でよい */
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function fail(reason, line) {
  return { ok: false, reason, edits: [], revealLine: line === undefined ? null : line };
}

/**
 * 検算してから結果を返す。枚数が期待と違えば ok:false（編集は返さない）。
 * revealOf(newStarts, newText) で、操作後にカーソルを置く行を決める。
 */
function verified(text, edits, expectedCount, revealOf, extra) {
  const after = applyEdits(text, edits);
  const newStarts = slideStartLines(after);
  if (newStarts.length !== expectedCount) {
    return fail('操作後のスライド枚数が合いません（' + newStarts.length + '枚／期待 ' + expectedCount + '枚）。原稿は変更していません。');
  }
  return Object.assign({ ok: true, edits, revealLine: revealOf(newStarts, after) }, extra || {});
}

/** 候補（編集を作る関数）を順に試し、最初に検算を通ったものを返す。全部だめなら最後の失敗を返す */
function firstVerified(thunks) {
  let res = null;
  for (const th of thunks) {
    res = th();
    if (res.ok) return res;
  }
  return res;
}

/**
 * 公開する操作の入口。原稿が文字列でない・想定外の例外、のどちらでも ok:false を返し、拡張ごと落とさない
 * （Webview からのメッセージで呼ばれるので、投げた例外はどこにも表示されずに操作だけが黙って消える）。
 */
function guarded(fn) {
  return function (text, ...rest) {
    if (typeof text !== 'string') return fail('原稿を読めませんでした');
    try {
      return fn(text, ...rest);
    } catch (e) {
      return fail('内部エラーのため原稿は変更していません（' + (e && e.message ? e.message : e) + '）');
    }
  };
}

/**
 * コードフェンスと HTML コメントの外にある行だけ true。判定は slide-split.cjs と同じ粗さに合わせる
 * （行単位。フェンスの入れ子やインデント付きコードブロックは見ない）。
 */
function plainLineFlags(lines) {
  const flags = new Array(lines.length).fill(true);
  let inFence = false, inComment = false;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k], t = line.trim();
    if (inComment) { flags[k] = false; if (/-->/.test(line)) inComment = false; continue; }
    if (inFence) { flags[k] = false; if (/^(```|~~~)/.test(t)) inFence = false; continue; }
    if (/^(```|~~~)/.test(t)) { inFence = true; flags[k] = false; continue; }
    if (/<!--/.test(line) && !/-->/.test(line.slice(line.indexOf('<!--') + 4))) { inComment = true; flags[k] = false; continue; }
  }
  return flags;
}

/**
 * marp は markdown-it の hr をすべてページ区切りにする（*** ___ - - - や、3桁までの字下げつき ---）。
 * slide-split.cjs が数えるのは行頭からの --- だけなので、こうした行があると枚数と index が marp とずれ、
 * 検算（slideStartLines）も同じ数え方なので気づけない。見つけた行番号（無ければ -1）を返し、呼び出し側で操作を断る。
 * 全コーパス 171 本で 0 件（2026-09-20 実測）。headingDivider も同じ理由で断る。
 */
function foreignSeparatorLine(lines, from) {
  const flags = plainLineFlags(lines);
  for (let k = from || 0; k < lines.length; k++) {
    if (!flags[k]) continue;
    const l = lines[k];
    if (/^---+\s*$/.test(l)) continue;                       // slide-split が数える形
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(l)) {
      // 直前が段落なら - の並びは setext 見出しの下線で、区切りではない（* と _ は段落にも割り込む）
      const prev = k > 0 ? lines[k - 1].trim() : '';
      if (/^ {0,3}-/.test(l) && prev !== '' && !/-->\s*$/.test(prev) && /^ {1,3}-+\s*$/.test(l)) continue;
      return k;
    }
  }
  return -1;
}

/**
 * 見出し・箇条書き・表の行の「直後」に空行なしで置かれた ---。段落の直後なら setext 見出しの下線だが、
 * これらの直後では markdown-it は hr にする＝marp は区切る（実測）。slide-split.cjs は「直前が空行かコメントの閉じ」
 * しか区切りに数えないので、ここでも枚数がずれる。見つけた行番号（無ければ -1）。全コーパス 171 本で 0 件。
 */
function tightSeparatorLine(lines, from) {
  const flags = plainLineFlags(lines);
  for (let k = Math.max(from || 0, 1); k < lines.length; k++) {
    if (!flags[k] || !flags[k - 1] || !/^---+\s*$/.test(lines[k])) continue;
    const prev = lines[k - 1];
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(prev) || /^ {0,3}\|/.test(prev) || parseBullet(prev)) return k;
  }
  return -1;
}

/** スライド操作をしてよい原稿か。だめなら fail を、よければ null を返す */
function refuseUnsupported(deck) {
  const fmEnd = deck.starts[0];
  for (let k = 0; k < deck.lines.length; k++) {
    if (/^\s*(?:<!--\s*)?headingDivider\s*:/.test(deck.lines[k])) {
      return fail('headingDivider を使う原稿では、スライド単位の操作に対応していません', k);
    }
  }
  const k = foreignSeparatorLine(deck.lines, fmEnd);
  if (k >= 0) return fail((k + 1) + ' 行目の区切り（' + deck.lines[k].trim() + '）は --- に直してください。枚数を正しく数えられないため、原稿は変更していません', k);
  const q = tightSeparatorLine(deck.lines, fmEnd);
  if (q >= 0) return fail((q + 1) + ' 行目の --- の前に空行を入れてください。枚数を正しく数えられないため、原稿は変更していません', q);
  return null;
}

function checkIndex(deck, index) {
  return Number.isInteger(index) && index >= 0 && index < deck.bodies.length;
}

// ---------------------------------------------------------------- _lib の印を外す

/**
 * スライド本文から「完成スライド」の印（_lib）を外す。複製・挿入したコピーに同じ id が残らないようにする。
 *   <!--                         <!-- _class: summary -->
 *   _class: summary        →
 *   _lib: id | タグ | 日付
 *   -->
 * コメントに _class だけが残ったら1行形式へ戻す。_class の値が空（印のためだけに足した行）ならコメントごと消す。
 * 他のキー（_paginate など）が残るときは複数行のまま _lib の行だけ消す。コードフェンスの中は触らない。
 */
function stripLibMark(slideText) {
  const parts = slideText.split(/(\r?\n)/); // 偶数番=行、奇数番=改行。改行を1バイトも変えないため分けて持つ
  const lines = [], eols = [];
  for (let i = 0; i < parts.length; i += 2) { lines.push(parts[i]); eols.push(parts[i + 1] || ''); }
  const libLine = new RegExp('^\\s*' + LIB_KEY + '\\s*:');
  const out = []; // { text, eol } | null（消す行）
  let inFence = false;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k], t = line.trim();
    if (inFence) { if (/^(```|~~~)/.test(t)) inFence = false; out.push({ text: line, eol: eols[k] }); continue; }
    if (/^(```|~~~)/.test(t)) { inFence = true; out.push({ text: line, eol: eols[k] }); continue; }
    // 1行で完結する <!-- _lib: … -->（単独の印。ノートに混入する書き方だが、あれば行ごと外す）
    if (new RegExp('^<!--\\s*' + LIB_KEY + '\\s*:[\\s\\S]*-->$').test(t)) { out.push(null); continue; }
    // 複数行コメントの開始（その行で閉じない）
    if (/^<!--/.test(t) && !/-->/.test(line.slice(line.indexOf('<!--') + 4))) {
      let e = k + 1;
      while (e < lines.length && !/-->/.test(lines[e])) e++;
      if (e >= lines.length) { out.push({ text: line, eol: eols[k] }); continue; } // 閉じていない：触らない
      const inner = lines.slice(k, e + 1);
      if (!inner.some((l, n) => libLine.test(n === 0 ? l.replace(/^\s*<!--\s*/, '') : l))) {
        for (let n = k; n <= e; n++) out.push({ text: lines[n], eol: eols[n] });
        k = e; continue;
      }
      // コメントの中身（<!-- と --> を除いた行）を取り出し、_lib の行を落とす
      const first = lines[k].replace(/^\s*<!--/, ''), lastRaw = lines[e];
      const bodyLines = [first, ...lines.slice(k + 1, e), lastRaw.replace(/-->\s*$/, '')];
      // ディレクティブのコメントは全行が「キー: 値」。地の文が混じるなら発表者ノートなので、_lib: で始まる行があっても触らない
      if (bodyLines.some(l => l.trim() !== '' && !/^\s*[A-Za-z_$][\w$-]*\s*:/.test(l))) {
        for (let n = k; n <= e; n++) out.push({ text: lines[n], eol: eols[n] });
        k = e; continue;
      }
      const kept = bodyLines.filter(l => l.trim() !== '' && !libLine.test(l));
      const indent = (lines[k].match(/^\s*/) || [''])[0];
      const onlyClass = kept.length === 1 && kept[0].match(/^\s*_class\s*:\s*(.*?)\s*$/);
      if (kept.length === 0 || (onlyClass && onlyClass[1].replace(/^["']|["']$/g, '') === '')) {
        for (let n = k; n <= e; n++) out.push(null);
      } else if (onlyClass) {
        out.push({ text: indent + '<!-- _class: ' + onlyClass[1] + ' -->', eol: eols[e] });
      } else {
        // 他のキーが残る：_lib の行だけ消して複数行のまま
        for (let n = k; n <= e; n++) {
          const probe = n === k ? lines[n].replace(/^\s*<!--\s*/, '') : lines[n];
          if (libLine.test(probe) && n !== k && n !== e) out.push(null);
          else if (libLine.test(probe)) {
            // <!-- や --> と同じ行に _lib がある珍しい書き方：記号だけ残す
            out.push({ text: n === k ? indent + '<!--' : '-->', eol: eols[n] });
          } else out.push({ text: lines[n], eol: eols[n] });
        }
      }
      k = e; continue;
    }
    out.push({ text: line, eol: eols[k] });
  }
  // 行を消した跡に空行が2つ並んだら1つにする（消した行の前後が空行だった場合だけ）
  const res = [];
  for (let k = 0; k < out.length; k++) {
    if (out[k] === null) {
      const prevBlank = res.length === 0 || res[res.length - 1].text.trim() === '';
      let n = k + 1;
      while (n < out.length && out[n] === null) n++;
      if (prevBlank && n < out.length && out[n].text.trim() === '' && out[n].eol) { k = n; } // 後ろの空行も1つ飲む
      else k = n - 1;
      continue;
    }
    res.push(out[k]);
  }
  return res.map(r => r.text + r.eol).join('');
}

// ---------------------------------------------------------------- スライドの挿入・複製

/** 改行コードを原稿に合わせる */
function normalizeEol(s, eol) {
  return s.replace(/\r?\n/g, eol);
}

/** 先頭と末尾の空行を落とした中身と、先頭の空行（あれば）を返す */
function splitLeading(body) {
  const m = body.match(/^(?:[ \t]*\r?\n)*/);
  return { leading: m ? m[0] : '', rest: body.slice(m ? m[0].length : 0) };
}

/** 区切り --- の次に空行を置く書き方のデックか（既存の2枚目以降を見る。無ければ置く） */
function blankAfterSeparator(deck) {
  for (let i = 1; i < deck.bodies.length; i++) {
    const b = deck.bodies[i];
    if (b.lastContentLine < 0) continue;
    return deck.lines[b.startLine].trim() === '';
  }
  return true;
}

/**
 * index のスライドの直後に本文を差し込む編集を作る。
 *   leading … 区切り --- の次に置く空行（'' か改行）
 *   content … 中身（末尾の改行を含まない）
 *   tail    … 途中に入れるときの末尾（null なら既定＝改行＋空行）
 *   extra   … 区切りの前に足す空行（'' か改行）。1回目の検算に落ちたときの再挑戦で使う
 */
function planInsert(text, deck, index, leading, content, tail, extra) {
  const eol = deck.eol;
  const b = deck.bodies[index];
  const last = index === deck.bodies.length - 1;
  let edit;
  if (!last) {
    // 次の区切り --- の行頭に「--- ＋ 新しい本文」を入れる。前のスライドは元から区切りの前にあるので、末尾は触らない
    const t = tailBeforeSeparator(content, tail === null ? eol + eol : tail, eol);
    edit = { start: b.end, end: b.end, text: '---' + eol + leading + content + t + extra };
  } else {
    // 最後のスライドの後ろ：前のスライドの末尾に空行を確保してから --- を置く。
    // ファイル末尾の書き方（最後に改行が有る/無い）は元のまま残す
    const curTail = text.slice(b.contentEnd, b.end);
    const curContent = text.slice(b.start, b.contentEnd);
    const need = tailBeforeSeparator(curContent, curTail, eol);
    edit = { start: b.end, end: b.end, text: need.slice(curTail.length) + extra + '---' + eol + leading + content + curTail };
  }
  return edit;
}

/**
 * index のスライドの次に slideText を1枚として挿入する。slideText は区切り --- を含まない本文。
 * _lib の印は外す（DESIGN.md 2.4）。改行コードは原稿に合わせる。
 */
function insertSlideAfter(text, index, slideText) {
  const deck = parseDeck(text);
  if (!checkIndex(deck, index)) return fail('スライド番号が範囲外です');
  const refuse = refuseUnsupported(deck);
  if (refuse) return refuse;
  let body = normalizeEol(stripLibMark(String(slideText == null ? '' : slideText)), deck.eol);
  body = splitLeading(body).rest.replace(/\s+$/, '');
  // 区切りを含む本文を入れると枚数が読めなくなる。呼び出し側の誤りなので断る
  // *** ___ - - - も marp では区切りになる（slideStartLines は数えないので別に調べる）
  const bodyLines = ('\n' + body).split(/\r?\n/);
  if (slideStartLines('\n' + body).length !== 1 || foreignSeparatorLine(bodyLines, 0) >= 0 || tightSeparatorLine(bodyLines, 0) >= 0) {
    return fail('挿入する本文にスライド区切り（--- など）が含まれています');
  }
  const leading = blankAfterSeparator(deck) ? deck.eol : '';
  // 1回目は元の書き方を保つ最小の空行で。検算に落ちたら（例：最後のスライドが「… -->」という地の文で終わる、
  // frontmatter の閉じ --- で原稿が終わっている）区切りの前に空行を1つ足してもう一度
  return firstVerified(['', deck.eol].map(extra => () => verified(
    text, [planInsert(text, deck, index, leading, body, null, extra)], deck.bodies.length + 1,
    (st, after) => firstContentLine(st, index + 1, after))));
}

/** index のスライドを複製して直後に置く。空行の入れ方は元のスライドのまま。_lib の印はコピー側だけ外す */
function duplicateSlide(text, index) {
  const deck = parseDeck(text);
  if (!checkIndex(deck, index)) return fail('スライド番号が範囲外です');
  const refuse = refuseUnsupported(deck);
  if (refuse) return refuse;
  const b = deck.bodies[index];
  const last = index === deck.bodies.length - 1;
  const raw = text.slice(b.start, b.contentEnd);
  const { leading, rest } = splitLeading(raw);
  const content = stripLibMark(rest);
  // 1枚目は frontmatter 直後に空行が無い書き方もある。そのときは他のスライドの流儀に合わせる
  const lead = index === 0 && leading === '' ? (blankAfterSeparator(deck) ? deck.eol : '') : leading;
  const tail = last ? null : text.slice(b.contentEnd, b.end);
  return firstVerified(['', deck.eol].map(extra => () => verified(
    text, [planInsert(text, deck, index, lead, content, tail, extra)], deck.bodies.length + 1,
    (st, after) => firstContentLine(st, index + 1, after))));
}

/** 操作後のスライド idx の「最初の空でない行」（無ければ開始行）。カーソルの置き場所 */
function firstContentLine(newStarts, idx, after) {
  const lines = after.split(/\r?\n/);
  const s = newStarts[Math.min(idx, newStarts.length - 1)];
  const e = newStarts[idx + 1] !== undefined ? newStarts[idx + 1] - 1 : lines.length;
  for (let k = s; k < e; k++) if (lines[k].trim() !== '') return k;
  return Math.min(s, lines.length - 1);
}

// ---------------------------------------------------------------- 削除・移動

/** index のスライドを消す。1枚しかないデックでは断る（frontmatter だけの原稿にしない） */
function deleteSlide(text, index) {
  const deck = parseDeck(text);
  if (!checkIndex(deck, index)) return fail('スライド番号が範囲外です');
  const n = deck.bodies.length;
  if (n <= 1) return fail('スライドが1枚しかないので削除できません');
  const refuse = refuseUnsupported(deck);
  if (refuse) return refuse;
  const b = deck.bodies[index];
  let edit;
  if (index === 0) {
    // 1枚目：本文と、2枚目の前の区切り --- を消す。2枚目の本文が frontmatter の直後に来る
    edit = { start: b.start, end: deck.bodies[1].start, text: '' };
  } else if (index === n - 1) {
    // 最後：前のスライドの中身の終わりから、このスライドの中身の終わりまで。ファイル末尾の書き方は残る
    edit = { start: deck.bodies[index - 1].contentEnd, end: b.contentEnd, text: '' };
  } else {
    // 途中：このスライドの前の区切り --- の行頭から、次の区切り --- の行頭まで
    edit = { start: deck.offs[b.startLine - 1], end: b.end, text: '' };
  }
  const target = Math.min(index, n - 2);
  return verified(text, [edit], n - 1, (st, after) => firstContentLine(st, target, after));
}

/**
 * 最後のスライドと入れ替えるとき、途中へ入る本文（content）の後ろに置く末尾を決める。
 * 基本は相手が持っていた末尾（tail）を引き継ぎ、区切りの前の空行が足りなければ足す。
 * ただし「ノート --> の直後に空行なしで ---」と書くデックでは、ノートで終わる本文が途中へ戻るときに
 * 空行なしへ戻す。こうしないと「上へ→下へ」で空行が1つ増えたままになる
 * （最後の位置には区切りが無いので、元が空行なしだったかどうかは原稿に残らない。他のスライドの書き方から決める）。
 * 判断材料が無い（ノートで終わるスライドが他に無い）ときは空行を残す＝安全側。
 */
function tailForLastSwap(text, deck, ai, bi, content, tail) {
  const eol = deck.eol;
  const t = tailBeforeSeparator(content, tail, eol);
  if (t !== eol + eol || !endsWithCommentClose(content)) return t;
  let tight = 0, loose = 0;
  deck.bodies.forEach((b, i) => {
    if (i === ai || i === bi || i === deck.bodies.length - 1) return;
    if (!endsWithCommentClose(text.slice(b.start, b.contentEnd))) return;
    if (countEols(text.slice(b.contentEnd, b.end)) >= 2) loose++; else tight++;
  });
  return tight > loose ? eol : t;
}

function endsWithCommentClose(content) {
  return /-->[ \t]*$/.test(content);
}

/**
 * index のスライドを delta（-1=上へ / +1=下へ）だけ動かす。隣と本文を入れ替え、区切り --- の行は動かさない。
 * 本文は末尾の空行ごと運ぶ（「ノート直後に ---」のように空行を置かない書き方を保つため）。
 * ただし最後のスライドが絡むときは、末尾の空白は位置に残す（ファイル末尾の改行の有無を変えない）。
 * こうしておくと「上へ→下へ」で元の原稿と完全に一致する。
 */
function moveSlide(text, index, delta) {
  const deck = parseDeck(text);
  if (!checkIndex(deck, index)) return fail('スライド番号が範囲外です');
  if (delta !== 1 && delta !== -1) return fail('移動量は ±1 だけです');
  const to = index + delta;
  if (to < 0 || to >= deck.bodies.length) return fail(delta < 0 ? 'これより上へは動かせません' : 'これより下へは動かせません');
  const refuse = refuseUnsupported(deck);
  if (refuse) return refuse;
  const ai = Math.min(index, to), bi = ai + 1;
  const A = deck.bodies[ai], B = deck.bodies[bi];
  const sep = text.slice(A.end, B.start); // 区切り --- の行（改行込み）
  // extra：検算に落ちたときだけ、途中へ入る本文の後ろに空行を1つ足してやり直す
  // （最後のスライドが「… -->」という地の文で終わっていると、コメントの閉じと見分けがつかず空行を省いてしまう）
  const plan = (extra) => {
    let newA, newB;
    if (bi === deck.bodies.length - 1) {
      const cA = text.slice(A.start, A.contentEnd), tA = text.slice(A.contentEnd, A.end);
      const cB = text.slice(B.start, B.contentEnd), tB = text.slice(B.contentEnd, B.end);
      newA = cB + tailForLastSwap(text, deck, ai, bi, cB, tA) + extra;
      newB = cA + tB;
    } else {
      newA = text.slice(B.start, B.end) + extra;
      newB = text.slice(A.start, A.end);
    }
    return [{ start: A.start, end: B.end, text: newA + sep + newB }];
  };
  return firstVerified(['', deck.eol].map(extra => () => verified(
    text, plan(extra), deck.bodies.length, (st, after) => firstContentLine(st, to, after))));
}

// ---------------------------------------------------------------- 新規スライドの骨格

/**
 * 新規スライドの最小骨格。theme/academic.css に実在するクラスだけを使う
 * （page-title / fig-area / placeholder / caption / takeaway / split-body / left / right / chapter-num と
 *   section.fig / split / message / divider）。部品テーマ（非同梱）・tsutawaru-academic は academic を @import するので、どのテーマでも崩れない。
 * 箇条書きは3点（1枚で見比べるのは3つまで＝CLAUDE.md）。text は区切り --- を含まず、改行は LF。
 */
function newSlideTemplates() {
  const T = (id, label, description, rows) => ({ id, label, description, text: rows.join('\n') + '\n' });
  return [
    T('blank', '空白', 'ページタイトルと見出しだけ', [
      '<div class="page-title">ページタイトル</div>',
      '',
      '## 見出し',
    ]),
    T('bullets', '見出し＋箇条書き', '見出しと箇条書き3点、下に要点帯', [
      '<div class="page-title">ページタイトル</div>',
      '',
      '## 見出し',
      '',
      '- 要点1',
      '- 要点2',
      '- 要点3',
      '',
      '<div class="takeaway">要点メッセージ</div>',
    ]),
    T('split', '左右分割（左に文・右に図）', '左に箇条書き、右に図。説明する順に左から右へ', [
      '<!-- _class: split -->',
      '',
      '<div class="page-title">ページタイトル</div>',
      '',
      '## 見出し',
      '',
      '<div class="split-body">',
      '<div class="left">',
      '',
      '- 要点1',
      '- 要点2',
      '- 要点3',
      '',
      '</div>',
      '<div class="right">',
      '',
      '<div class="placeholder">[ここに図]</div>',
      '',
      '</div>',
      '</div>',
      '',
      '<div class="takeaway">要点メッセージ</div>',
    ]),
    T('fig', '図表中心', '図を主役にして、下に要点帯', [
      '<!-- _class: fig -->',
      '',
      '<div class="page-title">ページタイトル</div>',
      '',
      '## 見出し',
      '',
      '<div class="fig-area"><div class="placeholder">[ここに図]</div></div>',
      '',
      '<div class="caption">図1. キャプション</div>',
      '',
      '<div class="takeaway">要点メッセージ</div>',
    ]),
    T('message', 'メッセージ', '1つのメッセージを大きく見せる', [
      '<!-- _class: message -->',
      '',
      '# 中心メッセージ',
      '',
      '## サブメッセージ',
    ]),
    T('divider', '章扉', '章の区切り', [
      '<!-- _class: divider -->',
      '',
      '<div class="chapter-num">CHAPTER 1</div>',
      '',
      '# 章タイトル',
      '',
      '## 章の一言サマリ',
    ]),
  ];
}

// ---------------------------------------------------------------- 箇条書きの追加・削除

/**
 * 箇条書きの行を読む。引用（>）の中の箇条書きも、接頭部ごとインデントとして扱う。
 *   indent … 記号の前（空白と >）  marker … - * + か 1. 1)  num/delim … 番号付きのとき
 *   task   … タスクリスト（- [ ]）か
 */
function parseBullet(line) {
  const m = line.match(/^([ \t>]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+|$)(\[[ xX]\][ \t]+)?/);
  if (!m) return null;
  return {
    indent: m[1],
    bullet: m[2] || null,
    num: m[3] !== undefined ? parseInt(m[3], 10) : null,
    numStr: m[3] !== undefined ? m[3] : null,
    delim: m[4] || null,
    space: m[5] && m[5] !== '' ? m[5] : ' ',
    task: !!m[6],
  };
}

/** 同じリストの兄弟か（インデントと記号の種類が同じ。CommonMark では記号が違えば別のリスト） */
function isSibling(a, b) {
  if (!a || !b || a.indent !== b.indent) return false;
  return a.bullet !== null ? a.bullet === b.bullet : (b.num !== null && a.delim === b.delim);
}

function indentWidth(s) {
  return s.replace(/\t/g, '    ').length;
}

/**
 * その行のブロック HTML タグの収支（開始 − 終了）。字下げした <div>…</div> で箇条書きを囲む原稿の守りに使う。
 * markdown-it は「空行＋字下げ2桁以上の </div>」を li の中身とみなすので、data-line-end や兄弟探しを鵜呑みにすると
 * 隣のパネルの箇条書きまで同じリスト扱いになり、</div> と <div class="right"> を一緒に消してしまう（実測）。
 * 1行で開いて閉じる <div>…</div>（項目の補足に使う書き方。コーパスに実例あり）は収支 0 なので項目の一部のまま。
 */
const BLOCK_TAGS = 'div|section|article|aside|header|footer|nav|main|figure|table|ul|ol|blockquote|details';
// 段落の続き（lazy continuation）になれない行頭：ブロックの HTML・コメント・見出し・引用・表・フェンス。<img> <span> などインラインのタグは続きになる
const NOT_LAZY = new RegExp('^[ \\t]*(?:</?(?:' + BLOCK_TAGS + '|p|h[1-6]|style|script|svg|pre|hr)\\b|<!--|#{1,6}[ \\t]|>|\\||```|~~~)', 'i');
function htmlBalance(line) {
  const opens = line.match(new RegExp('<(?:' + BLOCK_TAGS + ')\\b[^>]*>', 'gi')) || [];
  const closes = line.match(new RegExp('</(?:' + BLOCK_TAGS + ')\\s*>', 'gi')) || [];
  return opens.filter(t => !/\/>$/.test(t)).length - closes.length;
}

/**
 * line の項目の前にある兄弟の行番号（無ければ -1）。より深い行（前の兄弟の子・続き）と空行は飛ばす。
 * 途中に「閉じていない開始タグ」（別のパネルの始まり）があれば、そこでリストは切れているとみなす。
 * 判定を誤っても害が小さい側へ倒す：兄弟を見落とせば「最後の1項目は消せません」と断るだけで、原稿は壊さない。
 */
function prevSiblingLine(lines, line, cur) {
  let bal = 0;
  for (let k = line - 1; k >= 0; k--) {
    if (lines[k].trim() === '') continue;
    const p = parseBullet(lines[k]);
    if (isSibling(cur, p)) return k;
    const ind = (lines[k].match(/^[ \t>]*/) || [''])[0];
    if (indentWidth(ind) > indentWidth(cur.indent)) {
      bal += htmlBalance(lines[k]);
      if (bal > 0) return -1;
      continue;
    }
    // 字下げなしで前の項目の段落に続く行（lazy continuation。例：「- 項目」の次の行に「→ 補足」）。
    // 直前の行が空行でなく、ブロックを始める記号でもなければ、前の項目の続きとみなしてさらに上を探す
    if (k > 0 && lines[k - 1].trim() !== '' && !NOT_LAZY.test(lines[k])) continue;
    return -1;
  }
  return -1;
}

/**
 * from 以降に続く兄弟の並び [{ line, b }]。空行とより深い行は飛ばし、それ以外の行（地の文・HTML・別のリスト）で止まる。
 * 番号の振り直しにだけ使う（止まるのが早すぎても、振り直しが途中までになるだけで描画は変わらない）。
 */
function followingSiblings(lines, from, cur) {
  const out = [];
  let bal = 0;
  for (let k = from; k < lines.length; k++) {
    if (lines[k].trim() === '') continue;
    const p = parseBullet(lines[k]);
    if (isSibling(cur, p)) { out.push({ line: k, b: p }); continue; }
    const ind = (lines[k].match(/^[ \t>]*/) || [''])[0];
    if (indentWidth(ind) <= indentWidth(cur.indent)) break;
    bal += htmlBalance(lines[k]);
    if (bal < 0) break;
  }
  return out;
}

/**
 * 番号付きリストで、後ろに続く兄弟の番号を delta（+1 / -1）だけずらす編集。
 * 先頭の項目を消すと markdown-it は <ol start="2"> にするので、振り直さないと表示が「2.」から始まってしまう。
 * 連番（firstOld, firstOld+1, …）になっているところまでを対象にする（全部 1. と書く流儀には触らない）。
 * 桁数が変わる（9→10）と子の字下げが合わなくなりリストの入れ子が壊れるので、そのときは1件も振り直さない。
 */
function renumberEdits(lines, offs, from, cur, firstOld, delta) {
  if (cur.num === null) return [];
  const edits = [];
  let expect = firstOld;
  for (const s of followingSiblings(lines, from, cur)) {
    if (s.b.num !== expect || s.b.numStr !== String(expect)) break;
    const now = String(expect + delta);
    if (expect + delta < 0 || now.length !== s.b.numStr.length) return [];
    const at = offs[s.line] + s.b.indent.length;
    edits.push({ start: at, end: at + s.b.numStr.length, text: now });
    expect++;
  }
  return edits;
}

/** 隣り合って接している編集を1つにまとめる（同じ位置への挿入と置換が並ぶと、適用順が実装しだいになるため） */
function mergeTouching(text, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const e of sorted) {
    const p = out[out.length - 1];
    if (p && p.end === e.start) { p.end = e.end; p.text += e.text; } else out.push({ start: e.start, end: e.end, text: e.text });
  }
  return out;
}

/** from 以降で最初の空でない行が兄弟ならその行番号（無ければ -1） */
function nextSiblingLine(lines, from, cur) {
  for (let k = from; k < lines.length; k++) {
    if (lines[k].trim() === '') continue;
    return isSibling(cur, parseBullet(lines[k])) ? k : -1;
  }
  return -1;
}

/** 項目の本当の終わり（exclusive）。data-line-end は後ろの空行を含むことがあるので、空行ぶん手前へ戻す */
function itemEnd(lines, line, lineEnd) {
  let p = Math.min(Math.max(lineEnd, line + 1), lines.length);
  // 項目の中で開いていない </div> が出てきたら、そこは項目の外（囲みの閉じタグ）。手前で切る
  let bal = Math.max(0, htmlBalance(lines[line]));
  for (let k = line + 1; k < p; k++) {
    bal += htmlBalance(lines[k]);
    if (bal < 0) { p = k; break; }
  }
  while (p - 1 > line && lines[p - 1].trim() === '') p--;
  return p;
}

/**
 * 箇条書きの項目（line 行目〜 lineEnd）の下に、同じインデント・同じ記号の空の項目を作る。
 * 入れ子の子があれば子の後ろ（項目の終わり）に入れる。番号付きは次の番号。
 * 項目どうしを空行で離す書き方（loose list）なら、その流儀に合わせて空行を挟む。
 * 戻り値の newLine は新しい項目の行番号（再描画後に編集を始める位置）。
 */
function addBulletAfter(text, line, lineEnd) {
  const { lines, offs } = indexLines(text);
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return fail('箇条書きの行が見つかりません');
  const cur = parseBullet(lines[line]);
  if (!cur) return fail('この行は箇条書きではありません', line);
  const eol = detectEol(text);
  const end = itemEnd(lines, line, Number.isInteger(lineEnd) ? lineEnd : line + 1);
  const marker = cur.bullet !== null ? cur.bullet : String(cur.num + 1) + cur.delim;
  const item = cur.indent + marker + cur.space + (cur.task ? '[ ] ' : '');
  // 前後どちらかの兄弟と空行で離れていれば loose list
  const prev = prevSiblingLine(lines, line, cur);
  const next = nextSiblingLine(lines, end, cur);
  const loose = (prev >= 0 && lines[line - 1].trim() === '') || (next >= 0 && next > end);
  let edit, newLine;
  if (end >= lines.length) {
    // ファイルの最後の行に改行が無い：改行から書き始める
    edit = { start: text.length, end: text.length, text: eol + (loose ? eol : '') + item };
    newLine = lines.length + (loose ? 1 : 0);
  } else {
    // 行頭 offs[end] に差し込む。HTML の div に挟まれた箇条書きでも、直後の空行と </div> はそのまま後ろへ送られる
    edit = { start: offs[end], end: offs[end], text: (loose ? eol : '') + item + eol };
    newLine = end + (loose ? 1 : 0);
  }
  // 番号付き：後ろの兄弟を1つずつ繰り下げる（1. 2. 2. 3. と重複させない）
  const renum = cur.num !== null ? renumberEdits(lines, offs, end, cur, cur.num + 1, 1) : [];
  const count = slideStartLines(text).length;
  return verified(text, mergeTouching(text, [edit, ...renum]), count, () => newLine, { newLine });
}

/**
 * 箇条書きの項目（入れ子の子ごと）を消す。リストの最後の1項目なら消さない（ok:false）。
 * loose list では、項目どうしを離していた空行も一緒に消す（空行が2つ並ばないように）。
 */
function removeBullet(text, line, lineEnd) {
  const { lines, offs } = indexLines(text);
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) return fail('箇条書きの行が見つかりません');
  const cur = parseBullet(lines[line]);
  if (!cur) return fail('この行は箇条書きではありません', line);
  const end = itemEnd(lines, line, Number.isInteger(lineEnd) ? lineEnd : line + 1);
  const prev = prevSiblingLine(lines, line, cur);
  const next = nextSiblingLine(lines, end, cur);
  if (prev < 0 && next < 0) return fail('リストの最後の1項目は消せません', line);
  let startLine = line, endLine = end, reveal;
  if (next >= 0) {
    endLine = next;            // 次の兄弟の行頭まで（間の空行ごと）
    reveal = line;             // 次の兄弟がこの行へ上がってくる
  } else {
    while (startLine - 1 > prev && lines[startLine - 1].trim() === '') startLine--; // 前の兄弟との間の空行
    reveal = prev;
  }
  let edit;
  if (endLine >= lines.length) {
    // 最後の行（改行なし）まで消す：前の行の改行から消して、ファイル末尾に改行を足さない
    const s = startLine > 0 ? offs[startLine - 1] + lines[startLine - 1].length : 0;
    edit = { start: s, end: text.length, text: '' };
  } else {
    edit = { start: offs[startLine], end: offs[endLine], text: '' };
  }
  // 番号付き：後ろの兄弟を1つずつ繰り上げる（先頭を消しても 1. から始まるように）
  const renum = next >= 0 && cur.num !== null ? renumberEdits(lines, offs, next, cur, cur.num + 1, -1) : [];
  const count = slideStartLines(text).length;
  return verified(text, mergeTouching(text, [edit, ...renum]), count, () => reveal);
}

module.exports = {
  applyEdits,
  duplicateSlide: guarded(duplicateSlide),
  deleteSlide: guarded(deleteSlide),
  moveSlide: guarded(moveSlide),
  insertSlideAfter: guarded(insertSlideAfter),
  newSlideTemplates,
  addBulletAfter: guarded(addBulletAfter),
  removeBullet: guarded(removeBullet),
  stripLibMark, detectEol,
};
