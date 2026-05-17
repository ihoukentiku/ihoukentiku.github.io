/* ================================================================
   Google Analytics ローダ
   本番ホスト (ihoukentiku.github.io) でのみ gtag.js を読み込み、計測する。
   開発環境 (localhost / 127.0.0.1 / file://) では何もしない。
================================================================ */
(function () {
    if (location.hostname !== 'ihoukentiku.github.io') return;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=G-T4SJ8S23EC';
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', 'G-T4SJ8S23EC');
})();
