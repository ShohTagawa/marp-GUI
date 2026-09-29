#!/usr/bin/env node
// tsutawaru-lint — 『伝わるデザインの基本 増補改訂3版』のルールに照らして Marp デックを点検する。
//
//   node tools/tsutawaru-lint.mjs slides/<deck>/<deck>.md
//   node tools/tsutawaru-lint.mjs slides            # ディレクトリを再帰的に走査
//   node tools/tsutawaru-lint.mjs slides --summary  # デック単位の集計だけ出す
//
// 判定は「見た目の点検」の代わりにはならない。PNGを目で見る前のふるいとして使う。
// しきい値の根拠は各ルールのコメントに書いてある。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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
  // CLAUDE.md の不変則（本文の下限）
  FONTSIZE_MIN: 18,
  // p.98「丸みは最低限に抑える」／丸みは資料内で統一する
  RADIUS_WARN: 8,
};

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
 * ユーティリティ
 * ------------------------------------------------------------------ */
const stripNoise = (s) =>
  s.replace(/<svg[\s\S]*?<\/svg>/g, ' ')      // インラインSVGは対象外
   .replace(/<!--[\s\S]*?-->/g, ' ')          // スピーカーノート・注入マーカー
   .replace(/```[\s\S]*?```/g, ' ');

const visibleText = (s) =>
  stripNoise(s)
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#*`>|\-_=\s]/g, '');

/** md をフロントマターと「スライド配列（本文・開始行）」に割る */
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
  return { fm, slides };
}

/* ------------------------------------------------------------------ *
 * 検査
 * ------------------------------------------------------------------ */
function lintSlide(text, startLine, out, push) {
  const clean = stripNoise(text);

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
  if (boxes >= RULES.BOX_WARN) {
    push('warn', startLine, `囲みが${boxes}個`,
      `枠を付けるのは最低限に（p.174/p.212）。塗りだけ→細枠だけ→囲まない、の順に落とす`);
  }

  // ---- 1枚の文字数（p.202） ----
  const chars = visibleText(text).length;
  out.chars.push(chars);
  if (chars > RULES.CHARS_WARN) {
    push('warn', startLine, `可視文字数 ${chars}字`,
      `入らないのは情報過多のサイン（p.202）。図表を減らす／文字数を減らす／ページを分割する`);
  }

  const sizes = [];
  let centered = false;

  // ---- 行単位の検査（行番号を正確に出すため1回のスキャンにまとめる） ----
  const lines = clean.split('\n');
  lines.forEach((raw, k) => {
    const ln = startLine + k;

    // インラインの font-size（p.77 / CLAUDE.md 不変則）
    for (const m of raw.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      const s = +m[1];
      sizes.push(s);
      if (s < RULES.FONTSIZE_MIN) {
        push('error', ln, `font-size:${s}px`,
          `本文の下限は${RULES.FONTSIZE_MIN}px（CLAUDE.md 不変則）。縮める前にレイアウトを変える`);
      }
    }
    // 角丸（p.98）
    for (const m of raw.matchAll(/border-radius\s*:\s*(\d+(?:\.\d+)?)px/g)) {
      if (+m[1] > RULES.RADIUS_WARN) {
        push('warn', ln, `border-radius:${m[1]}px`,
          `丸みは最低限に、かつ資料内で統一（p.98）。テーマの既定は3px`);
      }
    }
    // 中央揃え（p.70）— スライドにつき1件だけ報告する
    if (!centered && /text-align\s*:\s*center/.test(raw)) {
      centered = true;
      push('info', ln, '中央揃え',
        `使ってよいのは左揃えか両端揃え（p.70）。見出しの中央寄せは1枚に限る`);
    }

    // ---- 文体：体言止め・煽り（本の範囲外／このリポジトリの運用ルール） ----
    // 見出し・要点・箇条書きの「1行」だけを対象にする
    const head = raw.match(/^\s*#{2,3}\s+(.+)$/)
      || raw.match(/^\s*<div class="(?:t|lead|takeaway|subhead)[^"]*">(.+?)<\/div>/)
      || raw.match(/^\s*[-*]\s+(.+)$/);
    if (head) {
      const t = head[1].replace(/<[^>]+>/g, '').trim().replace(/[。．.!！?？」）)]+$/, '');
      if (t.length >= 6 && TAIGEN_SUFFIX.some((s) => t.endsWith(s))) {
        push('style', ln, `体言止め「…${t.slice(-8)}」`,
          `述語で言い切る（「〜化」「〜性」「〜の実現」で止めない）`);
      }
    }
    const plain = raw.replace(/<[^>]+>/g, '');
    for (const w of HYPE_STRONG) {
      if (plain.includes(w)) { push('style', ln, `煽り語「${w}」`, `事実と根拠で言う。誇張語は外す`); break; }
    }
    for (const w of HYPE_SOFT) {
      if (plain.includes(w)) { push('style', ln, `常套句「${w}」`, `AIっぽい定型。具体語に置き換える`); break; }
    }
  });

  // ---- 文字サイズの種類数（p.77）はスライド単位で判定 ----
  const kinds = new Set(sizes).size;
  if (kinds >= RULES.FONTSIZE_KINDS_WARN) {
    push('warn', startLine, `文字サイズを${kinds}種類ベタ書き`,
      `4種類以上のフォントサイズは使わない（p.77）。サイズではなく太さで差をつける`);
  }
}

function lintFile(path) {
  const src = readFileSync(path, 'utf-8');
  if (!/^---[\s\S]{0,400}marp:\s*true/.test(src)) return null;
  const { fm, slides } = splitSlides(src);
  const out = { path, boxes: 0, chars: [], findings: [], theme: (fm.match(/^theme:\s*(\S+)/m) || [])[1] };
  const push = (level, line, what, why) => out.findings.push({ level, line, what, why });
  slides.forEach((s, i) => lintSlide(s.text, s.start, out, (lv, ln, w, y) =>
    push(lv, ln, `[p${i + 1}] ${w}`, y)));
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
const argv = process.argv.slice(2);
const summaryOnly = argv.includes('--summary');
const targets = argv.filter((a) => !a.startsWith('--'));
if (!targets.length) {
  console.error('usage: node tools/tsutawaru-lint.mjs <file.md|dir> [--summary]');
  process.exit(1);
}

const COLOR = { error: '\x1b[31m', warn: '\x1b[33m', style: '\x1b[35m', info: '\x1b[36m' };
const R = '\x1b[0m';
let totals = { error: 0, warn: 0, style: 0, info: 0 };

const files = targets.flatMap((t) => walk(t));
for (const f of files) {
  const r = lintFile(f);
  if (!r) continue;
  const med = r.chars.length ? [...r.chars].sort((a, b) => a - b)[Math.floor(r.chars.length / 2)] : 0;
  const dens = (r.boxes / r.pages).toFixed(2);
  const counts = r.findings.reduce((a, x) => ((a[x.level] = (a[x.level] || 0) + 1), a), {});
  for (const k in counts) totals[k] += counts[k];
  const tag = Object.entries(counts).map(([k, v]) => `${COLOR[k]}${k} ${v}${R}`).join('  ') || '\x1b[32mclean\x1b[0m';
  console.log(`\n${relative(process.cwd(), f)}  [theme: ${r.theme || '?'}]`);
  console.log(`  ${r.pages}枚 / 囲み ${dens} 枠per枚 / 文字数の中央値 ${med}字   ${tag}`);
  if (summaryOnly) continue;
  for (const x of r.findings) {
    console.log(`  ${COLOR[x.level]}${x.level.padEnd(5)}${R} ${f}:${x.line}  ${x.what}`);
    console.log(`          → ${x.why}`);
  }
}
console.log(`\n合計: ` + Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(' / '));
process.exit(totals.error > 0 ? 1 : 0);
