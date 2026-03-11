(function () {
    'use strict';

    /* ----------------------------------------------------------------
       サイト定数
       URL や外部リンクをまとめて管理する
    ---------------------------------------------------------------- */
    const SITE = {
        name: '違法建築のTRPGラボ',
        home: '/',
        twitter: 'https://twitter.com/ihoukentiku',
        github: 'https://github.com/ihoukentiku/ihoukentiku.github.io',
        githubLicense: 'https://github.com/ihoukentiku/ihoukentiku.github.io/blob/main/LICENSE',
        thirdPartyLicense: 'https://github.com/ihoukentiku/ihoukentiku.github.io/blob/main/THIRD_PARTY_LICENSES.md',
        privacyPolicy: 'privacy-policy.html',
    };

    /* ----------------------------------------------------------------
       ヘッダー構築
       ページ上部の共通ヘッダーを動的に生成する
    ---------------------------------------------------------------- */
    function buildHeader() {
        const header = document.getElementById('site-header');
        if (!header) return;

        header.innerHTML = `
      <div class="header-inner">
        <a href="${SITE.home}" class="site-logo" aria-label="ホームへ戻る">
          <span class="logo-en">TRPG Laboratory</span>
          <span class="logo-text">違法建築の<span class="logo-trpg">TRPG</span>ラボ</span>
        </a>
        <nav class="header-nav" aria-label="サイトナビゲーション">
          <button class="hbtn" id="btn-guide" aria-label="使い方ガイド" title="使い方ガイド">
            <span class="material-icons">help_outline</span>
          </button>
          <a class="hbtn" id="btn-twitter" href="${SITE.twitter}" target="_blank"
             rel="noopener noreferrer" aria-label="作者Twitter">
            <i class="fab fa-twitter" id="icon-bird"></i>
            <i class="fab fa-x-twitter" id="icon-x" style="display:none"></i>
          </a>
          <button class="hbtn" id="theme-toggle" aria-label="テーマ切り替え" title="テーマ切り替え">
            <span class="material-icons" id="theme-icon">light_mode</span>
          </button>
        </nav>
      </div>
    `;

        applyTheme(getSavedTheme());
        bindHeaderEvents();
    }

    /* ----------------------------------------------------------------
       テーマ管理
       ダーク / ライトモードの保存・適用を担当する
    ---------------------------------------------------------------- */
    function getSavedTheme() {
        return localStorage.getItem('theme') || 'dark';
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        const icon = document.getElementById('theme-icon');
        const bird = document.getElementById('icon-bird');
        const x = document.getElementById('icon-x');
        if (icon) icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
        if (bird && x) {
            /* ダークテーマ → X ロゴ、ライトテーマ → 旧鳥アイコン */
            bird.style.display = theme === 'dark' ? 'none' : '';
            x.style.display = theme === 'dark' ? '' : 'none';
        }
    }

    function bindHeaderEvents() {
        /* テーマ切り替えボタン */
        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) {
            const icon = document.getElementById('theme-icon');
            toggleBtn.addEventListener('click', () => {
                const cur = document.documentElement.getAttribute('data-theme');
                const next = cur === 'dark' ? 'light' : 'dark';
                /* アイコンを一回転させてから切り替える */
                icon.classList.remove('spinning');
                void icon.offsetWidth; // リフロー強制でアニメーション再生
                icon.classList.add('spinning');
                icon.addEventListener('animationend', () => toggleBtn.classList.remove('spinning'), { once: true });
                localStorage.setItem('theme', next);
                applyTheme(next);
            });
        }

        /* 使い方ガイドボタン */
        const guideBtn = document.getElementById('btn-guide');
        if (guideBtn) {
            guideBtn.addEventListener('click', () => openModal('guide-modal'));
        }
    }

    /* ----------------------------------------------------------------
       モーダル制御
       開閉時に背景スクロールをロック / アンロックする
    ---------------------------------------------------------------- */
    function openModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add('open');
        /* 背景のスクロールを止める */
        document.body.style.overflow = 'hidden';
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('open');
        /* 他に開いているモーダルがなければスクロールを戻す */
        if (!document.querySelector('.modal-overlay.open')) {
            document.body.style.overflow = '';
        }
    }

    function initModals() {
        /* 閉じるボタン */
        document.querySelectorAll('.modal-close').forEach((btn) => {
            btn.addEventListener('click', () => {
                const overlay = btn.closest('.modal-overlay');
                if (overlay) {
                    overlay.classList.remove('open');
                    if (!document.querySelector('.modal-overlay.open')) {
                        document.body.style.overflow = '';
                    }
                }
            });
        });

        /* オーバーレイ部分クリックで閉じる */
        document.querySelectorAll('.modal-overlay').forEach((overlay) => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.classList.remove('open');
                    if (!document.querySelector('.modal-overlay.open')) {
                        document.body.style.overflow = '';
                    }
                }
            });
        });

        /* Escape キーで閉じる */
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
                document.body.style.overflow = '';
            }
        });
    }

    /* ----------------------------------------------------------------
       使い方ガイド内リンク追加
       フッターがないページでも法的リンクへアクセスできるよう、
       ガイドモーダルの末尾にリンクブロックを追加する
    ---------------------------------------------------------------- */
    function buildGuideLinks() {
        const guideContent = document.getElementById('guide-content');
        if (!guideContent) return;

        /* すでに追加済みなら二重挿入しない */
        if (guideContent.querySelector('.guide-legal-links')) return;

        const linksEl = document.createElement('div');
        linksEl.className = 'guide-legal-links';
        linksEl.innerHTML = `
      <a href="${SITE.privacyPolicy}">プライバシーポリシー</a>
      <a href="${SITE.githubLicense}" target="_blank" rel="noopener">
        <i class="fab fa-github"></i> MIT License
      </a>
      <a href="${SITE.thirdPartyLicense}">サードパーティライセンス</a>
      <span class="guide-legal-copy">&copy; 2025 違法建築 | 違法建築のTRPGラボ</span>
    `;
        guideContent.appendChild(linksEl);
    }

    /* ----------------------------------------------------------------
       フッター構築
       フッターが存在するページにのみ実行される
    ---------------------------------------------------------------- */
    function buildFooter() {
        const footer = document.querySelector('.site-footer .container');
        if (!footer) return;
        footer.innerHTML = `
      <div class="footer-inner">
        <div class="footer-links">
          <a href="${SITE.privacyPolicy}">プライバシーポリシー</a>
          <a href="${SITE.githubLicense}" target="_blank" rel="noopener">
            <i class="fab fa-github"></i> MIT License
          </a>
          <a href="${SITE.thirdPartyLicense}">サードパーティライセンス</a>
        </div>
        <p class="footer-copy">&copy; 2025 違法建築 | 違法建築のTRPGラボ</p>
      </div>
    `;
    }

    function syncHeaderToMain() {
        const main = document.getElementById('main');
        const headerInner = document.querySelector('.header-inner');
        if (!main || !headerInner) return;

        const maxWidth = getComputedStyle(main).maxWidth;
        // main に max-width が設定されていれば header-inner に適用
        if (maxWidth && maxWidth !== 'none') {
            headerInner.style.maxWidth = maxWidth;
        }
    }

    /* グローバルに公開するユーティリティ */
    window.IKLab = { openModal, closeModal, SITE };

    document.addEventListener('DOMContentLoaded', () => {
        buildHeader();
        buildFooter();
        initModals();
        buildGuideLinks();
        syncHeaderToMain();
    });
})();
