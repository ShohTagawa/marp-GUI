// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Shoh Tagawa
// 全スライドを1つのHTMLに描画しておき、Chrome(puppeteer)で「ページ範囲」ごとに
// 分割印刷するためのワーカー。printToPDF は1回でserializeするページ数が多いほど
// "Printing failed" で落ちるため、範囲を区切って小さく印刷し、後段で結合する。
//
// build-pdf.mjs から import して使う（printChunks）。単体実行も可：
//   CHROME_PATH=<chrome> node chunk-print.mjs <html> <range1> <out1> [<range2> <out2> ...]
//
// 重要: ベクター品質を保つため page.pdf() で出力する(PNGラスタ化はしない)。
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadPuppeteer, findChrome } from '../lib/marp-env.mjs';

/**
 * @param {string} htmlPath  marp が出力した bespoke HTML（絶対パス）
 * @param {{range:string,out:string}[]} jobs  例 [{range:'1-20', out:'part_001.pdf'}]
 */
export async function printChunks(htmlPath, jobs, { chromePath = findChrome() } = {}) {
  const puppeteer = await loadPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'shell',
    // VS Code 拡張ホストから起動すると、Chrome の初回起動処理やデフォルトブラウザ確認で
    // 止まる/許可待ちになることがある。それらを抑止して非対話でも確実に上がるようにする。
    //
    // 【安全のため付けないフラグ】（2026-10-02 に外した）
    //   --no-sandbox ……………………… Chrome の砂場（サンドボックス）を切る。切ると、ページの中で
    //                                  悪さをするコードが PC 本体にまで手を伸ばしやすくなる。
    //   --allow-file-access-from-files … file:// のページが、同じ PC の別のファイル（~/.ssh など）を
    //                                  スクリプトで読めるようにする。他人から受け取ったデックに
    //                                  <script> が入っていると、手元のファイルを読んで外へ送れてしまう。
    //   どちらも無くても、画像・動画・インライン SVG は file:// からそのまま表示される（<img> などの
    //   読み込みはこのフラグと関係ない）。外す前後で PDF の見た目が同じことを確かめてある。
    //   砂場がどうしても使えない環境（root で動く Linux のコンテナ等）だけ、環境変数
    //   MARP_PDF_NO_SANDBOX=1 を付けて実行すると --no-sandbox を足す。
    //
    // [Flags intentionally NOT used] (removed 2026-10-02 for security)
    //   --no-sandbox ..................... disables Chrome's sandbox, so malicious code in a page
    //                                      can reach the host machine more easily.
    //   --allow-file-access-from-files ... lets a file:// page read other local files (e.g. ~/.ssh)
    //                                      from script. A deck received from someone else could use
    //                                      an embedded <script> to read local files and send them out.
    //   Neither is needed: images, videos and inline SVG still load from file:// (plain <img> loads
    //   are not affected by this flag). The PDF output was verified to be identical before/after.
    //   Only where the sandbox cannot run at all (e.g. a Linux container running as root),
    //   set MARP_PDF_NO_SANDBOX=1 to add --no-sandbox back.
    args: [
      ...(process.env.MARP_PDF_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
    ],
    timeout: 60000, // 起動が60秒で上がらなければ例外（無限待ちにしない）
  });
  try {
    const page = await browser.newPage();
    // marp の bespoke HTML は ?view=print で全スライドを印刷レイアウトに展開する。
    // 'networkidle0' は接続が残ると最大180秒待って固まることがある。
    // 自己完結した印刷用HTMLなので 'load' で十分。さらにフォント描画完了だけ待つ。
    // file URL は pathToFileURL で作る（Windows のドライブ文字・日本語パスを正しくエンコード）。
    const url = pathToFileURL(path.resolve(htmlPath)).href + '?view=print';
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => (document.fonts && document.fonts.ready) ? document.fonts.ready : null).catch(() => {});
    for (const { range, out } of jobs) {
      await page.pdf({
        path: out,
        printBackground: true,
        preferCSSPageSize: true, // marp の @page サイズ(16:9等)をそのまま使う
        pageRanges: range,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      console.log('  chunk', range, '->', out);
    }
  } finally {
    await browser.close();
  }
}

// ── 単体実行 ──────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const htmlPath = args.shift();
  const jobs = [];
  for (let i = 0; i < args.length; i += 2) jobs.push({ range: args[i], out: args[i + 1] });
  if (!htmlPath || !jobs.length) {
    console.error('usage: node chunk-print.mjs <html> <range1> <out1> [<range2> <out2> ...]');
    process.exit(2);
  }
  await printChunks(htmlPath, jobs);
}
