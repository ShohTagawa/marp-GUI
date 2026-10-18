#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// tsutawaru-lint — Marp デックを、『伝わるデザインの基本 増補改訂3版』のルールと、このリポジトリの規則に照らして点検する。
//
//   node tools/tsutawaru-lint.mjs slides/<deck>/<deck>.md
//   node tools/tsutawaru-lint.mjs slides             # ディレクトリを再帰的に走査
//   node tools/tsutawaru-lint.mjs slides --summary   # デック単位の集計だけ出す
//   node tools/tsutawaru-lint.mjs slides --lang en   # 出力の言語 ja|en
//
// 判定は「見た目の点検」の代わりにはならない。PNGを目で見る前のふるいとして使う。
// ルールの一覧・しきい値・本のページは docs/design-rules.md（英語と日本語）。しきい値の根拠は各ルールのコメントにもある。
//
// 水準と終了コード：
//   error … インラインの style="…"（とフロントマターの header/footer の HTML）で文字が 18px 未満
//   warn  … 囲みの数・文字数・サイズの種類・角丸／CSS（フロントマターの style: と <style>）と SVG の文字が 18px 未満
//   style … 文体（体言止め・煽り語・常套句）。日本語の文だけを見る
//   info  … 中央揃え
//   error が 1 件でもあれば終了コード 1。warn 以下は終了コードに影響しない。使い方の誤り（知らないオプション・無いパス）は 2。
// 言語：--lang が無ければ LC_ALL → LC_MESSAGES → LANG の最初に値のあるものが ja で始まれば ja、それ以外は en。
//       3 つとも無ければ（Windows など）OS の言語（Intl）で決める。
// 色：端末（TTY）に出すときだけ ANSI の色を付ける。NO_COLOR（空でない値）で消し、FORCE_COLOR で強制する。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

/* ------------------------------------------------------------------ *
 * しきい値
 * ------------------------------------------------------------------ */
const RULES = {
  // p.174「枠を付けるのは最低限に」／p.212「囲みすぎは絶対にNGです。」
  // 実測（推敲を重ねた4デック・253枚）: 84%が囲み0個、3個以上はわずか5.5%。
  BOX_WARN: 3,
  // p.202「ルール通りにいかないのは、多くの場合、情報が多すぎたり、内容が洗練されていないことが原因」
  // 実測（同上）: 中央値218字・75%tile 330字。400字を超えたら分割を検討する。
  CHARS_WARN: 400,
  // p.77「スライドなどの資料では、4種類以上のフォントサイズを使わないほうが無難」
  FONTSIZE_KINDS_WARN: 4,
  // 文字の下限。このリポジトリの規則（講堂で投影して読める大きさ）で、本の規則ではない。
  // 本の p.61 はスライド本文の目安を示すだけで、下限は決めていない。
  FONTSIZE_MIN: 18,
  // p.98「丸みは最低限に抑える」／丸みは資料内で統一する
  RADIUS_WARN: 8,
};
const MIN = RULES.FONTSIZE_MIN;
const LEVELS = ['error', 'warn', 'style', 'info'];

// 囲み系クラス（academic / 部品テーマ（非同梱） / tsutawaru 共通）
const BOX_CLASS =
  /class="[^"]*(?:box-accent|box-info|box-warn|why-callout|callout-|stepbox|pcard|goal-box|exrow|sec-box|fill\b|rule-box)/g;

// 体言止めになりやすい語尾。AIが書いた文に頻出し、話し言葉から遠ざかる。
// ※ このリストは書籍の内容ではなく、このリポジトリの運用ルール。
const TAIGEN_SUFFIX = [
  '化', '性', '力', '点', '策', '法', '面', '感', '度', '観', '論', '型', '率', '差',
  '実現', '推進', '向上', '強化', '促進', '活用', '構築', '確立', '支援', '創出',
  '最適化', '効率化', '可視化', '標準化', '高度化', '一元化', '見える化',
  '重要性', '必要性', '可能性', '方向性', '位置づけ', '在り方', 'あり方', '全体像',
];
// 煽り語（強）
const HYPE_STRONG = [
  '革命', '激変', '衝撃', '圧倒的', '劇的', '必見', '今すぐ', '驚異', '覚醒',
  '生き残', '淘汰', '乗り遅れ', 'ゲームチェンジ', 'パラダイムシフト', '爆速',
  '最強', '完全版', '徹底解説', '決定版', '未曾有', '唯一無二', '破壊的',
  '時代は終わ', '常識が変わ', 'もはや', 'ついに',
];
// AIっぽい常套句（弱）
const HYPE_SOFT = [
  'に他ならない', 'ではないでしょうか', 'と言えるでしょう', '極めて重要',
  '不可欠', 'が求められています', 'していく必要がある', '単なる',
  'と言っても過言ではない', 'まさに',
];

/* ------------------------------------------------------------------ *
 * 出力の文言（ja / en）。p.NNN は本のページ。本でない規則には「このリポジトリの規則」と書く
 * ------------------------------------------------------------------ */
const BOOK = {
  ja: 'p.NNN は 高橋佑磨・片山なつ『伝わるデザインの基本 増補改訂3版 よい資料を作るためのレイアウトのルール』技術評論社, 2021（ISBN 978-4-297-11985-0）のページ。',
  en: 'p.NNN = page in: Takahashi Y, Katayama N. Tsutawaru dezain no kihon [The basics of design that communicates]. Expanded and revised 3rd ed. Gijutsu-Hyōron-sha; 2021. ISBN 978-4-297-11985-0 (in Japanese).',
};

const T = {
  ja: {
    slide: (n) => `[${n}枚目]`,
    fm: '[フロントマター]',
    boxes: (n) => [`囲みが${n}個`, '枠を付けるのは最低限に（p.174/p.212）。塗りだけ→細枠だけ→囲まない、の順に落とす'],
    chars: (n) => [`可視文字数 ${n}字`, '入らないのは情報過多のサイン（p.202）。図表を減らす／文字数を減らす／ページを分割する'],
    kinds: (n) => [`文字サイズを${n}種類ベタ書き`, '4種類以上のフォントサイズは使わない（p.77）。サイズではなく太さで差をつける'],
    fsInline: (v) => [v, `文字の下限は${MIN}px（このリポジトリの規則：講堂で投影して読める大きさ）。縮める前にレイアウトを変える`],
    fsCss: (v, where) => [`${where === 'fm' ? 'フロントマターの CSS' : '<style> の CSS'} に ${v}`,
      `スライドの文字に効くなら${MIN}pxの下限を割る（このリポジトリの規則）。セレクタがどの要素に効くかは見ないので warn にとどめる`],
    fsSvg: (v, n, drawn) => [`SVG の font-size ${v}（${n}か所・${drawn == null ? 'SVG の単位' : `描画で約${drawn}px`}）`,
      `図の中の文字も描画で${MIN}px以上にする（このリポジトリの規則）。SVG は拡大縮小で大きさが変わるので warn にとどめる`],
    radius: (v) => [`border-radius:${v}px`, '丸みは最低限に、かつ資料内で統一（p.98）。テーマの既定は3px'],
    center: () => ['中央揃え', '使ってよいのは左揃えか両端揃え（p.70）。見出しの中央寄せは1枚に限る（このリポジトリの規則）'],
    taigen: (t) => [`体言止め「…${t}」`, '述語で言い切る。「〜化」「〜性」「〜の実現」で止めない（このリポジトリの規則）'],
    hype: (w) => [`煽り語「${w}」`, '事実と根拠で言う。誇張語は外す（このリポジトリの規則）'],
    soft: (w) => [`常套句「${w}」`, 'AIっぽい定型。具体語に置き換える（このリポジトリの規則）'],
    summary: (pages, dens, med) => `${pages}枚 / 囲み ${dens} 枠per枚 / 文字数の中央値 ${med}字`,
    clean: '指摘なし',
    total: (decks, slides) => `合計（${decks}デック・${slides}枚）: `,
    none: 'Marp のデック（marp: true の .md）が見つからない',
    notFound: (p) => `見つからない: ${p}`,
    badLang: (v) => `--lang は ja か en: ${v ?? '（値が無い）'}`,
    badOpt: (o) => `知らないオプション: ${o}`,
    footer: [BOOK.ja, '（このリポジトリの規則）は本ではなく、このリポジトリで決めた規則。全ルールの一覧は docs/design-rules.md'],
    usage: [
      '使い方: node tools/tsutawaru-lint.mjs <file.md|dir>... [--summary] [--lang ja|en]',
      '  --summary   デックごとの集計だけを出す',
      '  --lang      出力の言語（既定は LC_ALL / LC_MESSAGES / LANG）',
      '終了コード: 0 = error なし／1 = error あり／2 = 使い方の誤り',
    ],
  },
  en: {
    slide: (n) => `[slide ${n}]`,
    fm: '[front matter]',
    boxes: (n) => [`${n} boxed elements`,
      'Keep boxes to a minimum (handbook p.174, p.212): use a fill only, then a thin rule only, then no box.'],
    chars: (n) => [`${n} visible characters`,
      'Text that does not fit signals too much information (handbook p.202). Cut figures or text, or split the slide.'],
    kinds: (n) => [`${n} font sizes set inline`,
      'Use at most three font sizes on a slide (handbook p.77). Vary the weight rather than the size.'],
    fsInline: (v) => [v,
      `Text is never set below ${MIN}px (project rule, for legibility when projected). Change the layout before shrinking text.`],
    fsCss: (v, where) => [`${v} in ${where === 'fm' ? 'front-matter CSS' : 'a <style> block'}`,
      `Below the ${MIN}px floor if this rule styles slide text (project rule). A warning, because the lint does not resolve which elements a CSS selector matches.`],
    fsSvg: (v, n, drawn) => [`SVG font-size ${v} at ${n} ${n === 1 ? 'place' : 'places'} (${drawn == null ? 'SVG user units' : `about ${drawn}px as drawn`})`,
      `Text in figures should also be ${MIN}px or larger as drawn (project rule). A warning, because the drawn size depends on how the SVG is scaled.`],
    radius: (v) => [`border-radius:${v}px`,
      'Keep corner rounding minimal and uniform (handbook p.98). The theme uses 3px.'],
    center: () => ['centred text',
      'Align text left or justified (handbook p.70); at most one centred heading per slide (project rule).'],
    taigen: (t) => [`nominal ending "…${t}"`,
      'End the line with a predicate, not a bare noun phrase (project rule; Japanese text only).'],
    hype: (w) => [`hype word "${w}"`,
      'Say it with facts and evidence; drop the exaggeration (project rule; Japanese text only).'],
    soft: (w) => [`stock phrase "${w}"`,
      'A stock phrase typical of machine-drafted text; use concrete words (project rule; Japanese text only).'],
    summary: (pages, dens, med) => `${pages} ${pages === 1 ? 'slide' : 'slides'} / ${dens} boxes per slide / median ${med} characters per slide`,
    clean: 'clean',
    total: (decks, slides) => `Total (${decks} ${decks === 1 ? 'deck' : 'decks'}, ${slides} ${slides === 1 ? 'slide' : 'slides'}): `,
    none: 'No Marp decks found (.md files with marp: true).',
    notFound: (p) => `not found: ${p}`,
    badLang: (v) => `--lang must be ja or en: ${v ?? '(no value)'}`,
    badOpt: (o) => `unknown option: ${o}`,
    footer: [BOOK.en, '(project rule) = a rule of this repository, not of the handbook. All rules: docs/design-rules.md'],
    usage: [
      'usage: node tools/tsutawaru-lint.mjs <file.md|dir>... [--summary] [--lang ja|en]',
      '  --summary   print one summary line per deck',
      '  --lang      output language (default: from LC_ALL / LC_MESSAGES / LANG)',
      'exit status: 0 = no errors, 1 = errors found, 2 = usage error',
    ],
  },
};

/** 既定の言語：LC_ALL → LC_MESSAGES → LANG（POSIX の優先順）。どれも無ければ Intl（OS の言語） */
function detectLang(env = process.env) {
  const v = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  if (v) return /^ja/i.test(v) ? 'ja' : 'en';
  try {
    return /^ja/i.test(Intl.DateTimeFormat().resolvedOptions().locale) ? 'ja' : 'en';
  } catch {
    return 'en';
  }
}

/** 色を付けるか：FORCE_COLOR（0/false 以外）＞ NO_COLOR（空でない値）＞ 端末かどうか */
function colorEnabled(env = process.env, stream = process.stdout) {
  if (env.FORCE_COLOR !== undefined) return !/^(0|false)$/i.test(env.FORCE_COLOR);
  if (env.NO_COLOR) return false;
  return !!stream.isTTY;
}

/* ------------------------------------------------------------------ *
 * ユーティリティ
 * ------------------------------------------------------------------ */
// 消す部分は同じ長さの空白に置き換え、改行は残す（行番号がずれないように）
const blank = (m) => m.replace(/[^\n]/g, ' ');
const RE_COMMENT = /<!--[\s\S]*?-->/g;          // スピーカーノート・注入マーカー
const RE_FENCE = /```[\s\S]*?```/g;
const RE_SVG = /<svg\b([^>]*)>[\s\S]*?<\/svg>/gi; // インラインSVG（文字サイズは別に見る）
const RE_STYLE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const RE_CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const RE_CODE_SPAN = /`[^`\n]+`/g;               // 文中のコード（`font-size:12px` と書いても指摘しない）

/** コメント・コードブロックを消した本文 */
const maskNotes = (s) => s.replace(RE_COMMENT, blank).replace(RE_FENCE, blank);

/** 位置 → 0 始まりの行 */
const lineAt = (s, index) => {
  let n = 0;
  for (let i = s.indexOf('\n'); i !== -1 && i < index; i = s.indexOf('\n', i + 1)) n++;
  return n;
};

const visibleText = (s) =>
  maskNotes(s)
    .replace(RE_SVG, ' ')
    .replace(RE_STYLE, ' ')                      // CSS は画面に出ない
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#*`>|\-_=\s]/g, '');

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * CSS（style 属性・<style>・フロントマターの style:）の中の文字サイズを拾う。
 * font-size と font の一括指定。単位は px と pt（1pt = 4/3 px）。em・rem・% は相対値なので見ない。
 * 返り値：{ index, label, px }
 */
function cssSizes(s) {
  const out = [];
  for (const m of s.matchAll(/(?<![\w-])font-size\s*:\s*(\d+(?:\.\d+)?)(px|pt)\b/gi)) {
    out.push(sizeOf(m.index, 'font-size:', m[1], m[2]));
  }
  for (const m of s.matchAll(/(?<![\w-])font\s*:\s*([^;}"'\n]*)/gi)) {
    const v = m[1].match(/(?:^|\s)(\d+(?:\.\d+)?)(px|pt)(?=\s|\/|$)/i);
    if (v) out.push(sizeOf(m.index, 'font:', v[1], v[2]));
  }
  return out.sort((a, b) => a.index - b.index);
}
function sizeOf(index, prop, num, unit) {
  const u = unit.toLowerCase();
  const px = u === 'pt' ? +num * 4 / 3 : +num;
  return { index, px, label: `${prop}${num}${u}` + (u === 'pt' ? ` (=${round1(px)}px)` : '') };
}

/**
 * SVG の拡大率（描画の px ÷ SVG の単位）。viewBox が無ければ 1 単位 = 1px。
 * 幅・高さが px で書いてあればそこから求める（両方あれば小さいほう＝preserveAspectRatio の既定）。
 * 幅が % や CSS 任せで分からなければ null。
 */
function svgScale(attrs) {
  const vb = attrs.match(/\bviewBox\s*=\s*["']\s*-?[\d.]+[\s,]+-?[\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const attr = (name) => {
    const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']\\s*(\\d+(?:\\.\\d+)?)(?:px)?\\s*["']`, 'i'));
    if (m) return +m[1];
    const st = attrs.match(new RegExp(`style\\s*=\\s*["'](?:[^"']*?[;\\s])?${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i'));
    return st ? +st[1] : null;
  };
  if (!vb) return 1;
  const s = [];
  const w = attr('width'), h = attr('height');
  if (w && +vb[1]) s.push(w / +vb[1]);
  if (h && +vb[2]) s.push(h / +vb[2]);
  return s.length ? Math.min(...s) : null;
}

/** md をフロントマター（本文・開始行）と「スライド配列（本文・開始行）」に割る */
function splitSlides(src) {
  const lines = src.split('\n');
  let i = 0, fm = '';
  if (lines[0]?.trim() === '---') {
    let j = 1;
    while (j < lines.length && lines[j].trim() !== '---') j++;
    fm = lines.slice(1, j).join('\n');
    i = j + 1;
  }
  const slides = [];
  let buf = [], start = i + 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      slides.push({ text: buf.join('\n'), start });
      buf = []; start = i + 2;
    } else buf.push(lines[i]);
  }
  slides.push({ text: buf.join('\n'), start });
  return { fm, fmStart: 2, slides };
}

/* ------------------------------------------------------------------ *
 * 検査
 * ------------------------------------------------------------------ */
function lintSlide(text, startLine, out, push) {
  const notes = maskNotes(text);
  // スライド単位の指摘（囲み・文字数・サイズの種類）は、そのスライドの最初の空でない行に付ける
  const first = text.search(/\S/);
  const slideLine = startLine + (first < 0 ? 0 : lineAt(text, first));

  // ---- SVG の中の文字サイズ（このリポジトリの規則・warn） ----
  // SVG の font-size は SVG の単位。拡大率が分かれば描画の px に直して比べ、分からなければ数値のまま比べる。
  for (const m of notes.matchAll(RE_SVG)) {
    const scale = svgScale(m[1]);
    const small = new Map();
    for (const f of m[0].matchAll(/(?<![\w-])font-size\s*(?:=\s*["']\s*|:\s*)(\d+(?:\.\d+)?)(px|pt)?/gi)) {
      const unit = (f[2] || '').toLowerCase();
      const user = unit === 'pt' ? +f[1] * 4 / 3 : +f[1];
      const drawn = scale == null ? user : user * scale;
      if (drawn >= MIN) continue;
      const key = f[1] + unit;
      const hit = small.get(key) || { line: startLine + lineAt(notes, m.index + f.index), n: 0 };
      hit.n++;
      small.set(key, hit);
    }
    const drawnLabel = (key) => (scale == null || scale === 1 ? null
      : round1((key.endsWith('pt') ? parseFloat(key) * 4 / 3 : parseFloat(key)) * scale));
    for (const [key, hit] of small) push('warn', hit.line, 'fsSvg', key, hit.n, drawnLabel(key));
  }

  // ---- <style> の中の文字サイズ（warn）。行の検査ではこの行を CSS として扱う ----
  const noSvg = notes.replace(RE_SVG, blank);
  const styleLines = new Set();
  const clean = noSvg.replace(RE_STYLE, (blk, at) => {
    const a = lineAt(noSvg, at), b = a + (blk.match(/\n/g) || []).length;
    for (let k = a; k <= b; k++) styleLines.add(k);
    return blk.replace(RE_CSS_COMMENT, blank);
  });

  // ---- 囲みの数（p.174 / p.212） ----
  // .grid2（等幅・等高の整列カード＝p.205 別解2 の型）はグリッド全体で1つと数える。
  // 本が問題にするのは「バラバラに散った囲み」であって、均等に整列したカード群ではない。
  let boxSrc = clean;
  let gridUnits = 0;
  if (/class="[^"]*\bgrid2\b/.test(clean)) {
    gridUnits = (clean.match(/class="[^"]*\bgrid2\b/g) || []).length;
    boxSrc = clean.replace(/class="[^"]*\bfill\b[^"]*"/g, 'class=""');
  }
  const boxes = (boxSrc.match(BOX_CLASS) || []).length + gridUnits;
  out.boxes += boxes;
  if (boxes >= RULES.BOX_WARN) push('warn', slideLine, 'boxes', boxes);

  // ---- 1枚の文字数（p.202） ----
  const chars = visibleText(text).length;
  out.chars.push(chars);
  if (chars > RULES.CHARS_WARN) push('warn', slideLine, 'chars', chars);

  const sizes = [];
  let centered = false;

  // ---- 行単位の検査（行番号を正確に出すため1回のスキャンにまとめる） ----
  clean.split('\n').forEach((raw, k) => {
    const ln = startLine + k;
    const css = raw.replace(RE_CODE_SPAN, blank);

    // 文字サイズ（p.77 の種類数／このリポジトリの下限 18px）
    // インラインの style="…" は error、<style> の CSS は warn（どの要素に効くかを lint は解かない）
    for (const s of cssSizes(css)) {
      sizes.push(s.px);
      if (s.px < MIN) {
        if (styleLines.has(k)) push('warn', ln, 'fsCss', s.label, 'style');
        else push('error', ln, 'fsInline', s.label);
      }
    }
    // 角丸（p.98）
    for (const m of css.matchAll(/border-radius\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      if (+m[1] > RULES.RADIUS_WARN) push('warn', ln, 'radius', m[1]);
    }
    // 中央揃え（p.70）— スライドにつき1件だけ報告する
    if (!centered && /text-align\s*:\s*center/.test(css)) {
      centered = true;
      push('info', ln, 'center');
    }

    // ---- 文体：体言止め・煽り（本の範囲外／このリポジトリの運用ルール） ----
    // 見出し・要点・箇条書きの「1行」だけを対象にする
    const head = raw.match(/^\s*#{2,3}\s+(.+)$/)
      || raw.match(/^\s*<div class="(?:t|lead|takeaway|subhead)[^"]*">(.+?)<\/div>/)
      || raw.match(/^\s*[-*]\s+(.+)$/);
    if (head) {
      const t = head[1].replace(/<[^>]+>/g, '').trim().replace(/[。．.!！?？」）)]+$/, '');
      if (t.length >= 6 && TAIGEN_SUFFIX.some((s) => t.endsWith(s))) push('style', ln, 'taigen', t.slice(-8));
    }
    const plain = raw.replace(/<[^>]+>/g, '');
    for (const w of HYPE_STRONG) {
      if (plain.includes(w)) { push('style', ln, 'hype', w); break; }
    }
    for (const w of HYPE_SOFT) {
      if (plain.includes(w)) { push('style', ln, 'soft', w); break; }
    }
  });

  // ---- 文字サイズの種類数（p.77）はスライド単位で判定 ----
  const kinds = new Set(sizes).size;
  if (kinds >= RULES.FONTSIZE_KINDS_WARN) push('warn', slideLine, 'kinds', kinds);
}

/**
 * フロントマターの文字サイズ。style:（デック全体の CSS）の中は warn、
 * それ以外（header / footer の HTML に書いた style="…"）はインラインと同じ error。
 */
function lintFrontMatter(fm, fmStart, push) {
  let inStyle = false;
  const lines = fm.replace(RE_CSS_COMMENT, blank).split('\n');
  lines.forEach((raw, k) => {
    if (/^style\s*:/.test(raw)) inStyle = true;
    else if (/^\S/.test(raw)) inStyle = false;   // 次の最上位のキーで style: のブロックが終わる
    for (const s of cssSizes(raw)) {
      if (s.px >= MIN) continue;
      if (inStyle) push('warn', fmStart + k, 'fsCss', s.label, 'fm');
      else push('error', fmStart + k, 'fsInline', s.label);
    }
  });
}

function lintFile(path) {
  const src = readFileSync(path, 'utf-8').replace(/\r\n?/g, '\n');   // CRLF でも行頭・行末の判定を変えない
  if (!/^---[\s\S]{0,400}marp:\s*true/.test(src)) return null;
  const { fm, fmStart, slides } = splitSlides(src);
  const out = { path, boxes: 0, chars: [], findings: [], theme: (fm.match(/^theme:\s*(\S+)/m) || [])[1] };
  const push = (where) => (level, line, id, ...args) => out.findings.push({ level, line, where, id, args });
  lintFrontMatter(fm, fmStart, push(null));
  slides.forEach((s, i) => lintSlide(s.text, s.start, out, push(i + 1)));
  out.findings.sort((a, b) => a.line - b.line || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  out.pages = slides.length;
  return out;
}

function walk(p, acc = []) {
  if (statSync(p).isDirectory()) {
    for (const e of readdirSync(p)) {
      if (e === 'node_modules' || e === 'out' || e.startsWith('.')) continue;
      walk(join(p, e), acc);
    }
  } else if (p.endsWith('.md') && !p.includes('原稿')) acc.push(p);
  return acc;
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const o = { lang: null, summaryOnly: false, help: false, targets: [], error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--summary') o.summaryOnly = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--lang' || a.startsWith('--lang=')) {
      const v = a === '--lang' ? argv[++i] : a.slice('--lang='.length);
      const l = /^ja/i.test(v || '') ? 'ja' : /^en/i.test(v || '') ? 'en' : null;
      if (l) o.lang = l;
      else o.error ||= ['badLang', v];
    } else if (a.startsWith('-')) o.error ||= ['badOpt', a];
    else o.targets.push(a);
  }
  return o;
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const L = T[opt.lang || detectLang()];
  if (opt.help) { console.log(L.usage.join('\n')); return 0; }
  if (opt.error) { console.error(L[opt.error[0]](opt.error[1]) + '\n' + L.usage.join('\n')); return 2; }
  if (!opt.targets.length) { console.error(L.usage.join('\n')); return 2; }
  const missing = opt.targets.filter((t) => !existsSync(t));
  if (missing.length) { for (const t of missing) console.error(L.notFound(t)); return 2; }

  const color = colorEnabled();
  const C = { error: '\x1b[31m', warn: '\x1b[33m', style: '\x1b[35m', info: '\x1b[36m', clean: '\x1b[32m' };
  const paint = (k, s) => (color ? `${C[k]}${s}\x1b[0m` : s);
  const shown = (f) => {
    const r = relative(process.cwd(), f);
    return r && !r.startsWith('..') && !isAbsolute(r) ? r : f;
  };
  const totals = { error: 0, warn: 0, style: 0, info: 0 };
  let decks = 0, slideCount = 0;

  for (const f of opt.targets.flatMap((t) => walk(t))) {
    const r = lintFile(f);
    if (!r) continue;
    decks++; slideCount += r.pages;
    const med = r.chars.length ? [...r.chars].sort((a, b) => a - b)[Math.floor(r.chars.length / 2)] : 0;
    const dens = (r.boxes / r.pages).toFixed(2);
    const counts = {};
    for (const x of r.findings) counts[x.level] = (counts[x.level] || 0) + 1;
    for (const k in counts) totals[k] += counts[k];
    const tag = LEVELS.filter((k) => counts[k]).map((k) => paint(k, `${k} ${counts[k]}`)).join('  ') || paint('clean', L.clean);
    const name = shown(f);
    console.log(`\n${name}  [theme: ${r.theme || '?'}]`);
    console.log(`  ${L.summary(r.pages, dens, med)}   ${tag}`);
    if (opt.summaryOnly) continue;
    for (const x of r.findings) {
      const [what, why] = L[x.id](...x.args);
      const where = x.where == null ? L.fm : L.slide(x.where);
      console.log(`  ${paint(x.level, x.level.padEnd(5))} ${name}:${x.line}  ${where} ${what}`);
      console.log(`          → ${why}`);
    }
  }
  if (!decks) console.log(`\n${L.none}`);
  console.log(`\n${L.total(decks, slideCount)}` + LEVELS.map((k) => `${k} ${totals[k]}`).join(' / '));
  console.log(`\n${L.footer.join('\n')}`);
  return totals.error > 0 ? 1 : 0;
}

// process.exit() は使わない（macOS のパイプでは出力が途中で切れることがある）
process.exitCode = main();
