// ブラウザ側：section 内のテキストノードを DOM 順に列挙する（lib/source-map.cjs の locateNodes と対）。
// Webview（preview.js）とテスト（puppeteer）で同じ物を使う。ここを変えたら source-map のテストを回すこと。
//   戻り値: [{ node, t, near, svg }]
//   除外：section 直下の header / footer、style、script、数式の出力（.katex / mjx-container）、空白だけのノード
//     t    … nodeValue そのまま（trim しない）
//     near … 最も近い祖先の位置情報 { kind:'md'|'html', start, end }（行番号 0-based、end は exclusive）。
//            <section> 自身の data-line は数えない。無ければ null（＝スライド全体が探索窓）
//     svg  … デック本文のインライン <svg> の中か（Marp のスライド枠 svg[data-marpit-svg] は除く）
(function (global) {
  'use strict';
  function nearOf(el, section) {
    for (let e = el; e && e !== section; e = e.parentElement) {
      if (e.hasAttribute && e.hasAttribute('data-line')) {
        return { kind: 'md', start: +e.getAttribute('data-line'), end: +e.getAttribute('data-line-end') };
      }
      if (e.hasAttribute && e.hasAttribute('data-hline')) {
        return { kind: 'html', start: +e.getAttribute('data-hline'), end: +e.getAttribute('data-hline-end') };
      }
    }
    return null;
  }
  function skipped(el, section) {
    for (let e = el; e && e !== section; e = e.parentElement) {
      const tag = e.tagName ? e.tagName.toLowerCase() : '';
      if (tag === 'style' || tag === 'script') return true;
      if ((tag === 'header' || tag === 'footer') && e.parentElement === section) return true;
      // 数式の出力（math: katex の <span class="katex">、MathJax の <mjx-container>）は原稿の $…$ と文字が対応しない。
      // 列挙すると、式の中の「x」が本文の「x」に当たり、式を編集したつもりで本文が書き換わる（実測）ので数えない
      if (tag === 'mjx-container' || (e.classList && e.classList.contains('katex'))) return true;
    }
    return false;
  }
  function inInlineSvg(el, section) {
    for (let e = el; e && e !== section; e = e.parentElement) {
      if (e.tagName && e.tagName.toLowerCase() === 'svg' && !e.hasAttribute('data-marpit-svg')) return true;
    }
    return false;
  }
  function ssCollectTextNodes(section) {
    const out = [];
    if (!section) return out;
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue;
      if (!v || !v.trim()) continue;
      const el = n.parentElement;
      if (!el || skipped(el, section)) continue;
      out.push({ node: n, t: v, near: nearOf(el, section), svg: inInlineSvg(el, section) });
    }
    return out;
  }
  global.ssCollectTextNodes = ssCollectTextNodes;
})(typeof window !== 'undefined' ? window : globalThis);
