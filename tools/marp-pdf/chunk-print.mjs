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
    args: [
      '--no-sandbox',
      '--allow-file-access-from-files',
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
