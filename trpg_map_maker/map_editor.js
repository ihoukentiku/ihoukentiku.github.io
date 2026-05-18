'use strict';

/* ================================================================
   ヘッダー拡張
   左側: 一覧へ戻る + マップ名表示 + 保存ステータス
   右側: Undo/Redo
   (gridType の切替は新規作成時に baked されるため UI から削除)
================================================================ */
(function injectHeaderExtension() {
    const wait = () => {
        const nav = document.querySelector('.header-nav');
        if (!nav) return requestAnimationFrame(wait);
        const ext = document.createElement('div');
        ext.className = 'header-ext';
        // CSS Grid (auto 1fr auto) で 左=戻る / 中=名前+ステータス / 右=Undo/Redo
        ext.innerHTML = `
            <a href="map_list.html" class="map-back-btn" title="マイマップ一覧へ戻る">
                <span class="material-symbols-outlined">map</span>
                <span>マップ一覧へ戻る</span>
            </a>
            <div class="map-center">
                <span class="map-name-display" id="map-name-display">—</span>
                <span class="save-status saved" id="save-status">保存済み</span>
            </div>
            <div class="map-actions">
                <div class="mode-toggle" role="group" aria-label="編集モード切替">
                    <button type="button" data-mode="simple" class="active" title="シンプルモード">シンプル</button>
                    <button type="button" data-mode="map" title="地図モード">地図</button>
                </div>
                <button id="undo-btn" class="header-icon-btn" disabled title="元に戻す (Ctrl+Z)"><span class="material-symbols-outlined">undo</span></button>
                <button id="redo-btn" class="header-icon-btn" disabled title="やり直し (Ctrl+Shift+Z)"><span class="material-symbols-outlined">redo</span></button>
            </div>
        `;
        ext.querySelector('#undo-btn').addEventListener('click', () => undo());
        ext.querySelector('#redo-btn').addEventListener('click', () => redo());
        ext.querySelectorAll('.mode-toggle button').forEach((btn) => {
            btn.addEventListener('click', () => setEditMode(btn.dataset.mode));
        });
        nav.parentNode.insertBefore(ext, nav);
    };
    wait();
})();

/* ================================================================
   App 状態
================================================================ */
const App = {
    gridType: 'square',
    editMode: 'simple', // 'simple' | 'map' — シンプル/地図モードの切替 (per-map で保存)
    // ---- 地図モード: 地面/壁タブの状態 (Phase B) ----
    groundTool: 'cell', // 'cell' | 'rect'
    groundPattern: { mode: 'solid', id: null, genreId: 'all', solidColor: '#9b8c70' }, // mode: 'solid' | 'pattern'
    wallTool: 'rect', // 'rect' | 'ellipse' | 'line' | 'path' | 'polygon' | 'curve' | 'curve-closed'
    wallPattern: { mode: 'solid', id: null, genreId: 'all', solidColor: '#5a5a5a' },
    wallThickness: 12, // 壁の厚み (px) — シンプルモードの strokeWidth とは別管理
    // ---- 地図モード: 部屋タブ (地面+壁の複合) ----
    roomTool: 'rect', // 'rect' | 'ellipse' | 'polygon' | 'curve-closed'
    roomGroundPattern: { mode: 'solid', id: null, genreId: 'all', solidColor: '#9b8c70' },
    roomWallPattern: { mode: 'solid', id: null, genreId: 'all', solidColor: '#5a5a5a' },
    roomWallThickness: 12,
    roomGroundShadowEnabled: false,
    roomWallShadowEnabled: true,
    // ---- フリーハンド (Fabric brushes 拡張) ----
    freehandBrush: 'pencil', // 'pencil' | 'circle' | 'spray' | 'eraser'
    freehandWidth: 3,
    freehandColor: '#000000', // フリーハンド専用色 (シンプル描画の strokeColor とは独立)
    freehandOpacity: 1,
    freehandDecimation: 4, // 0=無効。fabric.PencilBrush.decimate (px 単位の許容誤差)
    freehandPressure: true, // タブレット圧力検知 (e.pressure)
    _strokePressureMax: 0, // 1ストローク中の最大 pressure
    // ---- 影 (新規描画時に適用、既存オブジェクトは obj.shadow としてそのまま保持)
    //     色/ぼかし/オフセットは地面と壁で共通。on/off だけ別状態。 ----
    groundShadowEnabled: false,
    wallShadowEnabled: true,
    simpleShadowEnabled: false, // シンプルモード (矩形/楕円/線/折線/多角形/曲線/フリーハンド/テキスト/画像/セル) 共通
    shadowColor: '#0000008c', // 不透明度約55% (= 0x8c/0xff)
    shadowBlur: 8,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    strokeLineJoin: 'miter', // 'miter' | 'round' | 'bevel' — 折線/多角形/線継ぎ目
    strokeLineCap: 'butt', // 'butt' | 'round' | 'square' — 線の端
    // ---- パターン共通設定 (地面/壁の Pattern fill/stroke に適用) ----
    patternOffsetX: 0, // 全パターン共通の追加オフセット (px)
    patternOffsetY: 0,
    patternRotation: 0, // 度
    patternScale: 1, // ユーザー指定のカスタム倍率 (PATTERNS[].scale との積で適用)
    activeTool: 'select',
    cellSize: 72,
    canvas: null,
    fillColor: '#4a90c4',
    fillOpacity: 1,
    strokeColor: '#000000',
    strokeOpacity: 1,
    strokeWidth: 2,
    strokeDashArray: null, // null=実線, [10,5]=破線, [2,4]=点線
    cornerRadius: 0,
    gridColor: '#000000ff',
    gridLineWidth: 1,
    gridDashArray: [2, 4], // 点線をデフォルトに
    nextLayerId: 10,
    layerCounters: {}, // 種別ごとのレイヤー連番 { '矩形': 2, 'セル': 1, ... }
    selectedLayerIds: [], // レイヤーパネル上の選択
    lastClickedLayerId: null,
    _drawing: null,
    _pathPoints: [],
    _polygonPoints: [],
    _curvePoints: [],
    _lineStart: null,
    snapEnabled: true,
    snapIntersection: true,
    snapCenter: false,
    snapMidpoint: false,
    _snapPt: null,
    _exportMode: false, // 出力範囲選択モード
    _exportRect: null, // { x, y, w, h } キャンバス座標での出力範囲
    _exportDrag: null, // 1クリック目の開始点
    _shiftHeld: false, // Shift押下中はスナップ一時無効
    // ---- Undo/Redo (A方式: スナップショット) ----
    _historyInitial: null, // 履歴クリア時点のスナップショット (Undo で履歴が尽きた時の戻り先)
    _history: [], // [{ snapshot: string, name: string }, ...] 古い→新しい。各エントリ = 操作"後"の状態
    _redoStack: [], // Undoで取り出したものを積む
    _lastAction: '', // ステータスバー表示用
    _isRestoring: false, // restoreSnapshot 実行中フラグ (履歴ループ防止)
    _historyDebounceTimer: null,
    _historyDebouncePending: '',
    _cellStrokeActive: false, // セル塗りドラッグ中フラグ
    _textEditBefore: null, // テキスト編集前の文字列
    // ---- マップレコード情報 ----
    mapId: null, // 現在編集中のマップの IndexedDB ID
    mapName: '', // マップ名 (ヘッダー表示用)
    mapCreatedAt: null, // ISO 文字列
    // ---- 自動保存 ----
    _autoSaveTimer: null,
    _saveStatus: 'saved', // 'saved' | 'dirty' | 'saving' | 'error'
};

const AUTO_SAVE_DEBOUNCE_MS = 2500;

/* ================================================================
   パターン (地面 / 壁 共通)
   - WebP 画像を patterns/full/ (本番) と patterns/thumb/ (ピッカー用) に置く
   - 各エントリは ground / wall ジャンルを別個に持つ。両方埋めれば共用可能
   - color: 画像が読み込めない/未配置時の単色フォールバック
================================================================ */
const PATTERN_DIR_FULL = 'patterns/full/';
const PATTERN_DIR_THUMB = 'patterns/thumb/';

const GROUND_GENRES = [
    { id: 'all', name: '全て' },
    { id: 'indoor', name: '屋内' },
    { id: 'outdoor', name: '屋外' },
    { id: 'cave', name: '洞窟' },
];
const WALL_GENRES = [
    { id: 'all', name: '全て' },
    { id: 'stone', name: '石壁' },
    { id: 'wood', name: '木壁' },
    { id: 'brick', name: 'レンガ' },
    { id: 'natural', name: '自然' },
];

const PATTERNS = [
    // scale: パターン定義側の初期倍率 (画像 1px → キャンバス scale px)。
    //   最終倍率 = (PATTERNS[].scale) × (App.patternScale ユーザー設定値)
    { id: 'grass', name: '草原', file: 'grass.webp', color: '#4a8c3f', ground: 'outdoor', wall: null, scale: 0.5 },
    { id: 'water', name: '水面', file: 'water.webp', color: '#5ba3cf', ground: 'outdoor', wall: null, scale: 0.5 },
    { id: 'rock', name: '岩', file: '岩.webp', color: '#7a7368', ground: 'cave', wall: 'stone', scale: 0.5 },
    { id: 'rock-moss', name: '岩 (苔)', file: '岩(苔).webp', color: '#6b7a52', ground: 'cave', wall: 'natural', scale: 0.5 },
    { id: 'wood-plank', name: '木板', file: '木板.webp', color: '#8a6a3f', ground: 'indoor', wall: 'wood', scale: 0.5 },
];

/** id からパターン定義を取得する。無ければ null。 */
function getPatternDef(id) {
    return PATTERNS.find((p) => p.id === id) || null;
}

/** 指定カテゴリ ('ground' | 'wall') で使えるパターンだけ抽出する。 */
function patternsForCategory(category) {
    return PATTERNS.filter((p) => p[category]);
}

/* ================================================================
   汎用ヘルパー
================================================================ */

/**
 * #RRGGBB と alpha を rgba() 文字列に変換する。
 * @param {string} hex - #RRGGBB
 * @param {number} a - 0〜1
 * @returns {string} 'rgba(r,g,b,a)'
 */
function rgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

/**
 * 入力座標 (x,y) を最寄りのグリッドスナップ候補 (交点/中心/中点) に丸める。
 * App.snapEnabled が false、または Shift 押下中は null を返す。
 * 候補は現在のズームに依存する閾値内で最も近いものを採用する。
 * @param {number} x - キャンバス座標 X
 * @param {number} y - キャンバス座標 Y
 * @returns {{x:number,y:number}|null} スナップ先、なければ null
 */
function snapToGrid(x, y) {
    if (!App.snapEnabled || App._shiftHeld) return null;
    const thresh = 18 / App.canvas.getZoom();
    const candidates = ga().snapPoints(x, y);
    let best = null,
        bestD = Infinity;
    for (const cand of candidates) {
        if (cand.type === 'intersection' && !App.snapIntersection) continue;
        if (cand.type === 'center' && !App.snapCenter) continue;
        if (cand.type === 'midpoint' && !App.snapMidpoint) continue;
        const d = Math.hypot(cand.x - x, cand.y - y);
        if (d < thresh && d < bestD) {
            bestD = d;
            best = { x: cand.x, y: cand.y };
        }
    }
    return best;
}
/**
 * 折線・多角形・曲線の編集中に、既に打たれた頂点へのスナップを試みる。
 * 主に「始点に戻ってクローズする」操作のために使う。
 * @param {number} x
 * @param {number} y
 * @param {Array<{x:number,y:number}>} points - 既存の頂点列
 * @returns {{x:number,y:number}|null}
 */
function snapToEditPoints(x, y, points) {
    const thresh = 8 / App.canvas.getZoom();
    let best = null,
        bestD = Infinity;
    for (const p of points) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < thresh && d < bestD) {
            bestD = d;
            best = p;
        }
    }
    return best;
}
/**
 * 線スタイル名と線幅から fabric の strokeDashArray を組み立てる。
 * @param {'solid'|'dashed'|'dotted'|'dashdot'|'longdash'} style
 * @param {number} w - 線幅
 * @returns {number[]|null} 実線は null
 */
function getDashArray(style, w) {
    if (style === 'dashed') return [w * 5, w * 3];
    if (style === 'dotted') return [w, w * 2];
    if (style === 'dashdot') return [w * 5, w * 2, w, w * 2];
    if (style === 'longdash') return [w * 10, w * 4];
    return null;
}
/**
 * 入力点列から滑らかなベジェ曲線の SVG path d 文字列を構築する。
 * 各点は2次ベジェの制御点として扱い、中点で連結することで C1 連続を担保する。
 * @param {Array<{x:number,y:number}>} pts
 * @returns {string} SVG path の d 属性 (pts.length<2 のときは空文字)
 */
function buildBezierPath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    if (pts.length === 2) {
        d += ` L ${pts[1].x} ${pts[1].y}`;
    } else {
        for (let i = 1; i < pts.length - 1; i++) {
            const p1 = pts[i],
                p2 = pts[i + 1];
            if (i === pts.length - 2) {
                d += ` Q ${p1.x} ${p1.y}, ${p2.x} ${p2.y}`;
            } else {
                const mx = (p1.x + p2.x) / 2,
                    my = (p1.y + p2.y) / 2;
                d += ` Q ${p1.x} ${p1.y}, ${mx} ${my}`;
            }
        }
    }
    return d;
}
/**
 * 制御点を循環させた滑らかな閉じたベジェパスを SVG d 属性として組み立てる。
 * 始点は pts[0] と pts[1] の中点、各制御点を pts[i]、次のセグメント終点を midpoint(pts[i], pts[i+1 mod n]) として Q コマンドで繋ぎ、末尾を Z で閉じる。
 * @param {{x:number, y:number}[]} pts - 制御点列 (3 点以上)。点数 2 以下は直線フォールバック
 * @returns {string}
 */
function buildClosedBezierPath(pts) {
    const n = pts.length;
    if (n < 2) return '';
    if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y} Z`;
    const m0x = (pts[0].x + pts[1].x) / 2,
        m0y = (pts[0].y + pts[1].y) / 2;
    let d = `M ${m0x} ${m0y}`;
    for (let i = 1; i <= n; i++) {
        const p = pts[i % n];
        const next = pts[(i + 1) % n];
        const mx = (p.x + next.x) / 2,
            my = (p.y + next.y) / 2;
        d += ` Q ${p.x} ${p.y}, ${mx} ${my}`;
    }
    d += ' Z';
    return d;
}
/**
 * キャンバス上のオブジェクトのうち「ユーザー編集対象のレイヤー」だけを z 順 (低→高) で返す。
 * プレビューやスナップマーカーなどの一時オブジェクトは除外される。
 * @returns {fabric.Object[]}
 */
function getMapLayers() {
    return App.canvas.getObjects().filter((o) => o._isMapLayer);
}

/**
 * 現在のツール / 選択状況に応じて、フィル&ストロークセクション・角丸行・スナップ設定セクションの
 * 表示/非表示を更新する。プロパティパネルの状態を一元管理する司令塔。
 */
function updateFillStrokeVisibility() {
    const sub = activeSubtool();
    const drawSubtools = ['cell', 'rect', 'ellipse', 'line', 'path', 'polygon', 'freehand', 'text', 'curve', 'curve-closed'];
    const isGround = App.activeTool === 'ground';
    const isWall = App.activeTool === 'wall';
    const isRoom = App.activeTool === 'room';
    const isSimpleDraw = !isGround && !isWall && !isRoom && drawSubtools.includes(sub);
    const isSelect = App.activeTool === 'select';

    // 各行の表示判定
    // - フィル色 / ストローク色 / 線種: シンプル描画 (色を指定するもの) のみ
    // - 線幅: シンプル描画 + 壁モード描画 (地面は fill のみで stroke 不要)
    // - 角丸: 矩形サブツール (モード問わず)
    const isFreehand = sub === 'freehand';
    // フリーハンドは色 / 線幅 / 線種 等を全て freehand 専用パネル側で持つので、
    // 共通フィル/ストロークセクションは何も表示しない (= 全行 false)。
    let showFillColor = isSimpleDraw && !isFreehand;
    let showStrokeColor = isSimpleDraw && !isFreehand;
    let showStrokeStyle = isSimpleDraw && !isFreehand;
    // 壁モードでは線幅 (strokeWidth) ではなく「壁の厚み」(wallThickness) を出す。
    const showWallThickness = isWall && drawSubtools.includes(sub);
    let showStrokeWidth = isSimpleDraw && !isFreehand;
    let showRadius = sub === 'rect';
    if (isSelect) {
        const activeObjs = App.canvas.getActiveObjects().filter((o) => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer);
        showFillColor = showStrokeColor = showStrokeStyle = showStrokeWidth = activeObjs.length > 0;
        showRadius = activeObjs.some((o) => o.type === 'rect');
    }

    const setDisp = (id, show) => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? '' : 'none';
    };
    setDisp('fill-color-row', showFillColor);
    setDisp('stroke-color-row', showStrokeColor);
    setDisp('stroke-width-row', showStrokeWidth);
    setDisp('wall-thickness-row', showWallThickness);
    setDisp('stroke-style-row', showStrokeStyle);
    setDisp('corner-radius-row', showRadius);
    // セクション全体は中に何か出てれば表示
    const anyRow = showFillColor || showStrokeColor || showStrokeWidth || showWallThickness || showStrokeStyle || showRadius;
    setDisp('fill-stroke-sec', anyRow);
    // タイトル「フィル / ストローク」は色行が出てる時だけ意味があるので隠す/出す
    setDisp('fill-stroke-title', showFillColor || showStrokeColor);

    // スナップ設定: 描画系サブツール (シンプル/地面/壁) で表示。セルは grid 単位なので不要
    const snapSubtools = ['rect', 'ellipse', 'line', 'path', 'polygon', 'curve', 'curve-closed'];
    setDisp('snap-sec', snapSubtools.includes(sub));
    // パターン共通設定: 地面/壁/部屋モードで表示
    setDisp('pattern-transform-sec', isGround || isWall || isRoom);
    // 影セクション: シンプル/地面/壁で表示 (部屋は専用トグルを prop-group 内に持つ)
    setDisp('shadow-sec', isSimpleDraw || isGround || isWall);
    refreshShadowUI();
    // 線継ぎ目 / 線端: ストロークがあるサブツールと同条件、ただしフリーハンドでは出さない
    setDisp('stroke-line-join-row', showStrokeWidth && !isFreehand);
    setDisp('stroke-line-cap-row', showStrokeWidth && !isFreehand);
}

/** 影セクションの on/off トグルを現在の activeTool カテゴリ (シンプル/地面/壁) に合わせて反映する。 */
function refreshShadowUI() {
    const cb = document.getElementById('shadow-enabled');
    if (!cb) return;
    cb.checked = App.activeTool === 'ground' ? !!App.groundShadowEnabled : App.activeTool === 'wall' ? !!App.wallShadowEnabled : !!App.simpleShadowEnabled;
}

/* ================================================================
   Pickr
================================================================ */
let fillPickr, strokePickr, gridPickr;

/**
 * フィル / ストローク / グリッド色の3つのカラーピッカーを生成し、
 * 'save' イベントで App 状態と (選択ツール時は) 選択中オブジェクトの色も同期する。
 */
function initPickr() {
    // interaction は input のみ。確定ボタンは廃止 (外側クリックで閉じる) し、
    // 代わりにスポイトボタンを attachEyedropper で末尾に差し込む。
    const opts = (el, def) => ({
        el,
        theme: 'nano',
        default: def,
        defaultRepresentation: 'HEXA', // 入力欄を常に #RRGGBBAA で表示
        components: { preview: true, opacity: true, hue: true, interaction: { input: true, save: false } },
    });
    // change: ドラッグ中も即時反映 (履歴はデバウンス) + ピッカーボタンの色も同期 (applyColor(true))
    // save: ピッカーを閉じるだけ
    fillPickr = Pickr.create(opts('#fill-color-picker', App.fillColor));
    fillPickr.on('change', (c, _src, instance) => {
        if (!c) return;
        App.fillColor = c.toHEXA().toString().slice(0, 7);
        App.fillOpacity = c.toRGBA()[3];
        instance.applyColor(true); // ボタン色を即時更新 (save イベントは発火しない)
        const fillStr = rgba(App.fillColor, App.fillOpacity);
        // 編集中テキストで選択範囲があれば、選択部分のみに適用 (テキストツール時)
        const textTarget = getTextStyleTarget();
        if (textTarget && textTarget.selStart !== undefined) {
            applyTextStyle({ fill: fillStr });
            pushHistoryDebounced('テキスト色を変更');
            return;
        }
        if (App.activeTool === 'select') {
            const targets = App.canvas.getActiveObjects().filter((o) => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer);
            if (targets.length === 0) return;
            targets.forEach((o) => o.set({ fill: fillStr }));
            App.canvas.renderAll();
            pushHistoryDebounced('フィル色を変更');
        }
    });

    strokePickr = Pickr.create(opts('#stroke-color-picker', App.strokeColor));
    strokePickr.on('change', (c, _src, instance) => {
        if (!c) return;
        App.strokeColor = c.toHEXA().toString().slice(0, 7);
        App.strokeOpacity = c.toRGBA()[3];
        instance.applyColor(true);
        if (App.activeTool === 'select') {
            const targets = App.canvas.getActiveObjects().filter((o) => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer);
            if (targets.length === 0) return;
            targets.forEach((o) => o.set({ stroke: rgba(App.strokeColor, App.strokeOpacity) }));
            App.canvas.renderAll();
            pushHistoryDebounced('ストローク色を変更');
        }
    });

    gridPickr = Pickr.create(opts('#grid-color-picker', App.gridColor || '#000000ff'));
    gridPickr.on('change', (c, _src, instance) => {
        if (!c) return;
        App.gridColor = c.toHEXA().toString(); // #rrggbbaa (alpha 含む hex)
        instance.applyColor(true);
        drawGrid();
    });

    // 影 色ピッカー — App.shadowColor を更新するだけ (新規描画時に反映、地面/壁共通)
    let wsp = null;
    const wallShadowEl = document.getElementById('shadow-color');
    if (wallShadowEl) {
        wsp = Pickr.create(opts('#shadow-color', App.shadowColor));
        wsp.on('change', (c, _src, instance) => {
            if (!c) return;
            App.shadowColor = c.toHEXA().toString();
            instance.applyColor(true);
        });
        attachEyedropper(wsp);
    }
    // フリーハンド専用色 (シンプルの strokeColor とは独立)
    let fhp = null;
    const fhEl = document.getElementById('freehand-color-picker');
    if (fhEl) {
        fhp = Pickr.create(opts('#freehand-color-picker', App.freehandColor || '#000000'));
        fhp.on('change', (c, _src, instance) => {
            if (!c) return;
            App.freehandColor = c.toHEXA().toString().slice(0, 7);
            App.freehandOpacity = c.toRGBA()[3];
            instance.applyColor(true);
            syncFreehandBrushProps();
        });
        attachEyedropper(fhp);
    }
    // 既存ピッカーにスポイトボタンを追加 (fill / stroke / grid)
    attachEyedropper(fillPickr);
    attachEyedropper(strokePickr);
    attachEyedropper(gridPickr);
    // 入力欄の表示フォーマットを強制 HEXA (Pickr の defaultRepresentation オプションだけでは
    // 効かないことがあるので post-create で setColorRepresentation を呼ぶ)
    [fillPickr, strokePickr, gridPickr, wsp, fhp].forEach((p) => {
        if (p?.setColorRepresentation) p.setColorRepresentation('HEXA');
    });
}

/**
 * Pickr の interaction 行 (確定ボタンがあった場所) にスポイトボタンを差し込む。
 * クリックでブラウザ標準の EyeDropper API を起動し、画面上から色をピックして反映する。
 * 非対応ブラウザ (Firefox / Safari) では何もしない。
 * @param {Pickr} pickr
 */
function attachEyedropper(pickr) {
    if (!pickr || typeof window.EyeDropper === 'undefined') return;
    const root = pickr.getRoot();
    const interaction = root?.app?.querySelector?.('.pcr-interaction') || root?.interaction?.input?.parentElement;
    if (!interaction || interaction.querySelector('.pcr-eyedropper')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pcr-eyedropper';
    btn.title = '画面から色を抽出 (スポイト)';
    btn.innerHTML = '<span class="material-symbols-outlined">colorize</span>';
    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
            const result = await new window.EyeDropper().open();
            const hex8 = result.sRGBHex.toUpperCase() + 'FF';
            pickr.setColor(hex8);
            // setColor だけだと透明度スライダ位置が元のまま残るブラウザ実装があるので、
            // setHSVA で alpha=1 を直接書き戻してスライダ位置も同期する。
            const c = pickr.getColor();
            if (c) pickr.setHSVA(c.h, c.s, c.v, 1, false);
            pickr.setColorRepresentation('HEXA');
        } catch (_) {
            // ユーザー Esc キャンセル等 — 何もしない
        }
    });
    interaction.appendChild(btn);
}

/* ================================================================
   キャンバス初期化
================================================================ */
/**
 * Fabric.js キャンバスを生成し、ズーム・パン・各種マウス/キーボードハンドラを登録する。
 * mouse:down 内でアクティブツールごとに分岐し、各描画モードの 1/2 クリック挙動をここで定義する。
 * mouse:move / up でプレビューと確定処理を行い、selection:* でレイヤーパネル同期を行う。
 */
function initCanvas() {
    const area = document.getElementById('canvas-area');
    const c = document.getElementById('main-canvas');
    c.width = area.clientWidth;
    c.height = area.clientHeight;

    App.canvas = new fabric.Canvas('main-canvas', {
        selection: true,
        preserveObjectStacking: true,
        stopContextMenu: true,
        fireRightClick: true,
        fireMiddleClick: true, // マウスホイールクリックのパン用
        // 選択ツール時にオブジェクト上ホバー=grab、ドラッグ中=grabbing
        // (オブジェクトが selectable=false の他ツール時は hoverCursor は発火しないので defaultCursor が見える)
        hoverCursor: 'grab',
        moveCursor: 'grabbing',
    });
    App.canvas.setWidth(area.clientWidth);
    App.canvas.setHeight(area.clientHeight);

    const vpt = App.canvas.viewportTransform;
    vpt[4] = Math.round(area.clientWidth / 2);
    vpt[5] = Math.round(area.clientHeight / 2);
    App.canvas.setViewportTransform(vpt);

    // ズーム
    App.canvas.on('mouse:wheel', function (opt) {
        let zoom = App.canvas.getZoom() * 0.999 ** opt.e.deltaY;
        zoom = Math.min(20, Math.max(0.05, zoom));
        App.canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        opt.e.preventDefault();
        opt.e.stopPropagation();
        drawGrid();
        updateStatusBar();
    });

    // パン
    let isPanning = false,
        panX = 0,
        panY = 0,
        spaceHeld = false;
    // 中クリック (マウスホイールクリック) でブラウザのオートスクロールが発動しないよう
    // canvas-area の mousedown で preventDefault しておく。
    document.getElementById('canvas-area').addEventListener('mousedown', (e) => {
        if (e.button === 1) e.preventDefault();
    });
    document.addEventListener('keydown', (e) => {
        // 入力フィールド (input/textarea/contenteditable) や Fabric テキスト編集中はパン用 Space を無効化
        const t = e.target;
        const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        const editingText = App.canvas?.getActiveObject?.()?.isEditing;
        if (e.code === 'Space' && !e.repeat && !inField && !editingText) {
            spaceHeld = true;
            e.preventDefault();
        }
        if (e.key === 'Shift') App._shiftHeld = true;
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') spaceHeld = false;
        if (e.key === 'Shift') App._shiftHeld = false;
    });

    App.canvas.on('mouse:down', function (opt) {
        const e = opt.e,
            ptr = App.canvas.getPointer(e);

        // 右クリック → コンテキストメニュー
        if (e.button === 2) {
            e.preventDefault();
            if (opt.target && opt.target._isMapLayer) {
                App.canvas.setActiveObject(opt.target);
                showContextMenu(e.clientX, e.clientY, opt.target);
            } else {
                hideContextMenu();
            }
            return;
        }

        hideContextMenu();

        // パン (Alt / Space / マウスホイールクリック=middle button)
        if (e.altKey || spaceHeld || e.button === 1) {
            isPanning = true;
            panX = e.clientX;
            panY = e.clientY;
            App.canvas.selection = false;
            App.canvas.defaultCursor = 'move';
            App.canvas.setCursor('move');
            return;
        }

        // 出力範囲選択モード（アクティブツールに関係なく動作）
        if (App._exportMode) {
            const pt = snapToGrid(ptr.x, ptr.y) || ptr;
            if (!App._exportDrag) {
                App._exportDrag = { startX: pt.x, startY: pt.y };
                App._exportRect = null;
            } else {
                const d = App._exportDrag;
                App._exportRect = {
                    x: Math.min(d.startX, pt.x),
                    y: Math.min(d.startY, pt.y),
                    w: Math.abs(pt.x - d.startX),
                    h: Math.abs(pt.y - d.startY),
                };
                App._exportDrag = null;
                App._exportMode = false;
                App.canvas.defaultCursor = defaultCursorForTool(App.activeTool);
                if (App._exportRect.w < 5 || App._exportRect.h < 5) {
                    App._exportRect = null;
                }
                App.canvas.requestRenderAll();
                if (App._exportRect) openExportModal();
            }
            return;
        }

        // ツール別 — activeSubtool() で「シンプル/地面/壁」共通のサブツール名にディスパッチ
        switch (activeSubtool()) {
            case 'rect':
            case 'ellipse': {
                const pt = snapToGrid(ptr.x, ptr.y) || ptr;
                if (!App._drawing) {
                    // 1クリック目: 開始点を記録
                    App._drawing = { startX: pt.x, startY: pt.y, obj: null };
                } else {
                    // 2クリック目: 確定
                    const d = App._drawing;
                    const w = Math.abs(pt.x - d.startX),
                        h = Math.abs(pt.y - d.startY);
                    if (w > 2 && h > 2) {
                        removePreview();
                        const style = getCurrentDrawStyle();
                        const left = Math.min(d.startX, pt.x),
                            top = Math.min(d.startY, pt.y);
                        const subtool = activeSubtool();
                        if (App.activeTool === 'room') {
                            addRoom(
                                '部屋_' + (subtool === 'rect' ? '矩形' : '楕円'),
                                (st) => {
                                    // stroke を持つ壁のみオフセット補正 (fabric は bbox に stroke を含むため)。
                                    // 地面 (strokeWidth=0) はオフセット 0 で純粋な矩形/楕円のまま。
                                    const hsw = (st.strokeWidth || 0) / 2;
                                    return subtool === 'rect'
                                        ? new fabric.Rect({
                                              left: left - hsw,
                                              top: top - hsw,
                                              width: w,
                                              height: h,
                                              rx: App.cornerRadius,
                                              ry: App.cornerRadius,
                                              ...st,
                                              objectCaching: false,
                                          })
                                        : new fabric.Ellipse({
                                              left: left - hsw,
                                              top: top - hsw,
                                              rx: w / 2,
                                              ry: h / 2,
                                              ...st,
                                              objectCaching: false,
                                          });
                                }
                            );
                        } else {
                            const hsw = style.strokeWidth / 2;
                            const obj =
                                subtool === 'rect'
                                    ? new fabric.Rect({
                                          left: left - hsw,
                                          top: top - hsw,
                                          width: w,
                                          height: h,
                                          rx: App.cornerRadius,
                                          ry: App.cornerRadius,
                                          fill: style.fill,
                                          stroke: style.stroke,
                                          strokeWidth: style.strokeWidth,
                                          strokeDashArray: style.strokeDashArray,
                                          objectCaching: false,
                                      })
                                    : new fabric.Ellipse({
                                          left: left - hsw,
                                          top: top - hsw,
                                          rx: w / 2,
                                          ry: h / 2,
                                          fill: style.fill,
                                          stroke: style.stroke,
                                          strokeWidth: style.strokeWidth,
                                          strokeDashArray: style.strokeDashArray,
                                          objectCaching: false,
                                      });
                            addCategoryLayer(style.namePrefix + (subtool === 'rect' ? '矩形' : '楕円'), obj, style.flag);
                        }
                    }
                    App._drawing = null;
                }
                break;
            }
            case 'line': {
                const pt = snapToGrid(ptr.x, ptr.y) || ptr;
                if (!App._lineStart) {
                    App._lineStart = pt;
                } else {
                    const style = getCurrentDrawStyle();
                    // fabric.Line の _getNonTransformedDimensions は strokeLineCap='butt' のときだけ、
                    // 軸方向に揃った線の「平行軸」の dim からストロークを差し引く特別処理がある。
                    //   butt + 水平線 (height==0): dim.x から stroke 減 → left 補正不要、top のみ補正
                    //   butt + 垂直線 (width==0):  dim.y から stroke 減 → top 補正不要、left のみ補正
                    //   butt + 斜め線 / round / square: 両軸とも dim にストローク含む → 両軸補正
                    const x1 = App._lineStart.x,
                        y1 = App._lineStart.y,
                        x2 = pt.x,
                        y2 = pt.y;
                    const hsw = (style.strokeWidth || 0) / 2;
                    const cap = App.strokeLineCap || 'butt';
                    const isButt = cap === 'butt';
                    const lcorr = isButt && y1 === y2 ? 0 : hsw; // butt の水平線のみ left 補正不要
                    const tcorr = isButt && x1 === x2 ? 0 : hsw; // butt の垂直線のみ top 補正不要
                    const line = new fabric.Line([x1, y1, x2, y2], {
                        left: Math.min(x1, x2) - lcorr,
                        top: Math.min(y1, y2) - tcorr,
                        stroke: style.stroke,
                        strokeWidth: style.strokeWidth,
                        strokeLineCap: cap,
                        strokeDashArray: style.strokeDashArray,
                        fill: null,
                        selectable: false,
                        evented: false,
                        objectCaching: false,
                    });
                    addCategoryLayer(style.namePrefix + '直線', line, style.flag);
                    removePreview();
                    App._lineStart = null;
                }
                break;
            }
            case 'path': {
                const raw = snapToGrid(ptr.x, ptr.y) || ptr;
                const pt = snapToEditPoints(ptr.x, ptr.y, App._pathPoints) || raw;
                App._pathPoints.push({ x: pt.x, y: pt.y });
                break;
            }
            case 'polygon': {
                const raw = snapToGrid(ptr.x, ptr.y) || ptr;
                const pt = snapToEditPoints(ptr.x, ptr.y, App._polygonPoints) || raw;
                App._polygonPoints.push({ x: pt.x, y: pt.y });
                break;
            }
            case 'curve':
            case 'curve-closed': {
                const raw = snapToGrid(ptr.x, ptr.y) || ptr;
                const pt = snapToEditPoints(ptr.x, ptr.y, App._curvePoints) || raw;
                App._curvePoints.push({ x: pt.x, y: pt.y });
                break;
            }
            case 'cell': {
                const cellAddr = ga().pxToCell(ptr.x, ptr.y);
                const tool = document.querySelector('#cell-tool-tiles .tool-tile.active')?.dataset.cellTool || 'pen';
                if (App.activeTool === 'ground') {
                    if (tool === 'fill') {
                        const layer = getOrCreateGroundCellLayer();
                        if (!App.selectedLayerIds.includes(layer._layerId)) {
                            App.selectedLayerIds = [layer._layerId];
                            renderLayerList();
                        }
                        fillCells(cellAddr.col, cellAddr.row, layer, getGroundFill());
                    } else {
                        App._cellStrokeActive = true;
                        App._cellStrokeCategory = 'ground';
                        handleGroundCellPaint(cellAddr.col, cellAddr.row, tool);
                        App._drawing = { cellTool: 'ground-' + tool };
                    }
                } else {
                    if (tool === 'fill') {
                        const layer = getOrCreateCellLayer();
                        if (!App.selectedLayerIds.includes(layer._layerId)) {
                            App.selectedLayerIds = [layer._layerId];
                            renderLayerList();
                        }
                        fillCells(cellAddr.col, cellAddr.row, layer);
                    } else {
                        App._cellStrokeActive = true;
                        App._cellStrokeCategory = 'simple';
                        handleCellPaint(cellAddr.col, cellAddr.row, tool);
                        App._drawing = { cellTool: tool };
                    }
                }
                break;
            }
            case 'text': {
                // 既存テキストをクリックしたらそれを編集 (新規作成しない)
                // ※ setActiveTool で _isMapText だけは evented を残してある
                if (opt.target && opt.target._isMapText) {
                    App.canvas.setActiveObject(opt.target);
                    opt.target.enterEditing();
                    App.canvas.renderAll();
                    return;
                }
                const font = document.getElementById('text-font')?.value || 'Zen Kaku Gothic New';
                const size = parseInt(document.getElementById('text-size')?.value) || 48;
                // 空の Textbox を作成、originY='center' でクリック点を左辺中央に
                // 編集モードに入った瞬間からユーザーが直接タイプ可能
                const tb = new fabric.Textbox('', {
                    left: ptr.x,
                    top: ptr.y,
                    originX: 'left',
                    originY: 'center',
                    // 入力された文字幅にぴったり追従させたいので最小幅から始める。
                    // fabric.Textbox は内部的に minWidth まで自動で広がる。
                    width: 1,
                    minWidth: 1,
                    splitByGrapheme: false,
                    fontFamily: font,
                    fontSize: size,
                    fill: rgba(App.fillColor, App.fillOpacity),
                    stroke: App.strokeWidth > 0 ? rgba(App.strokeColor, App.strokeOpacity) : null,
                    strokeWidth: App.strokeWidth > 0 ? App.strokeWidth : 0,
                    editable: true,
                    objectCaching: false,
                    _isMapText: true,
                    cursorColor: 'black',
                    cursorWidth: 3,
                    selectionColor: 'rgba(0,229,255,0.35)',
                });
                addLayerObject('テキスト', tb);
                App.canvas.setActiveObject(tb);
                tb.enterEditing();
                App.canvas.renderAll();
                break;
            }
        }
    });

    App.canvas.on('mouse:move', function (opt) {
        const ptr = App.canvas.getPointer(opt.e);
        {
            const ca = ga().pxToCell(ptr.x, ptr.y);
            document.getElementById('sb-coord').textContent = ga().formatCoord(ca.col, ca.row);
        }

        if (isPanning) {
            App._snapPt = null;
            const v = App.canvas.viewportTransform;
            v[4] = Math.round(v[4] + opt.e.clientX - panX);
            v[5] = Math.round(v[5] + opt.e.clientY - panY);
            panX = opt.e.clientX;
            panY = opt.e.clientY;
            App.canvas.requestRenderAll();
            drawGrid();
            return;
        }

        // スナップ先を計算（水色マーカー用 — スナップ対応ツールのみ）
        {
            // セルツールは grid 単位の塗りなのでスナップマーカーは不要
            const _snapSubtools = ['rect', 'ellipse', 'line', 'path', 'polygon', 'curve', 'curve-closed'];
            const _needSnap = _snapSubtools.includes(activeSubtool()) || App._exportMode;
            if (_needSnap) {
                const _sub = activeSubtool();
                const _editPts = _sub === 'path' ? App._pathPoints : _sub === 'polygon' ? App._polygonPoints : _sub === 'curve' || _sub === 'curve-closed' ? App._curvePoints : [];
                const _raw = snapToGrid(ptr.x, ptr.y);
                App._snapPt = snapToEditPoints(ptr.x, ptr.y, _editPts) || _raw || null;
            } else {
                App._snapPt = null;
            }
            App.canvas.requestRenderAll();
        }

        // プレビュー用のスタイル — ground/wall は pattern fill のため opacity を弄らず style そのまま、
        // simple モードは従来通り半透明にする
        const _previewStyle = (() => {
            const s = getCurrentDrawStyle();
            const base =
                App.activeTool === 'ground' || App.activeTool === 'wall' || App.activeTool === 'room'
                    ? s
                    : {
                          ...s,
                          fill: rgba(App.fillColor, App.fillOpacity * 0.5),
                          stroke: rgba(App.strokeColor, App.strokeOpacity * 0.5),
                          fillSoft: rgba(App.fillColor, App.fillOpacity * 0.3),
                      };
            // 線継ぎ目 / 線端 もプレビューに反映 (本体と同じ挙動を見せる)
            base.strokeLineJoin = App.strokeLineJoin || 'miter';
            base.strokeLineCap = App.strokeLineCap || 'butt';
            return base;
        })();
        const _previewStrokeMod = {
            strokeLineJoin: _previewStyle.strokeLineJoin,
            strokeLineCap: _previewStyle.strokeLineCap,
        };

        // 矩形/楕円プレビュー（1クリック後、マウス追従）
        const _sub = activeSubtool();
        if (App._drawing && (_sub === 'rect' || _sub === 'ellipse')) {
            const pt = snapToGrid(ptr.x, ptr.y) || ptr;
            const d = App._drawing;
            const left = Math.min(d.startX, pt.x),
                top = Math.min(d.startY, pt.y);
            const w = Math.abs(pt.x - d.startX),
                h = Math.abs(pt.y - d.startY);
            removePreview();
            if (w > 0 || h > 0) {
                const hsw = _previewStyle.strokeWidth / 2;
                const preview =
                    _sub === 'rect'
                        ? new fabric.Rect({
                              left: left - hsw,
                              top: top - hsw,
                              width: w,
                              height: h,
                              rx: App.cornerRadius,
                              ry: App.cornerRadius,
                              fill: _previewStyle.fill,
                              stroke: _previewStyle.stroke,
                              strokeWidth: _previewStyle.strokeWidth,
                              strokeDashArray: _previewStyle.strokeDashArray,
                              ..._previewStrokeMod,
                              selectable: false,
                              evented: false,
                              objectCaching: false,
                              isPreview: true,
                          })
                        : new fabric.Ellipse({
                              left: left - hsw,
                              top: top - hsw,
                              rx: w / 2,
                              ry: h / 2,
                              fill: _previewStyle.fill,
                              stroke: _previewStyle.stroke,
                              strokeWidth: _previewStyle.strokeWidth,
                              strokeDashArray: _previewStyle.strokeDashArray,
                              ..._previewStrokeMod,
                              selectable: false,
                              evented: false,
                              objectCaching: false,
                              isPreview: true,
                          });
                applyPatternOriginLive(preview);
                App.canvas.add(preview);
            }
            App.canvas.renderAll();
        }

        // 直線プレビュー (本体と同じ left/top 補正ロジック)
        if (_sub === 'line' && App._lineStart) {
            const pt = snapToGrid(ptr.x, ptr.y) || ptr;
            removePreview();
            const x1 = App._lineStart.x,
                y1 = App._lineStart.y,
                x2 = pt.x,
                y2 = pt.y;
            const phsw = (_previewStyle.strokeWidth || 0) / 2;
            const pIsButt = _previewStrokeMod.strokeLineCap === 'butt';
            const plcorr = pIsButt && y1 === y2 ? 0 : phsw;
            const ptcorr = pIsButt && x1 === x2 ? 0 : phsw;
            const __linePreview = new fabric.Line([x1, y1, x2, y2], {
                left: Math.min(x1, x2) - plcorr,
                top: Math.min(y1, y2) - ptcorr,
                stroke: _previewStyle.stroke,
                strokeWidth: _previewStyle.strokeWidth,
                strokeDashArray: _previewStyle.strokeDashArray,
                ..._previewStrokeMod,
                selectable: false,
                evented: false,
                isPreview: true,
                objectCaching: false,
            });
            applyPatternOriginLive(__linePreview);
            App.canvas.add(__linePreview);
            App.canvas.renderAll();
        }

        // 折線プレビュー
        if (_sub === 'path' && App._pathPoints.length > 0) {
            const raw = snapToGrid(ptr.x, ptr.y) || ptr;
            const pt = snapToEditPoints(ptr.x, ptr.y, App._pathPoints) || raw;
            removePreview();
            const __polyPreview = new fabric.Polyline([...App._pathPoints, pt], {
                stroke: _previewStyle.stroke,
                strokeWidth: _previewStyle.strokeWidth,
                strokeDashArray: _previewStyle.strokeDashArray,
                ..._previewStrokeMod,
                fill: '',
                selectable: false,
                evented: false,
                isPreview: true,
                objectCaching: false,
            });
            applyPatternOriginLive(__polyPreview);
            App.canvas.add(__polyPreview);
            App.canvas.renderAll();
        }

        // 多角形プレビュー
        if (_sub === 'polygon' && App._polygonPoints.length > 0) {
            const raw = snapToGrid(ptr.x, ptr.y) || ptr;
            const pt = snapToEditPoints(ptr.x, ptr.y, App._polygonPoints) || raw;
            removePreview();
            const __polygonPreview = new fabric.Polygon([...App._polygonPoints, pt], {
                stroke: _previewStyle.stroke,
                strokeWidth: _previewStyle.strokeWidth,
                strokeDashArray: _previewStyle.strokeDashArray,
                ..._previewStrokeMod,
                fill: _previewStyle.fillSoft || _previewStyle.fill,
                selectable: false,
                evented: false,
                isPreview: true,
                objectCaching: false,
            });
            applyPatternOriginLive(__polygonPreview);
            App.canvas.add(__polygonPreview);
            App.canvas.renderAll();
        }

        // 曲線プレビュー (開/閉共通)
        if ((_sub === 'curve' || _sub === 'curve-closed') && App._curvePoints.length > 0) {
            const raw = snapToGrid(ptr.x, ptr.y) || ptr;
            const pt = snapToEditPoints(ptr.x, ptr.y, App._curvePoints) || raw;
            removePreview();
            const previewPts = [...App._curvePoints, pt];
            const closed = _sub === 'curve-closed';
            const d = closed ? buildClosedBezierPath(previewPts) : buildBezierPath(previewPts);
            if (d) {
                const __curvePreview = new fabric.Path(d, {
                    stroke: _previewStyle.stroke,
                    strokeWidth: _previewStyle.strokeWidth,
                    strokeDashArray: _previewStyle.strokeDashArray,
                    ..._previewStrokeMod,
                    fill: closed ? _previewStyle.fillSoft || _previewStyle.fill : '',
                    selectable: false,
                    evented: false,
                    isPreview: true,
                    objectCaching: false,
                });
                applyPatternOriginLive(__curvePreview);
                App.canvas.add(__curvePreview);
            }
            App.canvas.renderAll();
        }

        // 出力範囲プレビュー（exportモード、1クリック後のマウス追従）
        if (App._exportMode && App._exportDrag) {
            const ep = snapToGrid(ptr.x, ptr.y) || ptr;
            const d = App._exportDrag;
            App._exportRect = {
                x: Math.min(d.startX, ep.x),
                y: Math.min(d.startY, ep.y),
                w: Math.abs(ep.x - d.startX),
                h: Math.abs(ep.y - d.startY),
            };
            App.canvas.requestRenderAll();
        }

        // セル塗り（ドラッグ） — シンプル/地面で塗り先レイヤーが異なる
        if (App._drawing && (App.activeTool === 'cell' || (App.activeTool === 'ground' && (App._drawing.cellTool === 'ground-pen' || App._drawing.cellTool === 'ground-eraser')))) {
            const ca = ga().pxToCell(ptr.x, ptr.y);
            if (App._drawing.cellTool === 'ground-pen') {
                handleGroundCellPaint(ca.col, ca.row, 'pen');
            } else if (App._drawing.cellTool === 'ground-eraser') {
                handleGroundCellPaint(ca.col, ca.row, 'eraser');
            } else {
                handleCellPaint(ca.col, ca.row, App._drawing.cellTool);
            }
        }
    });

    App.canvas.on('mouse:up', function () {
        if (isPanning) {
            isPanning = false;
            App.canvas.selection = App.activeTool === 'select';
            App.canvas.defaultCursor = defaultCursorForTool(App.activeTool);
            return;
        }
        if (App._drawing && (App.activeTool === 'cell' || (App.activeTool === 'ground' && (App._drawing.cellTool === 'ground-pen' || App._drawing.cellTool === 'ground-eraser')))) {
            App._drawing = null;
        }
        if (App._cellStrokeActive) {
            const cat = App._cellStrokeCategory === 'ground' ? '地面_セル' : 'セル';
            const layer = App._cellStrokeCategory === 'ground'
                ? getMapLayers().reverse().find((o) => o._isCellLayer && o._isGroundLayer && App.selectedLayerIds.includes(o._layerId))
                : getMapLayers().reverse().find((o) => o._isCellLayer && !o._isGroundLayer && App.selectedLayerIds.includes(o._layerId));
            App._cellStrokeActive = false;
            App._cellStrokeCategory = null;
            if (layer) commitCellLayer(layer);
            pushHistory(`${cat}塗り`);
        }
    });

    App.canvas.on('text:editing:entered', function (opt) {
        App._textEditBefore = opt.target?.text ?? null;
        refreshTextStyleButtons();
        syncTextInputsFromTarget();
    });
    App.canvas.on('text:editing:exited', function (opt) {
        const t = opt.target;
        const before = App._textEditBefore;
        App._textEditBefore = null;
        if (t?._isMapText && t.text.trim() === '') {
            App.canvas.remove(t);
            App.canvas.discardActiveObject();
            renderLayerList();
            App.canvas.renderAll();
            if (before !== null && before !== '') pushHistory('テキストを削除');
            refreshTextStyleButtons();
            return;
        }
        renderLayerList();
        App.canvas.renderAll();
        if (before !== null && t && before !== t.text) pushHistory('テキスト編集');
        refreshTextStyleButtons();
    });
    // テキスト編集中の選択範囲が変わったらスタイルボタンの active 表示を更新
    App.canvas.on('text:selection:changed', function () {
        refreshTextStyleButtons();
        syncTextInputsFromTarget();
    });

    App.canvas.on('selection:created', () => {
        syncLayerSelectionFromCanvas();
        updateSelectionInfo();
    });
    App.canvas.on('selection:updated', () => {
        syncLayerSelectionFromCanvas();
        updateSelectionInfo();
    });
    App.canvas.on('selection:cleared', () => {
        App.selectedLayerIds = [];
        renderLayerList();
        updateSelectionInfo();
    });
    App.canvas.on('object:modified', function (opt) {
        updateSelectionInfo();
        const t = opt.target;
        // セルレイヤー: 累積シフトを _cellData の col/row に反映し、commit で Path 再生成。
        // 位置 (left/top) は commit 後の bbox で再決定されるのでリセット。
        if (t && t._isCellLayer && t._snapAccum) {
            const { colDelta, rowDelta } = t._snapAccum;
            if (colDelta !== 0 || rowDelta !== 0) {
                const newMap = new Map();
                for (const e of t._cellData.values()) {
                    e.col += colDelta;
                    e.row += rowDelta;
                    newMap.set(`${e.col},${e.row}`, e);
                }
                t._cellData = newMap;
                commitCellLayer(t);
            }
            t._snapStart = undefined;
            t._snapAccum = undefined;
        }
        if (t) applyPatternOrigin(t);
        // 移動・リサイズ・回転の確定で履歴を積む (テキスト編集による modified は無視)
        if (App._isRestoring) return;
        if (!t || (t._isMapText && t.isEditing)) return;
        const name = t?._layerName || 'オブジェクト';
        pushHistory(`${name}を変更`);
    });
    App.canvas.on('object:moving', function (opt) {
        const obj = opt.target;
        // セルレイヤーは grid 単位にしか動かさない (回転/拡縮はロック済み)
        if (obj && obj._isCellLayer) {
            if (obj._snapStart === undefined) {
                obj._snapStart = { left: obj.left, top: obj.top };
            }
            const adapter = ga();
            const dx = obj.left - obj._snapStart.left;
            const dy = obj.top - obj._snapStart.top;
            const s = adapter.snapDelta(dx, dy);
            obj.set({ left: obj._snapStart.left + s.snappedDx, top: obj._snapStart.top + s.snappedDy });
            obj._snapAccum = s; // commit (object:modified) で利用
            return;
        }
        if (App.snapEnabled) {
            const snapped = snapToGrid(obj.left, obj.top);
            if (snapped) obj.set({ left: snapped.x, top: snapped.y });
        }
        // 移動中もパターン原点を維持 (世界 (0,0) アンカー)
        applyPatternOrigin(obj);
    });
    App.canvas.on('path:created', (opt) => {
        if (!opt.path) return;
        const path = opt.path;
        path.set({ selectable: false, evented: false });
        const isEraser = App.canvas.freeDrawingBrush?._isEraser;
        if (isEraser) {
            // 消しゴム: 親フリーハンドレイヤー内に destination-out で追加 → そのレイヤー内だけ消える。
            // (group の objectCaching が ON なので合成はキャッシュ canvas 内で完結)
            // ★ stroke は不透明にしないと destination-out が部分的にしか効かず、消し跡が半透明に残る。
            //   プレビュー用 brush.color (半透明赤) が path にコピーされるので、ここで上書きする。
            path.set({ globalCompositeOperation: 'destination-out', stroke: 'rgba(0,0,0,1)', opacity: 1 });
        }
        // 単体 fabric.Path は canvas に既に add されているので、レイヤー化する前に一旦除外
        App.canvas.remove(path);
        const layer = getOrCreateFreehandLayer();
        layer.addWithUpdate(path);
        if (!App.selectedLayerIds.includes(layer._layerId)) {
            App.selectedLayerIds = [layer._layerId];
            renderLayerList();
        }
        App.canvas.renderAll();
        pushHistory(isEraser ? '消しゴム' : 'フリーハンドを追加');
    });

    window.addEventListener('resize', () => {
        App.canvas.setWidth(area.clientWidth);
        App.canvas.setHeight(area.clientHeight);
        drawGrid();
    });
    App.canvas.on('mouse:out', () => {
        App._snapPt = null;
        App.canvas.requestRenderAll();
    });

    _initGridRenderer();
    updateStatusBar();
}

/** 描画途中のプレビュー用オブジェクト (isPreview フラグ付き) を全て除去する。 */
function removePreview() {
    App.canvas
        .getObjects()
        .filter((o) => o.isPreview)
        .forEach((o) => App.canvas.remove(o));
}

/* ================================================================
   グリッド（after:renderで直接描画 — Fabricオブジェクト不使用）
================================================================ */
/**
 * グリッド再描画をトリガする。実描画は after:render フック内で行われるため、
 * ここでは requestRenderAll を呼ぶだけ。設定変更時に呼び出す。
 */
function drawGrid() {
    // after:render フックで自動描画されるため renderAll を呼ぶだけでよい
    if (App.canvas) App.canvas.requestRenderAll();
}

/**
 * Fabric の `after:render` を1回だけ購読し、フレーム末尾に以下を直接 Canvas 2D に描画する:
 *   1. チェッカーボード背景のビューポート追従
 *   2. グリッド線 (ビューポート可視範囲のみ)
 *   3. 出力範囲モード時の暗幕とハイライト枠
 *   4. スナップ先マーカー
 * Fabric オブジェクト化しないことで大量のグリッド線でも軽量に保つ。
 */
function _initGridRenderer() {
    const area = document.getElementById('canvas-area');
    App.canvas.on('after:render', function () {
        const vpt = App.canvas.viewportTransform;
        const zoom = App.canvas.getZoom();

        // チェッカーボード背景をビューポートに追従させる
        const S = 18 * zoom;
        const ox = ((vpt[4] % S) + S) % S;
        const oy = ((vpt[5] % S) + S) % S;
        area.style.backgroundSize = `${S}px ${S}px`;
        area.style.backgroundPosition = `${ox}px ${oy}px`;
        const cw = App.canvas.getWidth(),
            ch = App.canvas.getHeight(),
            cs = App.cellSize;
        const wl = -vpt[4] / zoom,
            wt = -vpt[5] / zoom,
            wr = wl + cw / zoom,
            wb = wt + ch / zoom;

        const ctx = App.canvas.getContext();
        ctx.save();
        ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
        ctx.strokeStyle = App.gridColor;
        ctx.lineWidth = App.gridLineWidth;
        ctx.setLineDash(App.gridDashArray || []);
        // グリッド線描画は gridType ごとに差し替え可能 — GridAdapter に委譲
        ga().drawGridLines(ctx, { wl, wt, wr, wb, zoom });
        ctx.restore();

        // 出力モード: キャンバス全体を暗く、選択範囲だけ明るく
        if (App._exportMode) {
            ctx.save();
            ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
            const r = App._exportRect;
            if (r && r.w > 0 && r.h > 0) {
                // 範囲外を暗くする
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.beginPath();
                ctx.rect(wl - cs, wt - cs, wr - wl + cs * 2, r.y - wt + cs);
                ctx.rect(wl - cs, r.y, r.x - wl + cs, r.h);
                ctx.rect(r.x + r.w, r.y, wr - r.x - r.w + cs, r.h);
                ctx.rect(wl - cs, r.y + r.h, wr - wl + cs * 2, wb - r.y - r.h + cs);
                ctx.fill();
                // 選択範囲の枠
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 2 / zoom;
                ctx.setLineDash([]);
                ctx.strokeRect(r.x, r.y, r.w, r.h);
            } else {
                // まだ範囲未指定: 全体を暗く
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(wl - cs, wt - cs, wr - wl + cs * 2, wb - wt + cs * 2);
            }
            ctx.restore();
        }

        // スナップ先マーカー（水色の中抜き四角）
        if (App._snapPt) {
            const sz = 8 / zoom;
            ctx.save();
            ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
            ctx.strokeStyle = '#00bcd4';
            ctx.lineWidth = 1.5 / zoom;
            ctx.setLineDash([]);
            ctx.strokeRect(App._snapPt.x - sz / 2, App._snapPt.y - sz / 2, sz, sz);
            ctx.restore();
        }
    });
}

/* ================================================================
   レイヤー管理
================================================================ */
/**
 * 任意の fabric オブジェクトを「マップレイヤー」として canvas に追加し、
 * 一意な _layerId と種別連番付きの _layerName を付与してレイヤーパネルに反映する。
 * フリーハンド等で既に canvas 上にあるオブジェクトには再追加しない。
 * @param {string} typeName - 種別名 (例: '矩形', 'セル')。連番に使われる。
 * @param {fabric.Object} obj
 */
function addLayerObject(typeName, obj) {
    const id = App.nextLayerId++;
    App.layerCounters[typeName] = (App.layerCounters[typeName] || 0) + 1;
    obj.set({
        _layerId: id,
        _isMapLayer: true,
        _layerName: `${typeName}${App.layerCounters[typeName]}`,
        borderColor: '#0099ff',
        cornerColor: 'white',
        cornerStrokeColor: '#0099ff',
        cornerSize: 15,
        transparentCorners: false,
        borderScaleFactor: 2,
        strokeLineJoin: App.strokeLineJoin || 'miter',
        strokeLineCap: App.strokeLineCap || 'butt',
        // テキストツール時はテキストオブジェクトのみ selectable/evented を許可 (クリックで編集可)
        selectable: App.activeTool === 'select' || (App.activeTool === 'text' && obj._isMapText),
        evented: App.activeTool === 'select' || (App.activeTool === 'text' && obj._isMapText),
    });
    applyShadowAtCreate(obj);
    // フリーハンド等、既にcanvas上にある場合はadd不要
    if (!App.canvas.getObjects().includes(obj)) App.canvas.add(obj);
    // 新規レイヤーをパネル上でハイライト（canvasのactive化はしない — 現ツールの操作性を維持）
    App.selectedLayerIds = [id];
    renderLayerList();
    App.canvas.renderAll();
    pushHistory(`${typeName}を追加`);
}

/**
 * 選択中の複数レイヤーを fabric.Group に集約する。
 * activeSelection (2 個以上の選択) のみ対象。セル/地形レイヤーが含まれていれば中止。
 * 子の _isMapLayer 等は保持されるが、レイヤーパネル上は親グループのみ表示される (renderLayerList は canvas 直下のみ走査するため)。
 */
function groupSelected() {
    const active = App.canvas.getActiveObject();
    if (!active || active.type !== 'activeSelection') {
        setTransientStatus('2個以上選択してください');
        return;
    }
    const items = active.getObjects();
    if (items.some((o) => o._isCellLayer || o._isTerrainLayer || o._isFreehandLayer)) {
        setTransientStatus('セル/地形/フリーハンドレイヤーはグループ化できません');
        return;
    }
    const group = active.toGroup();
    const id = App.nextLayerId++;
    App.layerCounters['グループ'] = (App.layerCounters['グループ'] || 0) + 1;
    group.set({
        _layerId: id,
        _isMapLayer: true,
        _layerName: `グループ${App.layerCounters['グループ']}`,
        selectable: true,
        evented: true,
        objectCaching: false,
    });
    App.canvas.setActiveObject(group);
    App.selectedLayerIds = [id];
    renderLayerList();
    App.canvas.renderAll();
    pushHistory('グループ化');
}

/**
 * 選択中のグループを解体し、子要素を canvas 直下に戻す。
 * セル/地形レイヤーは対象外。子は元の _isMapLayer / _layerId / _layerName を保持しているため、そのままレイヤーパネルに復帰する。
 */
function ungroupSelected() {
    const active = App.canvas.getActiveObject();
    if (!active || active.type !== 'group') {
        setTransientStatus('グループを選択してください');
        return;
    }
    if (active._isCellLayer || active._isTerrainLayer || active._isFreehandLayer) {
        setTransientStatus('セル/地形/フリーハンドレイヤーは解除できません');
        return;
    }
    const items = active.getObjects().slice();
    active.toActiveSelection();
    // 子要素が _layerId を持たないケース (旧データ等) には新規付与
    items.forEach((o) => {
        if (!o._layerId) {
            const id = App.nextLayerId++;
            App.layerCounters['解除'] = (App.layerCounters['解除'] || 0) + 1;
            o.set({
                _layerId: id,
                _isMapLayer: true,
                _layerName: `解除${App.layerCounters['解除']}`,
            });
        }
        o.set({ selectable: true, evented: true });
    });
    App.selectedLayerIds = items.map((o) => o._layerId);
    renderLayerList();
    App.canvas.renderAll();
    pushHistory('グループ化を解除');
}

/* ================================================================
   選択オブジェクト上のアクションバー (Fabric.Control)
   選択枠の上中央に角丸の横長バーを描画。中に複数のアイコンを並べ、
   クリック位置からアイコンを判定して dispatch する。
   表示するアクションは getActionsForTarget() が target に応じて返す。
================================================================ */
const ACTION_ICON_SIZE = 24;
const ACTION_ICON_GAP = 6;
const ACTION_PAD = 8;
const ACTION_BAR_HEIGHT = 32;
const ACTION_BAR_OFFSET_Y = -42;

/** CSS 変数 --text の値を取得 (canvas 描画用)。フォールバックあり。 */
function getCssVarColor(name, fallback) {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    } catch (_) { return fallback; }
}

/** target に応じて表示するアクション一覧を返す。 */
/* ================================================================
   SVG ブール演算 (union / intersection / difference / xor)
   外部ライブラリ polygon-clipping (window.polygonClipping) を使う。
   対象: rect / ellipse / circle / polygon / polyline / path。
       Group / セル / フリーハンド / テキスト / 画像 / 線 は対象外。
================================================================ */
const BOOL_CURVE_SAMPLES = 24;

/** ブール演算のカテゴリを返す。同一カテゴリ同士のみ演算可。 */
function boolCategory(o) {
    if (!o) return null;
    if (o._isRoomGroup) return 'room';
    if (o._isWallLayer) return 'wall';
    if (o._isGroundLayer) return 'ground';
    return 'simple';
}

/** fabric.Object → 世界座標のリング配列 [ring1, ring2, ...] (各ring = [[x,y], ...])。対象外なら null */
function shapeToWorldRings(obj) {
    if (!obj) return null;
    // 部屋グループは中の地面 (_isRoomGround) を演算対象として扱う
    if (obj._isRoomGroup && typeof obj.getObjects === 'function') {
        const ground = obj.getObjects().find((c) => c._isRoomGround);
        if (!ground) return null;
        return shapeToWorldRings(ground);
    }
    const m = obj.calcTransformMatrix();
    const apply = (lx, ly) => {
        const p = fabric.util.transformPoint({ x: lx, y: ly }, m);
        return [p.x, p.y];
    };
    const off = obj.pathOffset || { x: 0, y: 0 };
    const t = obj.type;
    if (t === 'rect') {
        const w2 = obj.width / 2, h2 = obj.height / 2;
        return [[apply(-w2, -h2), apply(w2, -h2), apply(w2, h2), apply(-w2, h2)]];
    }
    if (t === 'polygon' || t === 'polyline') {
        return [obj.points.map((p) => apply(p.x - off.x, p.y - off.y))];
    }
    if (t === 'ellipse') {
        const N = 64; const pts = [];
        for (let i = 0; i < N; i++) {
            const a = (i * 2 * Math.PI) / N;
            pts.push(apply(Math.cos(a) * obj.rx, Math.sin(a) * obj.ry));
        }
        return [pts];
    }
    if (t === 'circle') {
        const N = 64; const pts = [];
        for (let i = 0; i < N; i++) {
            const a = (i * 2 * Math.PI) / N;
            pts.push(apply(Math.cos(a) * obj.radius, Math.sin(a) * obj.radius));
        }
        return [pts];
    }
    if (t === 'path') return pathToRings(obj, off, apply);
    return null;
}

function pathToRings(obj, off, apply) {
    const cmds = obj.path || [];
    const rings = [];
    let cur = null;
    let curLx = 0, curLy = 0;
    let startLx = 0, startLy = 0;
    const N = BOOL_CURVE_SAMPLES;
    const pushPt = (lx, ly) => { cur.push(apply(lx - off.x, ly - off.y)); curLx = lx; curLy = ly; };
    const sampleQuad = (p0, p1, p2) => {
        for (let i = 1; i <= N; i++) {
            const t = i / N, u = 1 - t;
            pushPt(u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                   u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]);
        }
    };
    const sampleCubic = (p0, p1, p2, p3) => {
        for (let i = 1; i <= N; i++) {
            const t = i / N, u = 1 - t;
            pushPt(u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0],
                   u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]);
        }
    };
    for (const c of cmds) {
        const op = c[0];
        if (op === 'M' || op === 'm') {
            if (cur && cur.length >= 3) rings.push(cur);
            cur = [];
            startLx = c[1]; startLy = c[2];
            pushPt(startLx, startLy);
        } else if (op === 'L' || op === 'l') {
            pushPt(c[1], c[2]);
        } else if (op === 'Q' || op === 'q') {
            sampleQuad([curLx, curLy], [c[1], c[2]], [c[3], c[4]]);
        } else if (op === 'C' || op === 'c') {
            sampleCubic([curLx, curLy], [c[1], c[2]], [c[3], c[4]], [c[5], c[6]]);
        } else if (op === 'Z' || op === 'z') {
            if (cur && cur.length >= 3) rings.push(cur);
            cur = null;
            curLx = startLx; curLy = startLy;
        }
    }
    if (cur && cur.length >= 3) rings.push(cur);
    return rings;
}

/** fabric.Object がブール演算の対象になりうるか */
function isBooleanTarget(o) {
    if (!o) return false;
    if (o._isCellLayer || o._isTerrainLayer || o._isFreehandLayer || o._isMapText) return false;
    if (o._isRoomGroup) return true;
    return ['rect', 'ellipse', 'circle', 'polygon', 'polyline', 'path'].includes(o.type);
}

/**
 * 選択中の 2+ オブジェクトに対しブール演算を実行する。結果は 1 個の fabric.Path に。
 * 第一選択 (selectionOrder[0]) のスタイル (fill/stroke/shadow など) を継承し、その z 位置に挿入。
 * @param {'union'|'intersection'|'difference'|'xor'} op
 */
function performBooleanOp(op) {
    if (typeof polygonClipping === 'undefined') {
        setTransientStatus('polygon-clipping ライブラリが読み込まれていません');
        return;
    }
    const active = App.canvas.getActiveObject();
    if (!active || active.type !== 'activeSelection') {
        setTransientStatus('2 個以上の図形を選択してください');
        return;
    }
    const objs = active.getObjects().filter(isBooleanTarget);
    if (objs.length < 2) {
        setTransientStatus('ブール演算可能な図形を 2 個以上選んでください');
        return;
    }
    // カテゴリチェック (シンプル/地面/壁/部屋は混在不可)
    const cat = boolCategory(objs[0]);
    if (!objs.every((o) => boolCategory(o) === cat)) {
        setTransientStatus('同じ種類 (シンプル/地面/壁/部屋) の図形だけを選んでください');
        return;
    }
    if (cat === 'room') {
        performBooleanOpRoom(op, objs);
        return;
    }
    // calcTransformMatrix は親 (ActiveSelection) を辿って正しいワールド座標を返すので、
    // 解除前にここで多角形化する。
    const polys = objs.map(shapeToWorldRings).filter((r) => r && r.length > 0);
    if (polys.length < 2) {
        setTransientStatus('変換できる図形が足りません');
        return;
    }
    let result;
    try {
        result = polygonClipping[op](polys[0], ...polys.slice(1));
    } catch (e) {
        console.error(e);
        setTransientStatus('ブール演算に失敗しました');
        return;
    }
    if (!result || result.length === 0) {
        setTransientStatus('結果が空です');
        return;
    }
    // 結果を fabric.Path に
    let d = '';
    for (const poly of result) {
        for (const ring of poly) {
            if (ring.length < 3) continue;
            d += `M ${ring[0][0]} ${ring[0][1]}`;
            for (let i = 1; i < ring.length; i++) d += ` L ${ring[i][0]} ${ring[i][1]}`;
            d += ' Z ';
        }
    }
    // 第一選択 (objs[0]) からスタイル継承
    const src = objs[0];
    const path = new fabric.Path(d, {
        fill: src.fill,
        stroke: src.stroke,
        strokeWidth: src.strokeWidth,
        strokeDashArray: src.strokeDashArray,
        strokeLineJoin: src.strokeLineJoin,
        strokeLineCap: src.strokeLineCap,
        shadow: src.shadow,
        opacity: src.opacity,
        objectCaching: false,
        fillRule: 'evenodd',
    });
    // 元オブジェクトを削除、結果を追加。先に ActiveSelection 解除してから remove(...) 一括呼び出し。
    App.canvas.discardActiveObject();
    const zIndex = App.canvas.getObjects().indexOf(src);
    App.canvas.remove(...objs);
    const opLabel = { union: '合体', intersection: '交差', difference: '差', xor: '排他' }[op] || op;
    addLayerObject(opLabel, path);
    if (zIndex >= 0) App.canvas.moveTo(path, zIndex);
    App.canvas.setActiveObject(path);
    App.canvas.renderAll();
    pushHistory(`ブール演算: ${opLabel}`);
}

/**
 * 部屋グループ同士のブール演算。
 * 各部屋の地面 (_isRoomGround) を世界座標リング化 → polygon-clipping → SVG path 化し、
 * その path から新しい地面/壁の fabric.Path を生成して新しい部屋グループに包む。
 * スタイル (fill / stroke / strokeWidth / shadow) は第一選択の部屋から継承。
 * @param {string} op
 * @param {fabric.Object[]} rooms - _isRoomGroup を持つ fabric.Group の配列
 */
function performBooleanOpRoom(op, rooms) {
    if (typeof polygonClipping === 'undefined') {
        setTransientStatus('polygon-clipping ライブラリが読み込まれていません');
        return;
    }
    const polys = rooms.map(shapeToWorldRings).filter((r) => r && r.length > 0);
    if (polys.length < 2) {
        setTransientStatus('変換できる部屋が足りません');
        return;
    }
    let result;
    try {
        result = polygonClipping[op](polys[0], ...polys.slice(1));
    } catch (e) {
        console.error(e);
        setTransientStatus('ブール演算に失敗しました');
        return;
    }
    if (!result || result.length === 0) {
        setTransientStatus('結果が空です');
        return;
    }
    let d = '';
    for (const poly of result) {
        for (const ring of poly) {
            if (ring.length < 3) continue;
            d += `M ${ring[0][0]} ${ring[0][1]}`;
            for (let i = 1; i < ring.length; i++) d += ` L ${ring[i][0]} ${ring[i][1]}`;
            d += ' Z ';
        }
    }
    // 第一選択の部屋からスタイル継承
    const src = rooms[0];
    const srcGround = src.getObjects().find((c) => c._isRoomGround);
    const srcWall = src.getObjects().find((c) => c._isRoomWall);
    const ground = new fabric.Path(d, {
        fill: srcGround?.fill ?? getRoomGroundFill(),
        stroke: null,
        strokeWidth: 0,
        shadow: srcGround?.shadow || null,
        opacity: srcGround?.opacity ?? 1,
        objectCaching: false,
        fillRule: 'evenodd',
    });
    ground.set({ _isRoomGround: true });
    const wall = new fabric.Path(d, {
        fill: '',
        stroke: srcWall?.stroke ?? getRoomWallStroke(),
        strokeWidth: srcWall?.strokeWidth ?? (App.roomWallThickness || 12),
        strokeLineJoin: srcWall?.strokeLineJoin || 'miter',
        strokeLineCap: srcWall?.strokeLineCap || 'butt',
        shadow: srcWall?.shadow || null,
        opacity: srcWall?.opacity ?? 1,
        objectCaching: false,
        fillRule: 'evenodd',
    });
    wall.set({ _isRoomWall: true });

    App.canvas.discardActiveObject();
    const zIndex = App.canvas.getObjects().indexOf(src);
    App.canvas.remove(...rooms);
    // addRoom と同じく toGroup() 経由でまとめる (Group コンストラクタ経路だと
    // 子ストロークが zoom と乖離する問題があるため)
    App.canvas.add(ground);
    App.canvas.add(wall);
    const sel = new fabric.ActiveSelection([ground, wall], { canvas: App.canvas });
    App.canvas.setActiveObject(sel);
    const group = sel.toGroup();
    group.set({ _isRoomGroup: true, objectCaching: false, subTargetCheck: false });
    App.canvas.discardActiveObject();
    const opLabel = { union: '合体', intersection: '交差', difference: '差', xor: '排他' }[op] || op;
    addLayerObject(opLabel + '_部屋', group);
    if (zIndex >= 0) App.canvas.moveTo(group, zIndex);
    App.canvas.setActiveObject(group);
    App.canvas.renderAll();
    pushHistory(`部屋のブール演算: ${opLabel}`);
}

function getActionsForTarget(t) {
    if (!t) return [];
    const isContainer = t._isCellLayer || t._isTerrainLayer || t._isFreehandLayer;
    const isGroup = t.type === 'group' && !isContainer;
    const isActiveSel = t.type === 'activeSelection';
    const actions = [];
    if (isActiveSel) {
        const objs = (typeof t.getObjects === 'function') ? t.getObjects() : [];
        if (!objs.some((o) => o._isCellLayer || o._isTerrainLayer || o._isFreehandLayer)) {
            actions.push({ icon: 'create_new_folder', title: 'グループ化', onClick: () => groupSelected() });
        }
    } else if (isGroup) {
        actions.push({ icon: 'folder_open', title: 'グループ解除', onClick: () => ungroupSelected() });
    }
    // 全選択タイプ共通の操作
    actions.push({ icon: 'content_copy', title: '複製', onClick: (tt) => duplicateActive(tt) });
    actions.push({ icon: t.lockMovementX ? 'lock' : 'lock_open', title: 'ロック切替', onClick: (tt) => toggleLockActive(tt) });
    actions.push({ icon: 'flip_to_front', title: '最前面へ', onClick: (tt) => { App.canvas.bringToFront(tt); App.canvas.renderAll(); pushHistory('最前面へ'); } });
    actions.push({ icon: 'flip_to_back', title: '最背面へ', onClick: (tt) => { App.canvas.sendToBack(tt); App.canvas.renderAll(); pushHistory('最背面へ'); } });
    actions.push({ icon: 'delete', title: '削除', onClick: (tt) => deleteActive(tt) });
    return actions;
}

/** ロック切替: 全方向の移動/スケール/回転を一括 toggle。 */
function toggleLockActive(t) {
    if (!t) return;
    const lock = !t.lockMovementX;
    const props = { lockMovementX: lock, lockMovementY: lock, lockScalingX: lock, lockScalingY: lock, lockRotation: lock };
    if (t.type === 'activeSelection' && typeof t.getObjects === 'function') {
        t.getObjects().forEach((o) => o.set(props));
    }
    t.set(props);
    App.canvas.renderAll();
    renderLayerList();
    pushHistory(lock ? 'ロック' : 'ロック解除');
}

/** 削除: activeSelection なら子全部、それ以外は単体。 */
function deleteActive(t) {
    if (!t) return;
    const targets = (t.type === 'activeSelection' && typeof t.getObjects === 'function') ? t.getObjects().slice() : [t];
    targets.forEach((o) => App.canvas.remove(o));
    App.canvas.discardActiveObject();
    App.selectedLayerIds = [];
    renderLayerList();
    App.canvas.renderAll();
    updateSelectionInfo();
    pushHistory(targets.length === 1 ? `${targets[0]._layerName || '要素'}を削除` : `${targets.length}個削除`);
}

/** 複製: cloneAsync で位置をずらしてレイヤー化。 */
function duplicateActive(t) {
    if (!t) return;
    const targets = (t.type === 'activeSelection' && typeof t.getObjects === 'function') ? t.getObjects().slice() : [t];
    const newObjs = [];
    let pending = targets.length;
    targets.forEach((o) => {
        o.clone((cloned) => {
            cloned.set({ left: (cloned.left || 0) + 20, top: (cloned.top || 0) + 20 });
            addLayerObject((o._layerName || '要素') + ' コピー', cloned);
            newObjs.push(cloned);
            if (--pending === 0) {
                App.canvas.discardActiveObject();
                if (newObjs.length === 1) App.canvas.setActiveObject(newObjs[0]);
                else if (newObjs.length > 1) {
                    const sel = new fabric.ActiveSelection(newObjs, { canvas: App.canvas });
                    App.canvas.setActiveObject(sel);
                }
                App.canvas.renderAll();
                pushHistory(targets.length === 1 ? '複製' : `${targets.length}個複製`);
            }
        }, SAVE_CUSTOM_PROPS);
    });
}

/** 横長アクションバー (背景 + 区切りなし) を描き、各アイコンを並べる。 */
function drawActionBar(ctx, cx, cy, actions, iconColor) {
    if (!actions || actions.length === 0) return;
    const totalW = ACTION_PAD * 2 + actions.length * ACTION_ICON_SIZE + (actions.length - 1) * ACTION_ICON_GAP;
    const h = ACTION_BAR_HEIGHT;
    const r = h / 2;
    const half = totalW / 2;
    ctx.save();
    ctx.translate(cx, cy);
    // 背景 (角丸長方形)
    ctx.fillStyle = 'rgba(10, 18, 26, 0.92)';
    ctx.strokeStyle = '#0099ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-half + r, -h / 2);
    ctx.lineTo(half - r, -h / 2);
    ctx.quadraticCurveTo(half, -h / 2, half, -h / 2 + r);
    ctx.lineTo(half, h / 2 - r);
    ctx.quadraticCurveTo(half, h / 2, half - r, h / 2);
    ctx.lineTo(-half + r, h / 2);
    ctx.quadraticCurveTo(-half, h / 2, -half, h / 2 - r);
    ctx.lineTo(-half, -h / 2 + r);
    ctx.quadraticCurveTo(-half, -h / 2, -half + r, -h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // 各アイコン (左端から並べる)
    ctx.fillStyle = iconColor;
    ctx.font = `${ACTION_ICON_SIZE - 4}px "Material Symbols Outlined"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let xCursor = -half + ACTION_PAD + ACTION_ICON_SIZE / 2;
    for (let i = 0; i < actions.length; i++) {
        ctx.fillText(actions[i].icon, xCursor, 1);
        xCursor += ACTION_ICON_SIZE + ACTION_ICON_GAP;
    }
    ctx.restore();
}

/** クリック位置 (バーローカル X) からアイコン index を割り出す。範囲外なら -1。 */
function actionBarHitIndex(localX, actions) {
    if (!actions || actions.length === 0) return -1;
    const totalW = ACTION_PAD * 2 + actions.length * ACTION_ICON_SIZE + (actions.length - 1) * ACTION_ICON_GAP;
    const xFromLeft = localX + totalW / 2 - ACTION_PAD;
    if (xFromLeft < 0) return -1;
    const stride = ACTION_ICON_SIZE + ACTION_ICON_GAP;
    const idx = Math.floor(xFromLeft / stride);
    if (idx < 0 || idx >= actions.length) return -1;
    // クリックがアイコン範囲内かチェック (gap 部分は無視)
    const within = xFromLeft - idx * stride;
    if (within > ACTION_ICON_SIZE) return -1;
    return idx;
}

(function setupSelectionControls() {
    if (typeof fabric === 'undefined') return;
    Object.assign(fabric.Object.prototype, {
        borderColor: '#0099ff',
        cornerColor: 'white',
        cornerStrokeColor: '#0099ff',
        cornerSize: 15,
        transparentCorners: false,
        borderScaleFactor: 2,
    });
    const iconColor = getCssVarColor('--text', '#e8eef5');
    // 単一の "actionBar" Control を fabric.Object.prototype に登録する。
    // Group.prototype.controls / ActiveSelection.prototype.controls は Object と同じ参照なので、
    // ここで登録すれば全タイプで表示される。表示するアクションは getActionsForTarget が決める。
    fabric.Object.prototype.controls.actionBar = new fabric.Control({
        x: 0,
        y: -0.5,
        offsetX: 0,
        offsetY: ACTION_BAR_OFFSET_Y,
        cursorStyle: 'pointer',
        // sizeX は target ごとに変わるので render の widest case で確保。getActionsBarWidth で動的計算する。
        sizeX: 240,
        sizeY: ACTION_BAR_HEIGHT,
        touchSizeX: 280,
        touchSizeY: ACTION_BAR_HEIGHT + 6,
        mouseUpHandler: (eventData, transform) => {
            const target = transform.target;
            const actions = getActionsForTarget(target);
            if (actions.length === 0) return false;
            // 表示座標 (canvas DOM pixel) で計算: eventData.clientX をキャンバス左上基準に変換 →
            // target.oCoords.actionBar.x も同じ表示座標系なので、差分が「バー中心からの水平オフセット」になる。
            const coord = target.oCoords?.actionBar;
            if (!coord) return false;
            const rect = App.canvas.upperCanvasEl.getBoundingClientRect();
            const dispX = eventData.clientX - rect.left;
            const localX = dispX - coord.x;
            const idx = actionBarHitIndex(localX, actions);
            if (idx < 0) return false;
            actions[idx].onClick(target);
            return true;
        },
        render: function (ctx, left, top, styleOverride, fabricObject) {
            const actions = getActionsForTarget(fabricObject);
            if (actions.length === 0) return;
            drawActionBar(ctx, left, top, actions, iconColor);
        },
    });

    // ブール演算バー (アクションバーの更に上に独立配置、2+ の対象図形が選ばれているときだけ表示)
    const BOOL_BAR_OFFSET_Y = ACTION_BAR_OFFSET_Y - (ACTION_BAR_HEIGHT + 6);
    const boolActions = [
        { icon: 'join_full', title: '合体 (union)', op: 'union' },
        { icon: 'join_left', title: '交差 (intersection)', op: 'intersection' },
        { icon: 'difference', title: '差 (difference)', op: 'difference' },
        { icon: 'compare', title: '排他 (xor)', op: 'xor' },
    ];
    const boolActionsForTarget = (t) => {
        if (!t || t.type !== 'activeSelection') return [];
        const objs = (typeof t.getObjects === 'function') ? t.getObjects() : [];
        const usable = objs.filter(isBooleanTarget);
        if (usable.length < 2) return [];
        // 同一カテゴリでなければブール演算不可
        const cat = boolCategory(usable[0]);
        if (!usable.every((o) => boolCategory(o) === cat)) return [];
        return boolActions.map((a) => ({
            icon: a.icon, title: a.title,
            onClick: () => performBooleanOp(a.op),
        }));
    };
    fabric.Object.prototype.controls.booleanBar = new fabric.Control({
        x: 0,
        y: -0.5,
        offsetX: 0,
        offsetY: BOOL_BAR_OFFSET_Y,
        cursorStyle: 'pointer',
        sizeX: 200,
        sizeY: ACTION_BAR_HEIGHT,
        touchSizeX: 220,
        touchSizeY: ACTION_BAR_HEIGHT + 6,
        mouseUpHandler: (eventData, transform) => {
            const target = transform.target;
            const actions = boolActionsForTarget(target);
            if (actions.length === 0) return false;
            const coord = target.oCoords?.booleanBar;
            if (!coord) return false;
            const rect = App.canvas.upperCanvasEl.getBoundingClientRect();
            const dispX = eventData.clientX - rect.left;
            const localX = dispX - coord.x;
            const idx = actionBarHitIndex(localX, actions);
            if (idx < 0) return false;
            actions[idx].onClick(target);
            return true;
        },
        render: function (ctx, left, top, styleOverride, fabricObject) {
            const actions = boolActionsForTarget(fabricObject);
            if (actions.length === 0) return;
            drawActionBar(ctx, left, top, actions, iconColor);
        },
    });

    // Material Symbols フォントのロード完了後に canvas を再描画 (初回選択時にアイコンが ligature として描けるように)
    if (document.fonts?.load) {
        document.fonts.load('18px "Material Symbols Outlined"').then(() => {
            if (App.canvas) App.canvas.requestRenderAll();
        });
    }
})();

/* ================================================================
   フリーハンド (Fabric brushes 拡張)
   - ブラシ種類: pencil / circle / spray / eraser
   - 筆圧検知 (PointerEvent.pressure を使い、ストローク内の最大値で width をスケール)
   - Shift で直線 (押下中の onMouseMove で中間点を捨て、最初+現在の2点で再描画)
   - 消しゴム: destination-out 合成で「下の絵を消す」path として生成
================================================================ */

/** ブラシを切り替え、現在の各種設定 (幅/色/不透明度/decimation) を貼り直す。 */
function setFreehandBrush(type) {
    if (!App.canvas) return;
    App.freehandBrush = type;
    let brush;
    switch (type) {
        case 'circle':
            brush = new fabric.CircleBrush(App.canvas);
            break;
        case 'spray':
            brush = new fabric.SprayBrush(App.canvas);
            // SprayBrush は density/dotWidth が固有プロパティ
            brush.density = 20;
            brush.dotWidth = 1;
            brush.dotWidthVariance = 1;
            brush.randomOpacity = true;
            break;
        case 'eraser':
            brush = new fabric.PencilBrush(App.canvas);
            brush._isEraser = true;
            break;
        case 'pencil':
        default:
            brush = new fabric.PencilBrush(App.canvas);
            break;
    }
    App.canvas.freeDrawingBrush = brush;
    patchFreehandBrush(brush);
    syncFreehandBrushProps();
}

/** 現在の App.freehand* 設定を現行ブラシに反映する。 */
function syncFreehandBrushProps() {
    const b = App.canvas?.freeDrawingBrush;
    if (!b) return;
    const baseW = parseInt(document.getElementById('freehand-width')?.value) || App.freehandWidth || 3;
    b.width = baseW;
    // 消しゴム: destination-out では描画時の色は最終的に無視されるが、プレビュー (contextTop) には
    // brush.color がそのまま見える。何を消しているか分かりやすいよう赤色で見せる。
    if (b._isEraser) {
        b.color = 'rgba(255,0,0,0.5)';
    } else {
        b.color = rgba(App.freehandColor || '#000000', App.freehandOpacity ?? 1);
    }
    if ('decimate' in b) {
        b.decimate = App.freehandDecimation || 0;
    }
}

/** ブラシインスタンスに「筆圧 + Shift 直線」のフックを刺す。同じブラシに二重適用しない。 */
function patchFreehandBrush(brush) {
    if (!brush || brush._patched) return;
    brush._patched = true;

    // --- 筆圧: ストローク中の最大 pressure を _strokePressureMax に記録 ---
    const origDown = brush.onMouseDown.bind(brush);
    const origMove = brush.onMouseMove.bind(brush);
    const origUp = brush.onMouseUp ? brush.onMouseUp.bind(brush) : null;

    brush.onMouseDown = function (pointer, opts) {
        App._strokePressureMax = 0;
        const p = opts?.e?.pressure;
        if (App.freehandPressure && typeof p === 'number' && p > 0 && opts?.e?.pointerType !== 'mouse') {
            App._strokePressureMax = p;
        }
        return origDown(pointer, opts);
    };
    brush.onMouseMove = function (pointer, opts) {
        const e = opts?.e;
        const p = e?.pressure;
        if (App.freehandPressure && typeof p === 'number' && p > 0 && e?.pointerType !== 'mouse') {
            if (p > App._strokePressureMax) App._strokePressureMax = p;
        }
        // Shift 押下中は直線にする: 内部の _points を [start, current] の2点に置き換えて再描画
        if (App._shiftHeld && Array.isArray(this._points) && this._points.length > 0) {
            this._points = [this._points[0]];
            // 親 onMouseMove が pointer を追加 → 結果 [start, current] になる
            const ret = origMove(pointer, opts);
            // contextTop を直接書き直す (PencilBrush のみ — circle/spray は中間点も意味あるので shift は無効)
            if (this._render && this.canvas?.contextTop) {
                this.canvas.clearContext(this.canvas.contextTop);
                this._render();
            }
            return ret;
        }
        return origMove(pointer, opts);
    };
    if (origUp) {
        brush.onMouseUp = function (opts) {
            // 筆圧があったら最終 width をスケール (ストローク中の最大値 0..1 を 0.3..1.4 程度にマップ)
            if (App.freehandPressure && App._strokePressureMax > 0) {
                const base = parseInt(document.getElementById('freehand-width')?.value) || App.freehandWidth || 3;
                const scale = 0.3 + App._strokePressureMax * 1.1; // 軽く強調
                this.width = Math.max(1, Math.round(base * scale));
            }
            const ret = origUp(opts);
            // 元の width に戻す (次ストロークが筆圧無しでも基本値に戻る)
            this.width = parseInt(document.getElementById('freehand-width')?.value) || App.freehandWidth || 3;
            App._strokePressureMax = 0;
            return ret;
        };
    }
}

/* ----------------------------------------------------------------
   フリーハンドレイヤー (= 複数ストロークをまとめる fabric.Group)
   セルレイヤーと同じ思想: 自動で 1 つのレイヤーに集約、ユーザーが「レイヤー追加」
   タイルで明示的に新規作成。消しゴムも同レイヤーに入れて、当該レイヤー内だけを消す。
---------------------------------------------------------------- */

/** 選択中の既存フリーハンドレイヤー、無ければ最上位のもの、それも無ければ新規作成。 */
function getOrCreateFreehandLayer() {
    const selected = App.canvas.getObjects().find((o) => o._isFreehandLayer && App.selectedLayerIds.includes(o._layerId));
    if (selected) return selected;
    const existing = getMapLayers().reverse().find((o) => o._isFreehandLayer);
    if (existing) return existing;
    return createFreehandLayer();
}

/** 空のフリーハンドレイヤー (fabric.Group) を新規作成。objectCaching:true でグループ単位の影/合成を成立させる。 */
function createFreehandLayer() {
    const group = new fabric.Group([], {
        selectable: false,
        evented: false,
        // セル同様、グループ全体に1つの影を落とすため & 消しゴム (destination-out) を
        // このレイヤー内だけに効かせるためにキャッシュを有効化
        objectCaching: false,
        _isFreehandLayer: true,
    });
    addLayerObject('フリーハンド', group);
    App.selectedLayerIds = [group._layerId];
    renderLayerList();
    return group;
}

/**
 * canvas のアクティブ選択 → App.selectedLayerIds への片方向同期。
 * selection:created / selection:updated イベントから呼ばれる。
 */
function syncLayerSelectionFromCanvas() {
    App.selectedLayerIds = App.canvas
        .getActiveObjects()
        .filter((o) => o._isMapLayer)
        .map((o) => o._layerId);
    renderLayerList();
}

/**
 * レイヤーパネル全体を再構築する。各 .layer-item に対し
 * 可視切替 / クリック (Ctrl/Shift複数選択) / ダブルクリック改名 / 右クリックメニュー /
 * ドラッグ&ドロップによる並べ替えのイベントを取り付ける。
 * 表示順は canvas z 順の逆 (上=最前面)。
 */
function renderLayerList() {
    const list = document.getElementById('layer-list');
    list.innerHTML = '';
    const layers = getMapLayers().reverse();

    layers.forEach((obj) => {
        const item = document.createElement('div');
        item.className = 'layer-item' + (App.selectedLayerIds.includes(obj._layerId) ? ' selected' : '');
        item.dataset.id = obj._layerId;
        item.draggable = true;

        // 可視アイコン
        const vis = document.createElement('span');
        vis.className = 'material-symbols-outlined';
        vis.textContent = obj.visible ? 'visibility' : 'visibility_off';
        vis.addEventListener('click', (e) => {
            e.stopPropagation();
            obj.set({ visible: !obj.visible });
            App.canvas.renderAll();
            renderLayerList();
            pushHistory(obj.visible ? `${obj._layerName}を表示` : `${obj._layerName}を非表示`);
        });

        // 名前
        const name = document.createElement('span');
        name.className = 'layer-name';
        name.textContent = obj._layerName || 'レイヤー';

        item.appendChild(vis);
        item.appendChild(name);

        // ロックアイコン (ロック中のみ表示) — クリックで解除可能
        if (obj.lockMovementX) {
            const lockIcon = document.createElement('span');
            lockIcon.className = 'material-symbols-outlined layer-lock-icon';
            lockIcon.textContent = 'lock';
            lockIcon.title = 'ロック中 (クリックで解除)';
            lockIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                obj.set({
                    lockMovementX: false,
                    lockMovementY: false,
                    lockRotation: false,
                    lockScalingX: false,
                    lockScalingY: false,
                    hasControls: true,
                });
                App.canvas.renderAll();
                renderLayerList();
                pushHistory(`${obj._layerName}をロック解除`);
            });
            item.appendChild(lockIcon);
        }

        // クリック（Ctrl/Shift対応 + ツール切替）
        item.addEventListener('click', (e) => {
            const id = obj._layerId;
            if (e.ctrlKey || e.metaKey) {
                if (App.selectedLayerIds.includes(id)) App.selectedLayerIds = App.selectedLayerIds.filter((i) => i !== id);
                else App.selectedLayerIds.push(id);
            } else if (e.shiftKey && App.lastClickedLayerId != null) {
                const allIds = layers.map((l) => l._layerId);
                const a = allIds.indexOf(App.lastClickedLayerId),
                    b = allIds.indexOf(id);
                const range = allIds.slice(Math.min(a, b), Math.max(a, b) + 1);
                App.selectedLayerIds = [...new Set([...App.selectedLayerIds, ...range])];
            } else {
                App.selectedLayerIds = [id];
            }
            App.lastClickedLayerId = id;
            // セル/地形ツール中の同種レイヤー選択 → ペイント対象切替のみ
            const isPaintException = App.activeTool === 'cell' && obj._isCellLayer;
            if (!isPaintException && App.activeTool !== 'select') {
                setActiveTool('select');
            }
            if (!isPaintException) {
                applyLayerSelectionToCanvas();
            }
            renderLayerList();
            updateSelectionInfo();
        });

        // ダブルクリック → 名前変更
        item.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'layer-name-input';
            input.value = obj._layerName || '';
            name.replaceWith(input);
            input.focus();
            input.select();
            const before = obj._layerName;
            const commit = () => {
                const newName = input.value || before;
                obj._layerName = newName;
                renderLayerList();
                if (newName !== before) pushHistory(`${before} → ${newName} に改名`);
            };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') input.blur();
                if (ev.key === 'Escape') {
                    input.value = obj._layerName;
                    input.blur();
                }
            });
        });

        // 右クリック
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!App.selectedLayerIds.includes(obj._layerId)) {
                App.selectedLayerIds = [obj._layerId];
                applyLayerSelectionToCanvas();
                renderLayerList();
            }
            showContextMenu(e.clientX, e.clientY, obj);
        });

        // ドラッグ＆ドロップ
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', String(obj._layerId));
            item.style.opacity = '0.4';
        });
        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
            document.querySelectorAll('.layer-item').forEach((i) => i.classList.remove('drag-over-top', 'drag-over-bottom'));
        });
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const rect = item.getBoundingClientRect();
            item.classList.toggle('drag-over-top', e.clientY < rect.top + rect.height / 2);
            item.classList.toggle('drag-over-bottom', e.clientY >= rect.top + rect.height / 2);
        });
        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            document.querySelectorAll('.layer-item').forEach((i) => i.classList.remove('drag-over-top', 'drag-over-bottom'));
            const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
            if (draggedId === obj._layerId) return;

            const rect = item.getBoundingClientRect();
            const above = e.clientY < rect.top + rect.height / 2;

            // 複数選択時は全選択レイヤーを一括移動
            const draggedIds = App.selectedLayerIds.includes(draggedId) ? [...App.selectedLayerIds] : [draggedId];
            if (draggedIds.includes(obj._layerId)) return;

            // 現在のマップレイヤー順を取得（canvas z順: 低→高）
            const mapLayers = getMapLayers();
            const draggedObjs = mapLayers.filter((o) => draggedIds.includes(o._layerId));
            const remaining = mapLayers.filter((o) => !draggedIds.includes(o._layerId));

            // ドロップ先のインデックス（remaining配列内）
            const targetIdx = remaining.findIndex((o) => o._layerId === obj._layerId);
            // UI上で「上」= canvas z-indexが高い = remaining配列の後方
            const insertIdx = above ? targetIdx + 1 : targetIdx;
            remaining.splice(insertIdx, 0, ...draggedObjs);

            // canvas上のマップレイヤーを再配置
            mapLayers.forEach((o) => App.canvas.remove(o));
            remaining.forEach((o) => App.canvas.add(o));

            renderLayerList();
            App.canvas.renderAll();
            pushHistory('レイヤーを並べ替え');
        });

        list.appendChild(item);
    });
}

/**
 * App.selectedLayerIds → canvas のアクティブ選択への片方向同期。
 * 単一/複数選択を判別し、複数なら ActiveSelection を生成する。
 * 注意: discardActiveObject が selection:cleared を発火して selectedLayerIds を消すため、
 *       内部で先にコピーを取ってから処理する。
 */
function applyLayerSelectionToCanvas() {
    // discardActiveObject が selection:cleared を発火して App.selectedLayerIds を消すので先に退避
    const idsToSelect = [...App.selectedLayerIds];
    App.canvas.discardActiveObject();
    const objs = App.canvas.getObjects().filter((o) => idsToSelect.includes(o._layerId));
    if (objs.length === 1) {
        objs[0].set({ selectable: true, evented: true });
        App.canvas.setActiveObject(objs[0]);
    } else if (objs.length > 1) {
        objs.forEach((o) => o.set({ selectable: true, evented: true }));
        const sel = new fabric.ActiveSelection(objs, { canvas: App.canvas });
        App.canvas.setActiveObject(sel);
    }
    App.canvas.renderAll();
}

/* ================================================================
   選択オブジェクト情報表示
================================================================ */
/**
 * 「選択ツール」プロパティパネルの選択オブジェクト情報を再描画する。
 * 0個: プレースホルダ / 1個: X,Y,幅,高さ,回転を表示しX/Yは編集可 / 複数: 件数のみ。
 */
function updateSelectionInfo() {
    const info = document.getElementById('sel-info');
    const none = document.getElementById('sel-none');
    const active = App.canvas.getActiveObjects().filter((o) => o._isMapLayer);
    if (active.length === 0) {
        info.innerHTML = '<p class="fl" style="opacity:0.5" id="sel-none">オブジェクトを選択してください</p>';
        return;
    }
    if (active.length === 1) {
        const o = active[0];
        info.innerHTML = `
            <div class="f"><span class="fl">名前</span><span class="unit">${o._layerName}</span></div>
            <div class="f"><span class="fl">X</span><input type="number" id="si-x" value="${Math.round(o.left)}" class="custom-spinner" /></div>
            <div class="f"><span class="fl">Y</span><input type="number" id="si-y" value="${Math.round(o.top)}" class="custom-spinner" /></div>
            <div class="f"><span class="fl">幅</span><span class="unit">${Math.round(o.width * (o.scaleX || 1))}</span></div>
            <div class="f"><span class="fl">高さ</span><span class="unit">${Math.round(o.height * (o.scaleY || 1))}</span></div>
            <div class="f"><span class="fl">回転</span><span class="unit">${Math.round(o.angle || 0)}°</span></div>`;
        // X/Y 編集
        info.querySelector('#si-x')?.addEventListener('change', function () {
            o.set({ left: parseInt(this.value) });
            o.setCoords();
            App.canvas.renderAll();
            pushHistory(`${o._layerName}のXを変更`);
        });
        info.querySelector('#si-y')?.addEventListener('change', function () {
            o.set({ top: parseInt(this.value) });
            o.setCoords();
            App.canvas.renderAll();
            pushHistory(`${o._layerName}のYを変更`);
        });
    } else {
        info.innerHTML = `<p class="fl" style="opacity:0.5">${active.length} 個のオブジェクトを選択中</p>`;
    }
    if (window.IKLab?.initNumSpinners) IKLab.initNumSpinners(info);
    updateFillStrokeVisibility();
}

/* ================================================================
   セルレイヤー
================================================================ */
/**
 * セル塗りツールで対象となるセルレイヤーを取得する。
 * 優先順位: 現在選択中のセルレイヤー > 最上位のセルレイヤー > 新規作成。
 * @returns {fabric.Group}
 */
function getOrCreateCellLayer() {
    // 選択中のセルレイヤーを探す
    const selected = App.canvas.getObjects().find((o) => o._isCellLayer && App.selectedLayerIds.includes(o._layerId));
    if (selected) return selected;
    // 最上位のセルレイヤー
    const existing = getMapLayers()
        .reverse()
        .find((o) => o._isCellLayer);
    if (existing) return existing;
    // なければ新規作成
    return createCellLayer();
}

/**
 * 空のセルレイヤー (fabric.Group + _cellData Map) を新規作成し、選択状態にする。
 * _cellData は "col,row" → fabric.Rect を保持してセル単位の O(1) アクセスを可能にする。
 * @returns {fabric.Group}
 */
function createCellLayer() {
    const group = new fabric.Group([], {
        selectable: false,
        evented: false,
        // 統一シャドウのため group キャッシュを有効化。
        // noScaleCache: false にしないと、デフォルト挙動 (1x で焼いて拡大表示) で
        // ズーム時にビットマップが伸びてジャギーになる。false なら現在の zoom に応じて毎回再キャッシュ。
        objectCaching: false,
        noScaleCache: false,
        _isCellLayer: true,
        _cellData: new Map(),
        _pendingErase: new Set(),
        _tempChildren: [],
        _tempByKey: new Map(),
        // セルレイヤーは grid と紐づくので、回転/スケーリングは禁止。移動はグリッド単位に snap される
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        hasControls: false,
    });
    addLayerObject('セル', group);
    // 作成直後に選択状態にする
    App.selectedLayerIds = [group._layerId];
    renderLayerList();
    return group;
}

/**
 * セルレイヤー上の1セルをペン塗り / 消しゴム消去する (シンプルモード)。
 * - データモデル: layer._cellData は (col,row) → cellEntry のマップ。真のソース。
 * - 視覚: ドラッグ中はテンポラリ Rect を group に重ねる (シャドウは group が一括処理)。
 * - mouseup で commitCellLayer() が走り、_pendingErase 反映 + Path に再コンパイル。
 */
function handleCellPaint(col, row, tool) {
    const layer = getOrCreateCellLayer();
    if (!App.selectedLayerIds.includes(layer._layerId)) {
        App.selectedLayerIds = [layer._layerId];
        renderLayerList();
    }
    const adapter = ga();
    const key = adapter.cellKey(col, row);
    if (tool === 'pen') {
        const colorStr = rgba(App.fillColor, App.fillOpacity);
        const entry = { col, row, fillKey: 'solid:' + colorStr, mode: 'solid', solidColor: colorStr };
        addCellToLayer(layer, key, entry, colorStr);
    } else if (tool === 'eraser') {
        eraseCellFromLayer(layer, adapter, col, row);
    }
}

/**
 * 地面モードのセルレイヤー (現存最上位 or 新規) を取得する。
 * シンプル用 cellLayer とは別系統 (_isGroundLayer フラグで区別)。
 */
function getOrCreateGroundCellLayer() {
    const existing = getMapLayers()
        .reverse()
        .find((o) => o._isCellLayer && o._isGroundLayer);
    if (existing) return existing;
    return createGroundCellLayer();
}

/** 地面モード用の空セルレイヤーを新規作成する (add-layer タイル経由)。 */
function createGroundCellLayer() {
    const group = new fabric.Group([], {
        selectable: false,
        evented: false,
        // 統一シャドウのため group キャッシュを有効化。
        // noScaleCache: false にしないと、デフォルト挙動 (1x で焼いて拡大表示) で
        // ズーム時にビットマップが伸びてジャギーになる。false なら現在の zoom に応じて毎回再キャッシュ。
        objectCaching: false,
        noScaleCache: false,
        _isCellLayer: true,
        _isGroundLayer: true,
        _cellData: new Map(),
        _pendingErase: new Set(),
        _tempChildren: [],
        _tempByKey: new Map(),
        // セルレイヤーは grid と紐づくので、回転/スケーリングは禁止。移動はグリッド単位に snap される
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        hasControls: false,
    });
    addCategoryLayer('地面_セル', group, '_isGroundLayer');
    App.selectedLayerIds = [group._layerId];
    renderLayerList();
    return group;
}

/* ----------------------------------------------------------------
   セルレイヤー操作ヘルパ (Path 化方式)
---------------------------------------------------------------- */

/** entry から fabric.Pattern (画像未ロード時は color フォールバック) を作る。 */
function entryToFill(entry) {
    if (!entry) return '#888888';
    if (entry.mode === 'solid') return entry.solidColor || '#888888';
    return getPatternFill(entry.patternId, '#888888');
}

/**
 * (col,row) に cellEntry を追加し、視覚フィードバック用の temp Rect を group に重ねる。
 * 既に同じ位置にセルがあれば上書き (entry のみ。古い temp Rect は次回 commit でクリーンアップ)。
 */
function addCellToLayer(layer, key, entry, tempFill) {
    if (!layer._cellData) layer._cellData = new Map();
    if (!layer._pendingErase) layer._pendingErase = new Set();
    if (!layer._tempChildren) layer._tempChildren = [];
    if (!layer._tempByKey) layer._tempByKey = new Map();
    layer._pendingErase.delete(key);
    const prev = layer._cellData.get(key);
    const existingTemp = layer._tempByKey.get(key);
    // 既に同じ fill で同セルに temp Rect が乗っているなら何もしない (ペンドラッグの重複防止)
    if (existingTemp && prev && prev.fillKey === entry.fillKey) return;
    // 違う fill なら古い temp Rect を取り除いてから新しいのを置く
    if (existingTemp) removeTempChild(layer, existingTemp);
    layer._cellData.set(key, entry);
    const adapter = ga();
    const shape = adapter.createCellShape(entry.col, entry.row, tempFill);
    if (!shape) return;
    shape._temp = true;
    shape._cellKey = key;
    snapshotWorldPosition(shape);
    if (entry.mode === 'pattern') {
        applyPatternTransformOnObj(shape, entry.patOffX, entry.patOffY, entry.patRot, entry.patScale);
    }
    layer.addWithUpdate(shape);
    layer._tempChildren.push(shape);
    layer._tempByKey.set(key, shape);
    App.canvas.requestRenderAll();
}

/**
 * (col,row) を消し予約セットに入れ、destination-out の temp Rect を重ねて視覚的に消えたように見せる。
 * group の objectCaching: true により destination-out はレイヤー内に限定される。
 */
function eraseCellFromLayer(layer, adapter, col, row) {
    const key = adapter.cellKey(col, row);
    if (!layer._pendingErase) layer._pendingErase = new Set();
    if (!layer._tempChildren) layer._tempChildren = [];
    if (!layer._tempByKey) layer._tempByKey = new Map();
    // _cellData にも temp にも無いセルは消す対象なし
    if (!layer._cellData.has(key) && !layer._tempByKey.has(key)) return;
    // 既に同セルに temp 要素 (ペン or 消し) があれば取り除き、消しゴム rect で置き換え
    const existingTemp = layer._tempByKey.get(key);
    if (existingTemp) {
        // 既存が同じく destination-out なら何もしない (消しゴムドラッグの重複防止)
        if (existingTemp.globalCompositeOperation === 'destination-out') {
            layer._pendingErase.add(key);
            return;
        }
        removeTempChild(layer, existingTemp);
    }
    layer._pendingErase.add(key);
    const shape = adapter.createCellShape(col, row, 'rgba(0,0,0,1)');
    if (!shape) return;
    shape._temp = true;
    shape._cellKey = key;
    shape.set({ globalCompositeOperation: 'destination-out' });
    snapshotWorldPosition(shape);
    layer.addWithUpdate(shape);
    layer._tempChildren.push(shape);
    layer._tempByKey.set(key, shape);
    App.canvas.requestRenderAll();
}

/** _tempChildren / _tempByKey / group から temp 要素を取り除く。 */
function removeTempChild(layer, child) {
    if (!child) return;
    layer.removeWithUpdate(child);
    const idx = layer._tempChildren.indexOf(child);
    if (idx >= 0) layer._tempChildren.splice(idx, 1);
    if (child._cellKey && layer._tempByKey?.get(child._cellKey) === child) {
        layer._tempByKey.delete(child._cellKey);
    }
}

/**
 * paint 終了時 (mouseup) に呼ぶ。temp 要素を全削除 → _pendingErase 反映 → _cellData を
 * fillKey でグルーピングして fabric.Path[] を再生成 → group の中身を入れ替え。
 */
function commitCellLayer(layer) {
    if (!layer || !layer._isCellLayer) return;
    if (!layer._cellData) layer._cellData = new Map();
    // 消し予約を _cellData に反映
    if (layer._pendingErase) {
        for (const k of layer._pendingErase) layer._cellData.delete(k);
        layer._pendingErase.clear();
    }
    // group から全ての子要素 (temp Rect + 旧 compiled Path) を削除
    const oldChildren = layer.getObjects().slice();
    for (const c of oldChildren) layer.remove(c);
    layer._tempChildren = [];
    layer._tempByKey = new Map();
    // fillKey でグルーピング
    const groups = new Map(); // fillKey → { entries: [], sample: cellEntry }
    for (const entry of layer._cellData.values()) {
        let g = groups.get(entry.fillKey);
        if (!g) {
            g = { entries: [], sample: entry };
            groups.set(entry.fillKey, g);
        }
        g.entries.push(entry);
    }
    // 各グループから fabric.Path を生成 (融合された 1 つの輪郭)
    const adapter = ga();
    for (const g of groups.values()) {
        const d = adapter.buildUnionPath(g.entries);
        if (!d) continue;
        const fill = entryToFill(g.sample);
        const path = new fabric.Path(d, {
            fill,
            stroke: null,         // 輪郭融合済みなので AA 隙間対策の縁取りは不要
            strokeWidth: 0,
            objectCaching: false,
            selectable: false,
            evented: false,
            fillRule: 'evenodd',  // 穴付き領域に対応
        });
        // パターン世界アンカー: snapshotWorldPosition 後 applyPatternTransformOnObj
        snapshotWorldPosition(path);
        if (g.sample.mode === 'pattern') {
            applyPatternTransformOnObj(path, g.sample.patOffX, g.sample.patOffY, g.sample.patRot, g.sample.patScale);
        }
        layer.addWithUpdate(path);
    }
    // 何も無くなったら group のサイズが 0 になり描画不能 → dummy 1x1 透明 Rect で保持
    if (layer.getObjects().length === 0) {
        layer.addWithUpdate(new fabric.Rect({ left: 0, top: 0, width: 1, height: 1, fill: 'rgba(0,0,0,0)', selectable: false, evented: false }));
    }
    layer.dirty = true;
    App.canvas.requestRenderAll();
}

/** save 用に _cellData を配列化する。toJSON 直前に layer._cellEntries にセット。 */
function syncCellEntries(layer) {
    if (!layer || !layer._cellData) { layer._cellEntries = []; return; }
    layer._cellEntries = Array.from(layer._cellData.values());
}

/** load 後に _cellEntries 配列から _cellData Map を復元。 */
function rebuildCellDataFromEntries(layer, adapter) {
    layer._cellData = new Map();
    layer._pendingErase = new Set();
    layer._tempChildren = [];
    layer._tempByKey = new Map();
    const arr = layer._cellEntries || [];
    for (const e of arr) layer._cellData.set(adapter.cellKey(e.col, e.row), e);
}

/**
 * 地面モードのセル塗り (ペン / 消しゴム)。
 * cellEntry には現在のパターン設定 (オフセット/回転/倍率) を snapshot して焼き込む。
 * → 同じパターン id でも設定が違えば別 fillKey になり、commit 時に別 Path に分かれる。
 */
function handleGroundCellPaint(col, row, tool = 'pen') {
    const layer = getOrCreateGroundCellLayer();
    if (!App.selectedLayerIds.includes(layer._layerId)) {
        App.selectedLayerIds = [layer._layerId];
        renderLayerList();
    }
    const adapter = ga();
    const key = adapter.cellKey(col, row);
    if (tool === 'pen') {
        const entry = makeGroundCellEntry(col, row);
        const tempFill = getGroundFill();
        addCellToLayer(layer, key, entry, tempFill);
    } else if (tool === 'eraser') {
        eraseCellFromLayer(layer, adapter, col, row);
    }
}

/** App.groundPattern + パターン設定 (offset/rotation/scale) を snapshot した cellEntry を作る。 */
function makeGroundCellEntry(col, row) {
    const s = App.groundPattern;
    if (s.mode === 'solid') {
        const c = s.solidColor || '#888888';
        return { col, row, fillKey: 'solid:' + c, mode: 'solid', solidColor: c };
    }
    const def = getPatternDef(s.id);
    const initScale = def?.scale ?? 1;
    const patOffX = App.patternOffsetX || 0;
    const patOffY = App.patternOffsetY || 0;
    const patRot = App.patternRotation || 0;
    const patScale = initScale * (App.patternScale ?? 1);
    return {
        col, row,
        fillKey: `pattern:${s.id}|${patOffX},${patOffY}|${patRot}|${patScale}`,
        mode: 'pattern',
        patternId: s.id,
        patOffX, patOffY, patRot, patScale,
    };
}

/** 塗りつぶしツールの上限セル数。超過時は中止して警告を出す。 */
const FILL_MAX_CELLS = 10000;

/**
 * セルレイヤー上で塗りつぶし (バケツ) を実行する。
 * - 範囲: 既に塗られたセルの外接矩形 (bbox) 内のみ。
 * - 起点が空セル: 同じく空セルの 4近傍連結領域を現在色で塗る。
 * - 起点が塗られたセル: 同じ fill を持つ 4近傍連結領域を現在色で塗り直す。
 * - 起点が bbox 外: ステータスバーに「セルレイヤーの範囲外です」を表示して中止。
 * - 拡散セル数が FILL_MAX_CELLS を超えたら中止 (部分塗りは行わない)。
 * @param {number} col
 * @param {number} row
 * @param {fabric.Group} layer - 対象セルレイヤー
 */
function fillCells(col, row, layer, _unused) {
    if (!layer._cellData || layer._cellData.size === 0) {
        setTransientStatus('セルレイヤーが空です');
        return;
    }
    const adapter = ga();

    // bbox: 既存セル (col, row) の最小/最大
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const e of layer._cellData.values()) {
        if (e.col < minC) minC = e.col;
        if (e.col > maxC) maxC = e.col;
        if (e.row < minR) minR = e.row;
        if (e.row > maxR) maxR = e.row;
    }
    if (col < minC || col > maxC || row < minR || row > maxR) {
        setTransientStatus('セルレイヤーの範囲外です');
        return;
    }

    // 新エントリ生成 (地面 or シンプル)
    const newEntryAt = (c, r) => layer._isGroundLayer
        ? makeGroundCellEntry(c, r)
        : (() => {
            const col2 = rgba(App.fillColor, App.fillOpacity);
            return { col: c, row: r, fillKey: 'solid:' + col2, mode: 'solid', solidColor: col2 };
        })();
    const sample = newEntryAt(col, row);
    const newFillKey = sample.fillKey;

    const startCell = layer._cellData.get(adapter.cellKey(col, row));
    const targetFillKey = startCell ? startCell.fillKey : null;
    if (newFillKey === targetFillKey) return;

    // BFS
    const visited = new Set([adapter.cellKey(col, row)]);
    const queue = [[col, row]];
    const toFill = [];
    while (queue.length > 0) {
        const [c, r] = queue.shift();
        if (c < minC || c > maxC || r < minR || r > maxR) continue;
        if (!adapter.cellExists(c, r)) continue;
        const cell = layer._cellData.get(adapter.cellKey(c, r));
        const cellFillKey = cell ? cell.fillKey : null;
        if (cellFillKey !== targetFillKey) continue;
        toFill.push([c, r]);
        if (toFill.length > FILL_MAX_CELLS) {
            setTransientStatus(`塗りつぶし上限 (${FILL_MAX_CELLS}セル) を超えました`);
            return;
        }
        for (const [nc, nr] of adapter.cellNeighbors(c, r)) {
            const k = adapter.cellKey(nc, nr);
            if (!visited.has(k)) { visited.add(k); queue.push([nc, nr]); }
        }
    }

    for (const [c, r] of toFill) {
        layer._cellData.set(adapter.cellKey(c, r), newEntryAt(c, r));
    }
    commitCellLayer(layer);
    pushHistory(`塗りつぶし (${toFill.length}セル)`);
}

/* ================================================================
   地形パターン（データのみ保持 — 描画UIは別途実装）
================================================================ */
// パターン用ソースキャンバスをキャッシュ (描画は重いので使い回す)。
/* ----------------------------------------------------------------
   パターン画像ロード (lazy)
   - フル画像 (patterns/full/) は使用時に load → HTMLImageElement をキャッシュ
   - ロード中は色フォールバック、完了後 renderAll で差し替わる
---------------------------------------------------------------- */
const _patternImageCache = new Map(); // id → { state: 'loading'|'ready'|'error', img?: HTMLImageElement }

/**
 * パターン id のフル画像をロードする。既に ready / loading なら何もしない。
 * 完了時に canvas を renderAll し、置かれた色フォールバックが画像に切り替わる。
 */
function loadPatternImage(id) {
    const def = getPatternDef(id);
    if (!def || !def.file) return;
    const cached = _patternImageCache.get(id);
    if (cached) return; // loading / ready / error いずれも再試行しない
    _patternImageCache.set(id, { state: 'loading' });
    const img = new Image();
    img.onload = () => {
        _patternImageCache.set(id, { state: 'ready', img });
        App.canvas?.requestRenderAll();
    };
    img.onerror = () => {
        _patternImageCache.set(id, { state: 'error' });
    };
    img.src = PATTERN_DIR_FULL + def.file;
}

/**
 * パターン id から fill / stroke 値を返す。
 * - 画像がキャッシュ済みなら fabric.Pattern (repeat)
 * - まだロードしてなければトリガ + 単色フォールバック
 * @param {string} id
 * @param {string} fallback - 単色フォールバック (def.color が無いときの最終フォールバック)
 * @returns {string|fabric.Pattern}
 */
function getPatternFill(id, fallback) {
    const def = getPatternDef(id);
    if (!def) return fallback || '#888888';
    const cached = _patternImageCache.get(id);
    if (cached?.state === 'ready') {
        return new fabric.Pattern({ source: cached.img, repeat: 'repeat' });
    }
    if (!cached) loadPatternImage(id);
    return def.color || fallback || '#888888';
}

/**
 * ストローク用の Pattern fill 値を返す。
 * 通常版 (getPatternFill) との違い: source 画像を PATTERNS[].scale × App.patternScale 分だけ
 * 事前にダウンスケールした canvas に差し替える。
 *
 * 理由: fabric.Pattern の patternTransform に scale を入れると、ストロークの場合 fabric が
 * ctx.transform 経由で適用する経路を取り、ストローク幾何 (lineWidth) まで scale 倍されてしまう。
 * → ズーム時に壁が想定より細くなる。フィルは pattern 座標系内で閉じるので影響しない。
 * 事前縮小 + patternTransform に scale を含めない、で回避する。
 */
const _strokeScaledSourceCache = new Map(); // 'id@scale' → HTMLCanvasElement
function getStrokePatternFill(id, fallback) {
    const def = getPatternDef(id);
    if (!def) return fallback || '#888888';
    const cached = _patternImageCache.get(id);
    if (cached?.state !== 'ready') {
        if (!cached) loadPatternImage(id);
        return def.color || fallback || '#888888';
    }
    const totalScale = (def.scale ?? 1) * (App.patternScale ?? 1);
    if (totalScale === 1) return new fabric.Pattern({ source: cached.img, repeat: 'repeat' });
    const key = `${id}@${totalScale}`;
    let scaled = _strokeScaledSourceCache.get(key);
    if (!scaled) {
        const sw = Math.max(1, Math.round(cached.img.naturalWidth * totalScale));
        const sh = Math.max(1, Math.round(cached.img.naturalHeight * totalScale));
        scaled = document.createElement('canvas');
        scaled.width = sw;
        scaled.height = sh;
        scaled.getContext('2d').drawImage(cached.img, 0, 0, sw, sh);
        _strokeScaledSourceCache.set(key, scaled);
    }
    return new fabric.Pattern({ source: scaled, repeat: 'repeat' });
}

/** App.groundPattern (solid / pattern) から fill 値を返す。 */
function getGroundFill() {
    const s = App.groundPattern;
    if (s.mode === 'solid') return s.solidColor || '#888888';
    return getPatternFill(s.id, s.solidColor);
}

/** App.wallPattern (solid / pattern) から stroke 値を返す。 */
function getWallStroke() {
    const s = App.wallPattern;
    if (s.mode === 'solid') return s.solidColor || '#333333';
    return getStrokePatternFill(s.id, s.solidColor);
}

/**
 * fill を一意に識別するキー文字列を返す。バケツ塗りつぶしの同色判定に使う
 * (fabric.Pattern は毎回 new するので参照比較ができず、ID 比較が必要)。
 */
function fillKeyFor(state) {
    if (!state) return null;
    if (state.mode === 'solid') return 'solid:' + (state.solidColor || '');
    return 'pattern:' + (state.id || '');
}
function getGroundFillKey() { return fillKeyFor(App.groundPattern); }

/**
 * activeTool=='ground'|'wall' のとき、選択中のサブツールを返す。
 * シンプルモード時は App.activeTool をそのまま返す (= 統一ディスパッチ用)。
 * @returns {string}
 */
function activeSubtool() {
    if (App.activeTool === 'ground') {
        return document.querySelector('#ground-tool-tiles .tool-tile.active')?.dataset.groundTool || 'cell';
    }
    if (App.activeTool === 'wall') {
        return document.querySelector('#wall-tool-tiles .tool-tile.active')?.dataset.wallTool || 'rect';
    }
    if (App.activeTool === 'room') {
        return document.querySelector('#room-tool-tiles .tool-tile.active')?.dataset.roomTool || 'rect';
    }
    return App.activeTool;
}

/** App.roomGroundPattern → fill 値 (solid/pattern)。 */
function getRoomGroundFill() {
    const s = App.roomGroundPattern;
    if (!s || s.mode === 'solid') return s?.solidColor || '#9b8c70';
    return getPatternFill(s.id, s.solidColor);
}
/** App.roomWallPattern → stroke 値 (solid/pattern)。 */
function getRoomWallStroke() {
    const s = App.roomWallPattern;
    if (!s || s.mode === 'solid') return s?.solidColor || '#5a5a5a';
    return getStrokePatternFill(s.id, s.solidColor);
}

/**
 * 部屋の子オブジェクト (地面/壁) にパターン変換用のスナップショットを書き込む。
 * snapshotPatternSettings の部屋版 — kind に応じて roomGroundPattern / roomWallPattern を参照する。
 */
function snapshotRoomPatternSettings(obj, kind) {
    if (!obj) return;
    const state = kind === 'wall' ? App.roomWallPattern : App.roomGroundPattern;
    const def = getPatternDef(state?.id);
    const initScale = def?.scale ?? 1;
    obj.set({
        _patternOffsetX: App.patternOffsetX || 0,
        _patternOffsetY: App.patternOffsetY || 0,
        _patternRotation: App.patternRotation || 0,
        _patternScale: initScale * (App.patternScale ?? 1),
    });
}

/** 影オブジェクトを共通設定から生成する。affectStroke=true で fill 透明の壁にも効かせる。 */
function makeShadowFromApp() {
    return new fabric.Shadow({
        color: App.shadowColor,
        blur: App.shadowBlur,
        offsetX: App.shadowOffsetX,
        offsetY: App.shadowOffsetY,
        affectStroke: true,
    });
}

/**
 * 部屋を作成する。同一ジオメトリで「地面 (fill=パターン)」「壁 (stroke=パターン+太さ)」の 2 つの
 * fabric.Object を makeShape ファクトリから生成し、fabric.Group にまとめてキャンバスへ追加する。
 * グループ解除すれば地面/壁の 2 レイヤーとして個別編集可能。
 * @param {string} typeName  - レイヤー名 (例 '部屋_矩形')
 * @param {function(object):fabric.Object} makeShape - スタイルを受け取って同型の fabric.Object を返すファクトリ
 */
function addRoom(typeName, makeShape) {
    const ground = makeShape({
        fill: getRoomGroundFill(),
        stroke: null,
        strokeWidth: 0,
        strokeDashArray: null,
    });
    if (!ground) return;
    ground.set({ _isRoomGround: true, objectCaching: false });
    snapshotRoomPatternSettings(ground, 'ground');
    applyPatternOrigin(ground);
    if (App.roomGroundShadowEnabled) ground.set('shadow', makeShadowFromApp());

    const wall = makeShape({
        fill: '',
        stroke: getRoomWallStroke(),
        strokeWidth: App.roomWallThickness || 12,
        strokeLineJoin: App.strokeLineJoin || 'miter',
        strokeLineCap: App.strokeLineCap || 'butt',
        strokeDashArray: null,
    });
    if (!wall) return;
    wall.set({ _isRoomWall: true, objectCaching: false });
    snapshotRoomPatternSettings(wall, 'wall');
    applyPatternOrigin(wall);
    if (App.roomWallShadowEnabled) wall.set('shadow', makeShadowFromApp());

    // 壁モード (canvas 直下) のストロークが zoom に正しく追従するのに対し、
    // new fabric.Group([ground, wall]) で包むと子ストロークが zoom と乖離する fabric の挙動がある。
    // ActiveSelection.toGroup() (= 既存のグループ化操作) と同じ経路を使えば正常に zoom スケールするので、
    // 一度両方を canvas に追加 → ActiveSelection 化 → toGroup() でまとめる。
    App.canvas.add(ground);
    App.canvas.add(wall);
    const sel = new fabric.ActiveSelection([ground, wall], { canvas: App.canvas });
    App.canvas.setActiveObject(sel);
    const group = sel.toGroup();
    group.set({
        _isRoomGroup: true,
        objectCaching: false,
        subTargetCheck: false,
    });
    App.canvas.discardActiveObject();
    addLayerObject(typeName, group);
}

/**
 * 現在の描画スタイル (fill / stroke / strokeWidth / 線種 / 名称プレフィクス / カテゴリフラグ) を返す。
 * シンプルモード: App.fillColor / strokeColor 等を反映
 * 地面: getGroundFill(), stroke なし
 * 壁:   fill 透明, getWallStroke(), strokeWidth = App.strokeWidth (共通)
 * @returns {{fill, stroke, strokeWidth:number, strokeDashArray, namePrefix:string, flag:string|null}}
 */
function getCurrentDrawStyle() {
    if (App.activeTool === 'ground') {
        return {
            fill: getGroundFill(),
            stroke: null,
            strokeWidth: 0,
            strokeDashArray: null,
            namePrefix: '地面_',
            flag: '_isGroundLayer',
        };
    }
    if (App.activeTool === 'wall') {
        return {
            fill: '', // 閉じた形状でも内側は透過
            stroke: getWallStroke(),
            strokeWidth: App.wallThickness || 12,
            strokeDashArray: null,
            namePrefix: '壁_',
            flag: '_isWallLayer',
        };
    }
    if (App.activeTool === 'room') {
        // プレビュー専用 — 確定時は addRoom が地面/壁を別個に生成するためここの flag/namePrefix は使われない
        return {
            fill: getRoomGroundFill(),
            stroke: getRoomWallStroke(),
            strokeWidth: App.roomWallThickness || 12,
            strokeDashArray: null,
            namePrefix: '部屋_',
            flag: null,
        };
    }
    // シンプルモード (既存挙動)
    return {
        fill: rgba(App.fillColor, App.fillOpacity),
        stroke: rgba(App.strokeColor, App.strokeOpacity),
        strokeWidth: App.strokeWidth,
        strokeDashArray: App.strokeDashArray,
        namePrefix: '',
        flag: null,
    };
}

/**
 * カテゴリ (地面/壁) を考慮してレイヤーを canvas に追加する。
 * 追加後、フラグ付きの場合は「同カテゴリの一番上の一個上」へ z 順を移動する。
 * @param {string} typeName - addLayerObject に渡す型名 (例 '矩形' / 'セル')。プレフィクス込みで '地面_矩形' 等
 * @param {fabric.Object} obj
 * @param {string|null} flag - '_isGroundLayer' | '_isWallLayer' | null (シンプル時)
 */
function addCategoryLayer(typeName, obj, flag) {
    if (flag) obj.set({ [flag]: true });
    snapshotPatternSettings(obj); // 現在のグローバル offset/rotation を obj にコピー
    applyPatternOrigin(obj); // 上記スナップショット + 世界 (0,0) アンカーを反映
    addLayerObject(typeName, obj);
    if (!flag) return;
    repositionByCategory(obj, flag);
}

/**
 * 新規追加されるレイヤーに、現在の影設定 (カテゴリ別 on/off + 共有 color/blur/offset)
 * を貼る。シンプル/地面/壁いずれも対応。既存オブジェクトには触らない。
 * affectStroke=true は fill 透明 (壁) でも影を効かせるため。
 */
function applyShadowAtCreate(obj) {
    if (!obj) return;
    const enabled = obj._isWallLayer ? App.wallShadowEnabled : obj._isGroundLayer ? App.groundShadowEnabled : App.simpleShadowEnabled;
    if (!enabled) return;
    obj.set({
        shadow: new fabric.Shadow({
            color: App.shadowColor,
            blur: App.shadowBlur,
            offsetX: App.shadowOffsetX,
            offsetY: App.shadowOffsetY,
            affectStroke: true,
        }),
    });
}

/**
 * オブジェクトに「パターン適用時のグローバル設定」をスナップショットして保存する。
 * 後で move 等でパターン再適用が必要になっても、これらの値を使うことで既存オブジェクトの
 * 見た目を維持できる (App グローバルが変わっても影響しない)。
 */
function snapshotPatternSettings(obj) {
    if (!obj) return;
    // 現在の activeTool に対応するパターン定義から初期倍率を取得 → ユーザー倍率と掛けて保存
    const def = currentPatternDef();
    const initScale = def?.scale ?? 1;
    obj.set({
        _patternOffsetX: App.patternOffsetX || 0,
        _patternOffsetY: App.patternOffsetY || 0,
        _patternRotation: App.patternRotation || 0,
        _patternScale: initScale * (App.patternScale ?? 1),
    });
}

/** 現在の activeTool ('ground' | 'wall') に対応する選択中パターン定義を返す。 */
function currentPatternDef() {
    if (App.activeTool === 'wall') return getPatternDef(App.wallPattern?.id);
    if (App.activeTool === 'ground') return getPatternDef(App.groundPattern?.id);
    return null;
}

/** state.mode === 'pattern' なのに id が PATTERNS に無い場合、単色モードに矯正する。 */
function normalizePatternState(state) {
    if (!state) return;
    if (state.mode === 'pattern' && !getPatternDef(state.id)) {
        state.mode = 'solid';
        state.id = null;
    }
}

/**
 * オブジェクトの fill / stroke に Pattern がついていれば、その offsetX/Y/transform を
 * 「世界 (0,0) アンカー (top-level shape のみ) + obj に保存されたオフセット/回転」で更新する。
 * グローバル App.patternOffsetX/Y/Rotation は新規作成時に snapshotPatternSettings で
 * obj にコピーされるため、既存オブジェクトはここを通っても見た目が変わらない。
 *
 * セル (group の子) は obj.left が group 内相対座標なので world アンカー計算をスキップし、
 * obj._patternOffsetX/Y だけ適用する (タイルサイズ = cellSize なら隣接セルが自然に揃う)。
 */
function applyPatternOrigin(obj) {
    if (!obj) return;
    applyPatternTransformOnObj(
        obj,
        obj._patternOffsetX || 0,
        obj._patternOffsetY || 0,
        obj._patternRotation || 0,
        obj._patternScale ?? 1,
    );
}

/**
 * cell など、グループに addWithUpdate された後に obj.left がグループ相対座標になる要素のため、
 * 作成時のワールド座標を別フィールドに保存しておく。applyPatternTransformOnObj はこれを優先して
 * 「ワールド原点アンカー」の offset を計算する。
 */
function snapshotWorldPosition(obj) {
    if (!obj) return;
    obj._worldLeft = obj.left || 0;
    obj._worldTop = obj.top || 0;
}

/**
 * preview 用: obj の snapshot ではなく現在の App グローバル + パターン定義の初期倍率を
 * その場で組み立てて適用する (プレビュー中にオフセット/回転/倍率を変えると即反映される)。
 */
function applyPatternOriginLive(obj) {
    if (!obj) return;
    if (App.activeTool === 'room') {
        // 部屋プレビュー: fill (地面パターン) と stroke (壁パターン) で別々の初期 scale を持つため個別適用
        const userScale = App.patternScale ?? 1;
        const gScale = (getPatternDef(App.roomGroundPattern?.id)?.scale ?? 1) * userScale;
        const wScale = (getPatternDef(App.roomWallPattern?.id)?.scale ?? 1) * userScale;
        applyPatternTransformParts(
            obj,
            App.patternOffsetX || 0,
            App.patternOffsetY || 0,
            App.patternRotation || 0,
            gScale,
            wScale,
        );
        return;
    }
    const def = currentPatternDef();
    const initScale = def?.scale ?? 1;
    applyPatternTransformOnObj(
        obj,
        App.patternOffsetX || 0,
        App.patternOffsetY || 0,
        App.patternRotation || 0,
        initScale * (App.patternScale ?? 1),
    );
}

/** fill と stroke に別 scale を適用する版 (部屋プレビュー用)。 */
function applyPatternTransformParts(obj, baseOffX, baseOffY, deg, fillScale, strokeScale) {
    const refLeft = (obj._worldLeft !== undefined) ? obj._worldLeft : (obj.left || 0);
    const refTop = (obj._worldTop !== undefined) ? obj._worldTop : (obj.top || 0);
    const offX = -refLeft + baseOffX;
    const offY = -refTop + baseOffY;
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const makeT = (s) => (s === 1 && deg === 0) ? null : [s * cos, s * sin, -s * sin, s * cos, 0, 0];
    let changed = false;
    if (obj.fill && typeof fabric !== 'undefined' && obj.fill instanceof fabric.Pattern) {
        obj.fill.offsetX = offX;
        obj.fill.offsetY = offY;
        obj.fill.patternTransform = makeT(fillScale);
        changed = true;
    }
    if (obj.stroke && typeof fabric !== 'undefined' && obj.stroke instanceof fabric.Pattern) {
        obj.stroke.offsetX = offX;
        obj.stroke.offsetY = offY;
        // ストロークでは scale を patternTransform に入れない (上記同様)。scale は事前に source 画像に焼き込み。
        obj.stroke.patternTransform = (deg === 0) ? null : [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180), 0, 0];
        changed = true;
    }
    if (changed) obj.dirty = true;
}

/** fill / stroke に Pattern があれば offset と patternTransform (scale * rotation) を反映する。 */
function applyPatternTransformOnObj(obj, baseOffX, baseOffY, deg, scale) {
    // _worldLeft があれば優先 (group の子は addWithUpdate 後に obj.left がグループ相対になるため)
    const refLeft = (obj._worldLeft !== undefined) ? obj._worldLeft : (obj.left || 0);
    const refTop = (obj._worldTop !== undefined) ? obj._worldTop : (obj.top || 0);
    const worldOffX = -refLeft;
    const worldOffY = -refTop;
    const offX = worldOffX + baseOffX;
    const offY = worldOffY + baseOffY;
    const s = scale || 1;
    const r = (deg * Math.PI) / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    // 倍率が 1 かつ回転が 0 なら transform 不要 (null)
    const transform = (s === 1 && deg === 0) ? null : [s * cos, s * sin, -s * sin, s * cos, 0, 0];
    let changed = false;
    if (obj.fill && typeof fabric !== 'undefined' && obj.fill instanceof fabric.Pattern) {
        obj.fill.offsetX = offX;
        obj.fill.offsetY = offY;
        obj.fill.patternTransform = transform;
        changed = true;
    }
    if (obj.stroke && typeof fabric !== 'undefined' && obj.stroke instanceof fabric.Pattern) {
        obj.stroke.offsetX = offX;
        obj.stroke.offsetY = offY;
        // ストロークでは patternTransform に scale を入れない (fabric が ctx.transform で適用するため
        // 線幅が崩れる)。scale は getStrokePatternFill で source 画像側に焼き込み済み。
        // 回転のみ patternTransform に反映する。
        obj.stroke.patternTransform = (deg === 0) ? null : [cos, sin, -sin, cos, 0, 0];
        changed = true;
    }
    if (changed) obj.dirty = true;
}

/**
 * 指定オブジェクトを「同カテゴリ (flag が立っている) の現存最上位の一個上」に移動する。
 * 同カテゴリが他に無い場合は移動しない (= addLayerObject 直後の最前面のまま)。
 */
function repositionByCategory(obj, flag) {
    const all = App.canvas.getObjects();
    const sameCategory = all.filter((o) => o[flag] && o !== obj);
    if (sameCategory.length === 0) return;
    const topExisting = sameCategory[sameCategory.length - 1];
    const targetIdx = all.indexOf(topExisting) + 1;
    App.canvas.moveTo(obj, targetIdx);
    renderLayerList();
}

/* ================================================================
   右クリックメニュー
================================================================ */
let ctxTarget = null;

/**
 * 右クリックメニューを表示し、ctxTarget に対象オブジェクトを保持する。
 * ロック状態に応じて「ロック」⇔「ロック解除」のラベルを切り替える。
 * @param {number} x - クライアント座標
 * @param {number} y
 * @param {fabric.Object} target
 */
function showContextMenu(x, y, target) {
    ctxTarget = target;
    const menu = document.getElementById('ctx-menu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('open');
    // ロック表示更新
    const lockItem = menu.querySelector('[data-action="lock"]');
    if (lockItem) {
        const icon = lockItem.querySelector('.material-symbols-outlined');
        icon.textContent = target.lockMovementX ? 'lock_open' : 'lock';
        lockItem.childNodes[1].textContent = target.lockMovementX ? 'ロック解除' : 'ロック';
    }
}
/** 右クリックメニューを閉じ、ctxTarget をクリアする。 */
function hideContextMenu() {
    document.getElementById('ctx-menu').classList.remove('open');
    ctxTarget = null;
}

/**
 * 右クリックメニューの各項目に対応する操作を実行する。
 * @param {'rename'|'duplicate'|'bring-front'|'send-back'|'lock'|'delete'} action
 */
function handleContextAction(action) {
    if (!ctxTarget) return;
    switch (action) {
        case 'rename': {
            const items = document.querySelectorAll('.layer-item');
            const item = [...items].find((i) => parseInt(i.dataset.id) === ctxTarget._layerId);
            if (item) item.dispatchEvent(new MouseEvent('dblclick'));
            break;
        }
        case 'duplicate': {
            ctxTarget.clone(function (cloned) {
                cloned.set({ left: cloned.left + 20, top: cloned.top + 20 });
                addLayerObject(ctxTarget._layerName + ' コピー', cloned);
            });
            break;
        }
        case 'bring-front': {
            App.canvas.bringToFront(ctxTarget);
            renderLayerList();
            App.canvas.renderAll();
            pushHistory(`${ctxTarget._layerName}を最前面へ`);
            break;
        }
        case 'send-back': {
            App.canvas.sendToBack(ctxTarget);
            renderLayerList();
            App.canvas.renderAll();
            pushHistory(`${ctxTarget._layerName}を最背面へ`);
            break;
        }
        case 'lock': {
            const locked = !ctxTarget.lockMovementX;
            ctxTarget.set({ lockMovementX: locked, lockMovementY: locked, lockRotation: locked, lockScalingX: locked, lockScalingY: locked, hasControls: !locked });
            App.canvas.renderAll();
            renderLayerList();
            pushHistory(locked ? `${ctxTarget._layerName}をロック` : `${ctxTarget._layerName}をロック解除`);
            break;
        }
        case 'delete': {
            const name = ctxTarget._layerName;
            App.canvas.remove(ctxTarget);
            App.canvas.discardActiveObject();
            App.selectedLayerIds = App.selectedLayerIds.filter((id) => id !== ctxTarget._layerId);
            renderLayerList();
            App.canvas.renderAll();
            pushHistory(`${name}を削除`);
            break;
        }
    }
    hideContextMenu();
}

/* ================================================================
   ツール切替
================================================================ */
/**
 * グリッド種別 (square/hex) を切替える。※ hex は未実装。
 * @param {'square'|'hex'} type
 */
function setGridType(type) {
    App.gridType = type;
    drawGrid();
}

/* ================================================================
   パターン選択 UI (Phase B-1)
   横にジャンルタブが並び、選択ジャンルでフィルタしたパターンを 4 列タイルグリッドで表示。
   左上は「単色」タイル (App.fillColor を使う)。Solid と Pattern のどちらでも選択可能。
================================================================ */
/**
 * パターン定義からサムネ画像 URL を返す (patterns/thumb/{file})。
 * 画像が存在しない場合は <img> の onerror でタイルを非表示にする (renderPatternPickerContent 内で処理)。
 */
function makePatternThumbUrl(def) {
    return PATTERN_DIR_THUMB + def.file;
}

/**
 * パターン選択 UI の「ジャンルタブ + タイルグリッド」部分のみを再描画する。
 * 単色行 (.pp-solid-row) は別管理 (Pickr インスタンスを保持するため innerHTML クリアしない)。
 * @param {HTMLElement} root - マウント先 (.pattern-picker)
 * @param {object} opts - renderPatternPicker と同等
 */
function renderPatternPickerContent(root, opts) {
    const state = opts.getState();
    const genreId = state.genreId || 'all';
    const content = root.querySelector('.pp-content');
    content.innerHTML = '';
    // ジャンルタブ
    const genresEl = document.createElement('div');
    genresEl.className = 'pp-genres';
    opts.genres.forEach((g) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pp-genre' + (g.id === genreId ? ' active' : '');
        btn.textContent = g.name;
        btn.addEventListener('click', () => {
            opts.setState({ ...opts.getState(), genreId: g.id });
            renderPatternPickerContent(root, opts);
        });
        genresEl.appendChild(btn);
    });
    content.appendChild(genresEl);

    // タイルグリッド (スクロール対応のためラッパで包む)
    const tilesScroll = document.createElement('div');
    tilesScroll.className = 'pp-tiles-scroll';
    const tilesEl = document.createElement('div');
    tilesEl.className = 'pp-tiles';
    tilesScroll.appendChild(tilesEl);
    // 単色タイル — 「全て」タブのときのみ左上に表示する
    if (genreId === 'all') {
        const solid = document.createElement('div');
        solid.className = 'pp-tile pp-tile-solid' + (state.mode === 'solid' ? ' active' : '');
        solid.title = '単色';
        const swatch = document.createElement('div');
        swatch.className = 'pp-solid-swatch';
        swatch.style.background = state.solidColor || '#888888';
        solid.appendChild(swatch);
        const solidLabel = document.createElement('div');
        solidLabel.className = 'pp-label';
        solidLabel.textContent = '単色';
        solid.appendChild(solidLabel);
        solid.addEventListener('click', () => {
            opts.setState({ ...opts.getState(), mode: 'solid' });
            renderPatternPickerContent(root, opts);
            updatePatternSolidRow(root, opts);
        });
        tilesEl.appendChild(solid);
    }

    // パターンタイル (フィルタ済み)。opts.category ('ground' | 'wall') 側のジャンルでフィルタ。
    const cat = opts.category;
    const filtered = opts.patterns.filter((p) => {
        if (!p[cat]) return false;
        return genreId === 'all' || p[cat] === genreId;
    });
    filtered.forEach((p) => {
        const tile = document.createElement('div');
        tile.className = 'pp-tile' + (state.mode === 'pattern' && state.id === p.id ? ' active' : '');
        tile.title = p.name;
        // サムネ <img> を直接埋めて onerror で要素ごと隠す (画像未配置は非表示)
        const thumb = document.createElement('img');
        thumb.src = makePatternThumbUrl(p);
        thumb.alt = '';
        thumb.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
        thumb.onerror = () => { tile.remove(); };
        tile.appendChild(thumb);
        const lbl = document.createElement('div');
        lbl.className = 'pp-label';
        lbl.textContent = p.name;
        tile.appendChild(lbl);
        tile.addEventListener('click', () => {
            opts.setState({ ...opts.getState(), mode: 'pattern', id: p.id });
            renderPatternPickerContent(root, opts);
            updatePatternSolidRow(root, opts);
        });
        tilesEl.appendChild(tile);
    });
    content.appendChild(tilesScroll);
}

/** 単色行 (.pp-solid-row) の表示/非表示を state.mode に合わせて更新する。 */
function updatePatternSolidRow(root, opts) {
    const row = root.querySelector('.pp-solid-row');
    if (!row) return;
    row.classList.toggle('hidden', opts.getState().mode !== 'solid');
}

/**
 * パターン選択 UI を root にマウントする (初回のみ DOM 構築 + Pickr 作成)。
 * 以後の表示更新は renderPatternPickerContent / updatePatternSolidRow を経由する。
 */
function mountPatternPicker(root, opts) {
    if (root._mounted) {
        renderPatternPickerContent(root, opts);
        updatePatternSolidRow(root, opts);
        return;
    }
    root.innerHTML = '<div class="pp-content"></div><div class="pp-solid-row hidden"><span>色</span><div class="pp-solid-trigger"></div></div>';
    const triggerEl = root.querySelector('.pp-solid-trigger');
    const state0 = opts.getState();
    const pickr = Pickr.create({
        el: triggerEl,
        theme: 'nano',
        default: state0.solidColor || '#888888',
        defaultRepresentation: 'HEX',
        components: { preview: true, opacity: false, hue: true, interaction: { input: true, save: false } },
    });
    // opacity 無しなので HEX (6桁) を強制
    if (pickr.setColorRepresentation) pickr.setColorRepresentation('HEX');
    pickr.on('change', (c, _src, instance) => {
        if (!c) return;
        // refreshPatternPickers から setColor を呼んだだけのときは無視
        // (Pickr は silent=true でも内部状態の差異で 'change' を発火することがある)。
        // これがないと、復元時に mode='pattern' が 'solid' に上書きされて
        // UI とデータが食い違う。
        if (root._suppressColorChange) return;
        const hex = c.toHEXA().toString().slice(0, 7);
        opts.setState({ ...opts.getState(), mode: 'solid', solidColor: hex });
        instance.applyColor(true);
        // 単色タイルのスウォッチも同期
        const sw = root.querySelector('.pp-tile-solid .pp-solid-swatch');
        if (sw) sw.style.background = hex;
    });
    attachEyedropper(pickr);
    root._pickr = pickr;
    root._mounted = true;
    renderPatternPickerContent(root, opts);
    updatePatternSolidRow(root, opts);
}

/** 地面/壁の両ピッカーをマウント or 更新する (初期化、復元時に呼ぶ)。 */
function refreshPatternPickers() {
    const groundRoot = document.getElementById('ground-pattern-picker');
    if (groundRoot) {
        mountPatternPicker(groundRoot, {
            category: 'ground',
            patterns: PATTERNS,
            genres: GROUND_GENRES,
            getState: () => App.groundPattern,
            setState: (s) => {
                App.groundPattern = s;
                pushHistoryDebounced('地面パターンを変更');
            },
        });
        if (groundRoot._pickr) {
            groundRoot._suppressColorChange = true;
            groundRoot._pickr.setColor(App.groundPattern.solidColor || '#888888', true);
            setTimeout(() => { groundRoot._suppressColorChange = false; }, 0);
        }
    }
    const wallRoot = document.getElementById('wall-pattern-picker');
    if (wallRoot) {
        mountPatternPicker(wallRoot, {
            category: 'wall',
            patterns: PATTERNS,
            genres: WALL_GENRES,
            getState: () => App.wallPattern,
            setState: (s) => {
                App.wallPattern = s;
                pushHistoryDebounced('壁パターンを変更');
            },
        });
        if (wallRoot._pickr) {
            wallRoot._suppressColorChange = true;
            wallRoot._pickr.setColor(App.wallPattern.solidColor || '#888888', true);
            setTimeout(() => { wallRoot._suppressColorChange = false; }, 0);
        }
    }
    // 部屋: 地面 / 壁の 2 つを並べる
    const roomGroundRoot = document.getElementById('room-ground-pattern-picker');
    if (roomGroundRoot) {
        mountPatternPicker(roomGroundRoot, {
            category: 'ground',
            patterns: PATTERNS,
            genres: GROUND_GENRES,
            getState: () => App.roomGroundPattern,
            setState: (s) => {
                App.roomGroundPattern = s;
                pushHistoryDebounced('部屋・地面パターンを変更');
            },
        });
        if (roomGroundRoot._pickr) {
            roomGroundRoot._suppressColorChange = true;
            roomGroundRoot._pickr.setColor(App.roomGroundPattern.solidColor || '#9b8c70', true);
            setTimeout(() => { roomGroundRoot._suppressColorChange = false; }, 0);
        }
    }
    const roomWallRoot = document.getElementById('room-wall-pattern-picker');
    if (roomWallRoot) {
        mountPatternPicker(roomWallRoot, {
            category: 'wall',
            patterns: PATTERNS,
            genres: WALL_GENRES,
            getState: () => App.roomWallPattern,
            setState: (s) => {
                App.roomWallPattern = s;
                pushHistoryDebounced('部屋・壁パターンを変更');
            },
        });
        if (roomWallRoot._pickr) {
            roomWallRoot._suppressColorChange = true;
            roomWallRoot._pickr.setColor(App.roomWallPattern.solidColor || '#5a5a5a', true);
            setTimeout(() => { roomWallRoot._suppressColorChange = false; }, 0);
        }
    }
}

/**
 * 編集モード (シンプル/地図) を切替える。
 * body[data-edit-mode] を更新して CSS でツールバー/プロパティパネルの表示切替を行い、
 * activeTool を 'select' にリセットする (新モードで非表示のツールが選択された状態を防ぐため)。
 * トグル UI の active 状態も同期する。
 * @param {'simple'|'map'} mode
 */
function setEditMode(mode) {
    if (mode !== 'simple' && mode !== 'map') return;
    App.editMode = mode;
    document.body.setAttribute('data-edit-mode', mode);
    document.querySelectorAll('.mode-toggle [data-mode]').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
    setActiveTool('select');
    pushHistory(mode === 'simple' ? 'シンプルモードへ切替' : '地図モードへ切替');
}

/**
 * アクティブツールを切替える。描画途中の状態 (_drawing, _pathPoints 等) を全てリセットし、
 * ツールバー / プロパティパネル / canvas の selectable・evented・isDrawingMode を更新する。
 * セルツール選択時は最上位セルレイヤーを自動選択、フリーハンド時はブラシ設定を反映。
 * @param {string} toolName
 */
/**
 * プロパティパネルのグループ表示を activeTool + activeSubtool に基づいて更新する。
 * 通常は activeTool に対応する .prop-group だけが .active になるが、
 * 地面モードでセルサブツール選択時は cell prop-group も追加で .active にして
 * 「ペン/消しゴム/塗りつぶし切替 + セルレイヤー追加ボタン」を再利用する。
 */
function refreshPropGroupVisibility() {
    document.querySelectorAll('#prop-panel .prop-group').forEach((pg) => pg.classList.toggle('active', pg.dataset.prop === App.activeTool));
    const sub = activeSubtool();
    // 地形(地面)+セルのとき: セルツールタイル群を地面パネルの「ツール選択」直下へ動的に移動。
    // それ以外のとき: cell prop-group の中 (本来の位置) に戻す。
    const cellBlock = document.getElementById('cell-tools-block');
    const cellHome = document.querySelector('.prop-group[data-prop="cell"] .s-sec');
    if (App.activeTool === 'ground' && sub === 'cell') {
        const groundTiles = document.getElementById('ground-tool-tiles');
        if (cellBlock && groundTiles && cellBlock.previousElementSibling !== groundTiles) {
            groundTiles.parentElement.insertBefore(cellBlock, groundTiles.nextSibling);
        }
    } else {
        if (cellBlock && cellHome && cellBlock.parentElement !== cellHome) {
            cellHome.appendChild(cellBlock);
        }
    }
}

/** 進行中の描画状態 (プレビュー / 1クリック目記録 / 折線・多角形・曲線の点列) をすべてリセットする。 */
function resetDrawingState() {
    removePreview();
    App._drawing = null;
    App._lineStart = null;
    App._pathPoints = [];
    App._polygonPoints = [];
    App._curvePoints = [];
    App.canvas?.requestRenderAll();
}

function setActiveTool(toolName) {
    removePreview();
    App._drawing = null;
    App._lineStart = null;
    App._pathPoints = [];
    App._polygonPoints = [];
    App._curvePoints = [];
    App._exportMode = false;
    App._exportDrag = null;
    App._exportRect = null;
    App.canvas.isDrawingMode = false;
    App.activeTool = toolName;

    // ツールバーボタンのアクティブ状態
    document.querySelectorAll('#toolbar .tb-btn[data-tool]').forEach((btn) => btn.classList.toggle('active', btn.dataset.tool === toolName));

    // プロパティパネル: data-prop グループを切替
    refreshPropGroupVisibility();

    // シンプルモードの描画ツールと同様、地図モードのタブも canvas オブジェクト選択は無効
    const isSelect = toolName === 'select' || toolName === 'settings';
    App.canvas.selection = isSelect;
    getMapLayers().forEach((obj) => {
        // テキストツール時は既存テキストをクリックで編集できるよう、selectable + evented を残す
        const keepActive = isSelect || (toolName === 'text' && obj._isMapText);
        obj.set({ selectable: keepActive, evented: keepActive });
    });
    if (!isSelect) App.canvas.discardActiveObject();

    // セルツール切替時: 最上位セルレイヤーを自動選択
    if (toolName === 'cell') {
        const cellLayer = getMapLayers()
            .reverse()
            .find((o) => o._isCellLayer);
        if (cellLayer && !App.selectedLayerIds.includes(cellLayer._layerId)) {
            App.selectedLayerIds = [cellLayer._layerId];
            renderLayerList();
        }
    }

    if (toolName === 'freehand') {
        App.canvas.isDrawingMode = true;
        setFreehandBrush(App.freehandBrush);
        // セル同様、最上位のフリーハンドレイヤーを自動選択 (無ければ新規作成は最初の path:created に委ねる)
        const fl = getMapLayers().reverse().find((o) => o._isFreehandLayer);
        if (fl && !App.selectedLayerIds.includes(fl._layerId)) {
            App.selectedLayerIds = [fl._layerId];
            renderLayerList();
        }
    }
    App.canvas.defaultCursor = defaultCursorForTool(toolName);
    App.canvas.renderAll();
    updateFillStrokeVisibility();
    updateSelectionInfo();
}

/**
 * 現在ツールに対するキャンバスのデフォルトカーソルを返す。
 * パン中は別途 'move' に切替えるので、ここではツール本来の見た目を返す。
 *   - text: text カーソル
 *   - freehand: crosshair
 *   - その他全て: default (selectツールのオブジェクト上ホバーは hoverCursor='grab' で別途設定)
 */
function defaultCursorForTool(toolName) {
    if (toolName === 'text') return 'text';
    if (toolName === 'freehand') return 'crosshair';
    return 'default';
}

/* ================================================================
   テキストスタイル操作 (ボールド/イタリック/下線/取消線 + 部分選択対応)
================================================================ */
/**
 * 現在「テキストスタイルを適用すべき対象」を返す。
 * - 編集中のテキスト + 選択範囲あり → { obj, selStart, selEnd }
 * - 選択中のテキスト (編集なし or 編集中で選択なし) → { obj }
 * - 該当なし → null
 */
function getTextStyleTarget() {
    const active = App.canvas?.getActiveObject();
    if (active && active._isMapText) {
        if (active.isEditing && active.selectionStart !== active.selectionEnd) {
            return { obj: active, selStart: active.selectionStart, selEnd: active.selectionEnd };
        }
        return { obj: active };
    }
    return null;
}

/** スタイル名 → Fabric Textbox プロパティ名 */
function textStyleKey(s) {
    if (s === 'bold') return 'fontWeight';
    if (s === 'italic') return 'fontStyle';
    if (s === 'underline') return 'underline';
    if (s === 'linethrough') return 'linethrough';
    return null;
}

/** 現在のスタイル値から、トグル後に適用すべきプロパティ集合を返す。 */
function computeToggleProps(s, current) {
    if (s === 'bold') {
        const isBold = current === 'bold' || current === 700 || current === '700';
        return { fontWeight: isBold ? 'normal' : 'bold' };
    }
    if (s === 'italic') return { fontStyle: current === 'italic' ? 'normal' : 'italic' };
    if (s === 'underline') return { underline: !current };
    if (s === 'linethrough') return { linethrough: !current };
    return {};
}

/** テキストにスタイルを適用 — 選択範囲があれば setSelectionStyles、なければ obj 全体に。 */
function applyTextStyle(styleObj) {
    const t = getTextStyleTarget();
    if (!t) return false;
    if (t.selStart !== undefined) {
        t.obj.setSelectionStyles(styleObj, t.selStart, t.selEnd);
    } else {
        t.obj.set(styleObj);
    }
    t.obj.dirty = true;
    App.canvas.requestRenderAll();
    return true;
}

/** 選択範囲または全体の代表スタイル値を取得する。 */
function readTextStyle(propKey) {
    const t = getTextStyleTarget();
    if (!t) return null;
    if (t.selStart !== undefined) {
        const styles = t.obj.getSelectionStyles(t.selStart, t.selEnd);
        return styles[0]?.[propKey] ?? t.obj[propKey];
    }
    return t.obj[propKey];
}

/** スタイルトグルボタンの active 状態を、対象テキスト/選択範囲のスタイルに合わせる。 */
function refreshTextStyleButtons() {
    document.querySelectorAll('#text-style-tiles .tool-tile').forEach((tile) => {
        const s = tile.dataset.textStyle;
        const key = textStyleKey(s);
        if (!key) return;
        const val = readTextStyle(key);
        let active = false;
        if (s === 'bold') active = val === 'bold' || val === 700 || val === '700';
        else if (s === 'italic') active = val === 'italic';
        else active = !!val;
        tile.classList.toggle('active', active);
    });
}

/** 対象テキストのフォント/サイズを props 入力欄に反映する。 */
function syncTextInputsFromTarget() {
    const t = getTextStyleTarget();
    if (!t) return;
    const fontKey = t.selStart !== undefined ? (t.obj.getSelectionStyles(t.selStart, t.selEnd)[0]?.fontFamily ?? t.obj.fontFamily) : t.obj.fontFamily;
    const sizeKey = t.selStart !== undefined ? (t.obj.getSelectionStyles(t.selStart, t.selEnd)[0]?.fontSize ?? t.obj.fontSize) : t.obj.fontSize;
    const fontSel = document.getElementById('text-font');
    if (fontSel && fontKey) fontSel.value = fontKey;
    const sizeInp = document.getElementById('text-size');
    if (sizeInp && sizeKey) sizeInp.value = Math.round(sizeKey);
}

/* ================================================================
   画像挿入
================================================================ */
/**
 * ファイル選択ダイアログから渡された画像を DataURL 化して fabric.Image として配置する。
 * @param {Event} e - change イベント
 */
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        fabric.Image.fromURL(evt.target.result, (img) => {
            img.set({ left: 0, top: 0, objectCaching: false });
            addLayerObject('画像', img);
        });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

/* ================================================================
   ステータスバー
================================================================ */
/** ステータスバーのズーム率とグリッドサイズ表示を更新する。 */
function updateStatusBar() {
    if (!App.canvas) return;
    document.getElementById('sb-zoom').textContent = Math.round(App.canvas.getZoom() * 100) + '%';
    document.getElementById('sb-grid').textContent = App.cellSize + 'px';
}

/* ================================================================
   エクスポート
================================================================ */
/**
 * 全マップレイヤーのバウンディングを内包し、セル境界に丸めた出力範囲を算出する。
 * サムネ生成と「範囲未指定時のフォールバック」に使う。
 * @returns {{x:number,y:number,w:number,h:number}|null} レイヤーが無ければ null
 */
function calcAutoExportRect() {
    const objs = getMapLayers();
    if (objs.length === 0) return null;
    let x1 = Infinity,
        y1 = Infinity,
        x2 = -Infinity,
        y2 = -Infinity;
    objs.forEach((o) => {
        const br = o.getBoundingRect(true);
        const zoom = App.canvas.getZoom(),
            vpt = App.canvas.viewportTransform;
        const oLeft = (br.left - vpt[4]) / zoom,
            oTop = (br.top - vpt[5]) / zoom;
        x1 = Math.min(x1, oLeft);
        y1 = Math.min(y1, oTop);
        x2 = Math.max(x2, oLeft + br.width / zoom);
        y2 = Math.max(y2, oTop + br.height / zoom);
    });
    const cs = App.cellSize;
    x1 = Math.floor(x1 / cs) * cs;
    y1 = Math.floor(y1 / cs) * cs;
    x2 = Math.ceil(x2 / cs) * cs;
    y2 = Math.ceil(y2 / cs) * cs;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * 指定範囲を等倍でレンダリングして PNG DataURL を返す (プレビュー用)。
 * canvas のサイズ・viewportTransform・グリッド色・背景色を一時的に書き換え、復元する。
 * @param {{x:number,y:number,w:number,h:number}} r - 出力範囲 (キャンバス座標)
 * @param {boolean} includeGrid - グリッドを焼き込むか
 * @param {'transparent'|'white'} bgMode
 * @returns {string} data:image/png
 */
function renderExportRegion(r, includeGrid, bgMode) {
    const savedVpt = App.canvas.viewportTransform.slice();
    const savedW = App.canvas.width,
        savedH = App.canvas.height;
    const savedGridColor = App.gridColor;
    const savedBg = App.canvas.backgroundColor;
    const savedRect = App._exportRect;
    const savedMode = App._exportMode;
    const savedSnap = App._snapPt;

    if (!includeGrid) App.gridColor = 'rgba(0,0,0,0)';
    if (bgMode === 'white') App.canvas.backgroundColor = '#ffffff';
    else App.canvas.backgroundColor = null;
    App._exportRect = null;
    App._exportMode = false;
    App._snapPt = null;

    App.canvas.setDimensions({ width: Math.round(r.w), height: Math.round(r.h) });
    App.canvas.setViewportTransform([1, 0, 0, 1, -r.x, -r.y]);
    App.canvas.renderAll();

    const dataURL = App.canvas.getElement().toDataURL('image/png');

    App.gridColor = savedGridColor;
    App.canvas.backgroundColor = savedBg;
    App._exportRect = savedRect;
    App._exportMode = savedMode;
    App._snapPt = savedSnap;
    App.canvas.setDimensions({ width: savedW, height: savedH });
    App.canvas.setViewportTransform(savedVpt);
    App.canvas.renderAll();
    return dataURL;
}

/** 出力モーダルのプレビュー画像を現在の設定で再生成する。 */
function updateExportPreview() {
    const r = App._exportRect;
    if (!r || r.w < 1 || r.h < 1) return;
    const includeGrid = document.getElementById('export-grid')?.checked ?? true;
    const bg = document.querySelector('input[name="export-bg"]:checked')?.value || 'transparent';
    const preview = renderExportRegion(r, includeGrid, bg);
    document.getElementById('export-preview-img').src = preview;
}

/**
 * 出力モーダルを開く。範囲情報のテキスト・初期セル解像度・プレビューを設定する。
 * App._exportRect が事前に設定されている前提。
 */
function openExportModal() {
    const r = App._exportRect;
    if (!r || r.w < 1 || r.h < 1) return;
    const cs = App.cellSize;
    document.getElementById('export-modal-info').textContent = `${(r.w / cs).toFixed(1)} × ${(r.h / cs).toFixed(1)} マス  (内部: ${Math.round(r.w)} × ${Math.round(r.h)} px)`;
    const cellPxEl = document.getElementById('export-cell-px');
    if (cellPxEl && !cellPxEl._userChanged) cellPxEl.value = cs;
    updateExportOutputSize();
    updateExportPreview();
    IKLab.openModal('export-modal');
    IKLab.initNumSpinners(document.getElementById('export-modal'));
}

/**
 * 出力時の拡大率 = 指定セル解像度 / 内部セルサイズ。
 * @returns {number}
 */
function getExportScale() {
    const cellPx = parseInt(document.getElementById('export-cell-px')?.value) || 50;
    return cellPx / App.cellSize;
}

/** モーダル右上の「出力サイズ ◯×◯ px」表示を更新する。 */
function updateExportOutputSize() {
    const el = document.getElementById('export-output-size');
    if (!el) return;
    const r = App._exportRect;
    if (!r) {
        el.textContent = '';
        return;
    }
    const scale = getExportScale();
    el.textContent = `出力サイズ: ${Math.round(r.w * scale)} × ${Math.round(r.h * scale)} px`;
}

/**
 * 出力ボタン押下時の本処理。PNG/JPEG は canvas.getElement().toDataURL でグリッド含む実描画を、
 * SVG は canvas.toSVG で出力する。canvas の dimensions / viewportTransform / 背景は
 * 一時的に書き換え、終了時に必ず復元する。
 */
function handleExport() {
    const r = App._exportRect;
    if (!r || r.w < 1 || r.h < 1) {
        alert('出力範囲を指定してください');
        return;
    }

    const fmt = document.querySelector('input[name="export-format"]:checked').value;
    const bg = document.querySelector('input[name="export-bg"]:checked').value;
    const scale = getExportScale();
    const includeGrid = document.getElementById('export-grid').checked;

    const savedVpt = App.canvas.viewportTransform.slice();
    const savedW = App.canvas.width,
        savedH = App.canvas.height;
    const savedGridColor = App.gridColor;
    const savedBg = App.canvas.backgroundColor;
    const savedRect = App._exportRect;

    if (!includeGrid) App.gridColor = 'rgba(0,0,0,0)';
    if (bg === 'white') App.canvas.backgroundColor = '#ffffff';
    else if (bg === 'transparent') App.canvas.backgroundColor = null;
    App._exportRect = null;

    const outW = Math.round(r.w * scale),
        outH = Math.round(r.h * scale);
    App.canvas.setDimensions({ width: outW, height: outH });
    App.canvas.setViewportTransform([scale, 0, 0, scale, -r.x * scale, -r.y * scale]);
    App.canvas.renderAll();

    if (fmt === 'svg') {
        const svgStr = App.canvas.toSVG();
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'trpg-map.svg';
        a.click();
        URL.revokeObjectURL(url);
    } else {
        // getElement() で実際の描画結果（グリッド含む）をキャプチャ
        const mimeType = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
        const quality = fmt === 'jpeg' ? 0.92 : undefined;
        const dataURL = App.canvas.getElement().toDataURL(mimeType, quality);
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = `trpg-map.${fmt === 'jpeg' ? 'jpg' : 'png'}`;
        a.click();
    }

    App.gridColor = savedGridColor;
    App.canvas.backgroundColor = savedBg;
    App._exportRect = savedRect;
    App.canvas.setDimensions({ width: savedW, height: savedH });
    App.canvas.setViewportTransform(savedVpt);
    App.canvas.renderAll();
    IKLab.closeModal('export-modal');
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('export-btn')?.addEventListener('click', handleExport);
    document.getElementById('export-cell-px')?.addEventListener('input', () => {
        document.getElementById('export-cell-px')._userChanged = true;
        updateExportOutputSize();
    });
    // プレビュー更新: グリッド・背景の変更を反映
    document.getElementById('export-grid')?.addEventListener('change', updateExportPreview);
    document.querySelectorAll('input[name="export-bg"]').forEach((r) => r.addEventListener('change', updateExportPreview));
});

/* ================================================================
   マップ I/O — IndexedDB との読み書きと自動保存

   起動時: ?id=xxx を読み取り該当レコードをロード。無効なら一覧へリダイレクト。
   編集中: pushHistory() のたびに scheduleAutoSave() がデバウンス起動。
   自動保存はサムネを再生成しない (重い)。サムネは明示保存 / 離脱時のみ生成。
   Ctrl+S = 明示保存 (デバウンスをフラッシュ + サムネ生成)。
   DB アクセス層 (openDB/dbGet/dbPut 等) と SAVE_CUSTOM_PROPS は
   map_storage.js で定義済み。
================================================================ */

/**
 * 現在のマップ状態をシリアライズ可能なオブジェクトに変換する。
 * Fabric の toJSON に SAVE_CUSTOM_PROPS を渡してマップ固有プロパティ (_layerId 等) を含める。
 * @returns {object}
 */
function buildSaveData() {
    // ツール/パターン/フリーハンドの「最後に選んでいた値」も保存する。
    // → リロード後も同じ選択状態から再開できる (UX 向上)。
    // 注意: 履歴 (Undo/Redo) のスナップショットは serializeHistorySnapshot 側で別管理なので、
    //       これらをここに含めても履歴を汚さない。
    return {
        version: 1,
        cellSize: App.cellSize,
        gridType: App.gridType,
        editMode: App.editMode,
        groundTool: App.groundTool,
        groundPattern: App.groundPattern,
        wallTool: App.wallTool,
        wallPattern: App.wallPattern,
        wallThickness: App.wallThickness,
        roomTool: App.roomTool,
        roomGroundPattern: App.roomGroundPattern,
        roomWallPattern: App.roomWallPattern,
        roomWallThickness: App.roomWallThickness,
        roomGroundShadowEnabled: App.roomGroundShadowEnabled,
        roomWallShadowEnabled: App.roomWallShadowEnabled,
        freehandBrush: App.freehandBrush,
        freehandWidth: App.freehandWidth,
        freehandColor: App.freehandColor,
        freehandOpacity: App.freehandOpacity,
        freehandDecimation: App.freehandDecimation,
        freehandPressure: App.freehandPressure,
        gridColor: App.gridColor,
        gridLineWidth: App.gridLineWidth,
        gridDashArray: App.gridDashArray,
        nextLayerId: App.nextLayerId,
        layerCounters: App.layerCounters,
        viewportTransform: App.canvas.viewportTransform.slice(),
        canvas: (App.canvas.getObjects().forEach((o) => { if (o._isCellLayer) syncCellEntries(o); }), App.canvas.toJSON(SAVE_CUSTOM_PROPS)),
    };
}

/**
 * buildSaveData の逆操作。App 設定とキャンバスを復元し、セル/地形レイヤーの
 * _cellData Map を子要素から再構築する (toJSON では Map が落ちるため)。
 * @param {object} data - buildSaveData() の出力
 */
function restoreSaveData(data) {
    App._isRestoring = true;
    App.cellSize = data.cellSize || 72;
    App.gridType = data.gridType || 'square';
    setEditMode(data.editMode === 'map' ? 'map' : 'simple');
    if (data.groundTool) App.groundTool = data.groundTool;
    if (data.groundPattern) App.groundPattern = data.groundPattern;
    if (data.wallTool) App.wallTool = data.wallTool;
    if (data.wallPattern) App.wallPattern = data.wallPattern;
    if (data.roomTool) App.roomTool = data.roomTool;
    if (data.roomGroundPattern) App.roomGroundPattern = data.roomGroundPattern;
    if (data.roomWallPattern) App.roomWallPattern = data.roomWallPattern;
    if (typeof data.roomWallThickness === 'number') App.roomWallThickness = data.roomWallThickness;
    if (typeof data.roomGroundShadowEnabled === 'boolean') App.roomGroundShadowEnabled = data.roomGroundShadowEnabled;
    if (typeof data.roomWallShadowEnabled === 'boolean') App.roomWallShadowEnabled = data.roomWallShadowEnabled;
    // 旧版で保存された未知パターン ID は単色にフォールバックして UI と実状態の食い違いを防ぐ
    normalizePatternState(App.groundPattern);
    normalizePatternState(App.wallPattern);
    normalizePatternState(App.roomGroundPattern);
    normalizePatternState(App.roomWallPattern);
    if (typeof data.wallThickness === 'number') App.wallThickness = data.wallThickness;
    const wt = document.getElementById('wall-thickness');
    if (wt) wt.value = App.wallThickness;
    const rwt = document.getElementById('room-wall-thickness');
    if (rwt) rwt.value = App.roomWallThickness;
    const rgs = document.getElementById('room-ground-shadow-enabled');
    if (rgs) rgs.checked = !!App.roomGroundShadowEnabled;
    const rws = document.getElementById('room-wall-shadow-enabled');
    if (rws) rws.checked = !!App.roomWallShadowEnabled;
    if (data.freehandBrush) App.freehandBrush = data.freehandBrush;
    if (typeof data.freehandWidth === 'number') App.freehandWidth = data.freehandWidth;
    if (data.freehandColor) App.freehandColor = data.freehandColor;
    if (typeof data.freehandOpacity === 'number') App.freehandOpacity = data.freehandOpacity;
    if (typeof data.freehandDecimation === 'number') App.freehandDecimation = data.freehandDecimation;
    if (typeof data.freehandPressure === 'boolean') App.freehandPressure = data.freehandPressure;
    // 復元値を各 input/タイルに反映
    const fwEl = document.getElementById('freehand-width');
    if (fwEl) fwEl.value = App.freehandWidth;
    const fdEl = document.getElementById('freehand-decimation');
    if (fdEl) fdEl.value = App.freehandDecimation;
    const fpEl = document.getElementById('freehand-pressure');
    if (fpEl) fpEl.checked = App.freehandPressure;
    App.gridColor = data.gridColor || '#000000ff';
    App.gridLineWidth = data.gridLineWidth || 1;
    // 新規マップ (= 未保存の data.gridDashArray が undefined) は点線をデフォルトに。
    // 明示的に null (実線) で保存されたマップは尊重するため、!== undefined をチェック。
    App.gridDashArray = data.gridDashArray !== undefined ? data.gridDashArray : [2, 4];
    // ロード値に合わせて radio button も同期
    const styleId = App.gridDashArray === null ? 'gs-solid'
        : (App.gridDashArray && App.gridDashArray[0] === 2) ? 'gs-dot'
        : 'gs-dash';
    const styleEl = document.getElementById(styleId);
    if (styleEl) styleEl.checked = true;
    App.nextLayerId = data.nextLayerId || 10;
    App.layerCounters = data.layerCounters || {};
    App.selectedLayerIds = [];
    App._pathPoints = [];
    App._polygonPoints = [];
    App._curvePoints = [];
    App._lineStart = null;
    App._drawing = null;

    App.canvas.loadFromJSON(data.canvas, function () {
        if (data.viewportTransform) App.canvas.setViewportTransform(data.viewportTransform);
        const adapter = ga();
        App.canvas.getObjects().forEach((obj) => {
            if ((obj._isCellLayer || obj._isTerrainLayer) && obj.type === 'group') {
                // 新規作成時 (createCellLayer / createGroundCellLayer) と同じ設定にして挙動を揃える。
                obj.set({ objectCaching: false, noScaleCache: false });
                // _cellEntries (シリアライズ済み配列) から _cellData Map を復元 → commit で Path 再生成
                rebuildCellDataFromEntries(obj, adapter);
                commitCellLayer(obj);
            }
            if (obj._isRoomGroup && obj.type === 'group') {
                obj.set({ objectCaching: false, noScaleCache: false });
                if (typeof obj.getObjects === 'function') {
                    obj.getObjects().forEach((c) => c.set({ objectCaching: false, noScaleCache: false }));
                }
            }
        });
        renderLayerList();
        // 地面/壁ツールタイル + パターンピッカーを App 状態に同期
        document.querySelectorAll('#ground-tool-tiles .tool-tile').forEach((t) => t.classList.toggle('active', t.dataset.groundTool === App.groundTool));
        document.querySelectorAll('#wall-tool-tiles .tool-tile').forEach((t) => t.classList.toggle('active', t.dataset.wallTool === App.wallTool));
        document.querySelectorAll('#room-tool-tiles .tool-tile').forEach((t) => t.classList.toggle('active', t.dataset.roomTool === App.roomTool));
        refreshPatternPickers();
        // フリーハンドブラシタイル & 実ブラシも復元後の App.freehandBrush に同期
        document.querySelectorAll('#freehand-brush-tiles .tool-tile[data-freehand-brush]').forEach((t) => t.classList.toggle('active', t.dataset.freehandBrush === App.freehandBrush));
        if (App.canvas?.isDrawingMode) setFreehandBrush(App.freehandBrush);
        App.canvas.renderAll();
        drawGrid();
        clearHistory();
        App._isRestoring = false;
    });
}

/**
 * 全レイヤーの範囲を 160×120 以内に収めた PNG サムネ DataURL を生成する。
 * 保存レコードの thumbnail フィールドに使う。
 * @returns {string|null} レイヤーが無ければ null
 */
function generateThumbnail() {
    // 現在のビューポート (ユーザーが見ている状態) をそのままサムネとして使う。
    // 編集 UI (出力範囲枠 / スナップマーカー) は一時的に隠して再描画してから DOM canvas
    // の生ピクセルを取得し、終了時に元へ戻す。サイズは縮小なし (一覧側 CSS で縮小表示)。
    const savedRect = App._exportRect;
    const savedMode = App._exportMode;
    const savedSnap = App._snapPt;
    App._exportRect = null;
    App._exportMode = false;
    App._snapPt = null;
    App.canvas.renderAll();
    const url = App.canvas.getElement().toDataURL('image/png');
    App._exportRect = savedRect;
    App._exportMode = savedMode;
    App._snapPt = savedSnap;
    App.canvas.renderAll();
    return url;
}

/* ----------------------------------------------------------------
   ロード
---------------------------------------------------------------- */

/**
 * URL の ?id= を読み取り、対応するマップをロードする。
 * 無効・存在しない id の場合は一覧ページにリダイレクト。
 */
async function loadMapFromUrl() {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
        location.replace('map_list.html');
        return;
    }
    let rec;
    try {
        rec = await dbGet(id);
    } catch (e) {
        console.error(e);
        location.replace('map_list.html');
        return;
    }
    if (!rec) {
        location.replace('map_list.html');
        return;
    }
    App.mapId = rec.id;
    App.mapName = rec.name;
    App.mapCreatedAt = rec.createdAt;
    const nameEl = document.getElementById('map-name-display');
    if (nameEl) nameEl.textContent = rec.name;
    document.title = `${rec.name} | TRPGマップ作成ツール | 違法建築のTRPGラボ`;
    restoreSaveData(rec.data);
    setSaveStatus('saved');
}

/* ----------------------------------------------------------------
   保存 (自動 + 明示)
---------------------------------------------------------------- */

/**
 * 現在の編集状態を IndexedDB に書き込む。
 * @param {boolean} withThumbnail - サムネを再生成するか (重い)
 */
async function persistCurrentMap(withThumbnail) {
    if (!App.mapId) return;
    setSaveStatus('saving');
    try {
        const record = {
            id: App.mapId,
            name: App.mapName,
            gridType: App.gridType,
            createdAt: App.mapCreatedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            data: buildSaveData(),
        };
        // サムネは毎回再生成する (beforeunload の非同期書き込みは多くのブラウザで間に合わず、
        // 一覧側で常に空表示になっていたため)。160x120 程度なら自動保存のコストは無視できる。
        record.thumbnail = generateThumbnail();
        await dbPut(record);
        setSaveStatus('saved');
    } catch (e) {
        console.error(e);
        setSaveStatus('error');
    }
}

/**
 * 編集が発生したら呼ぶ。デバウンスで自動保存を発火する。
 * pushHistory() から自動的に呼ばれるので、個別フックは不要。
 */
function scheduleAutoSave() {
    if (!App.mapId) return;
    if (App._isRestoring) return;
    setSaveStatus('dirty');
    if (App._autoSaveTimer) clearTimeout(App._autoSaveTimer);
    App._autoSaveTimer = setTimeout(() => {
        App._autoSaveTimer = null;
        persistCurrentMap(false);
    }, AUTO_SAVE_DEBOUNCE_MS);
}

/** 自動保存タイマーをキャンセルし、即時保存する (Ctrl+S / 離脱時 等)。 */
async function flushSaveNow(withThumbnail) {
    if (App._autoSaveTimer) {
        clearTimeout(App._autoSaveTimer);
        App._autoSaveTimer = null;
    }
    await persistCurrentMap(withThumbnail);
}

/** ヘッダーの保存ステータス表示を更新する。 */
function setSaveStatus(status) {
    App._saveStatus = status;
    const el = document.getElementById('save-status');
    if (!el) return;
    el.className = 'save-status ' + status;
    el.textContent =
        {
            saved: '保存済み',
            dirty: '編集中…',
            saving: '保存中…',
            error: '保存エラー',
        }[status] || status;
}

document.addEventListener('DOMContentLoaded', () => {
    // 離脱時に確実に保存 (サムネ込み)。非同期だが多くのブラウザで処理される。
    window.addEventListener('beforeunload', () => {
        if (App._autoSaveTimer || App._saveStatus !== 'saved') {
            flushSaveNow(true);
        }
    });
});

/* ================================================================
   Undo / Redo  — A方式 (全状態スナップショット)

   方針:
     - 操作後の状態を JSON 文字列で _history に積む。
     - Undo: 現在状態を _redoStack に退避し、_history から取り出して復元。
     - 新規操作で _redoStack はクリア。
     - 連続編集 (スライダー / スピナー / 不透明度等) は 500ms デバウンスで集約。
     - 復元中は _isRestoring=true で再記録ループを防ぐ。
     - 履歴は揮発: 起動時・読込時に clearHistory()。
     - 上限 50 件、超過分は古い方から捨てる。
================================================================ */
const HISTORY_MAX = 50;
const HISTORY_DEBOUNCE_MS = 500;

/**
 * 履歴に積むためのアプリ状態を JSON 文字列にシリアライズする。
 * @returns {string}
 */
function serializeHistorySnapshot() {
    // toJSON 前に _cellData → _cellEntries を同期 (永続化されるのは _cellEntries 側)
    App.canvas.getObjects().forEach((o) => { if (o._isCellLayer) syncCellEntries(o); });
    return JSON.stringify({
        canvas: App.canvas.toJSON(SAVE_CUSTOM_PROPS),
        nextLayerId: App.nextLayerId,
        layerCounters: { ...App.layerCounters },
    });
}

/**
 * 履歴 (undo) スタックに現状態スナップショットを積み、redo スタックをクリアする。
 * 復元中 (_isRestoring) は何もしない。
 * @param {string} actionName - ステータスバーに表示する操作名
 */
function pushHistory(actionName) {
    if (App._isRestoring) return;
    flushHistoryDebounce(); // 別系統の操作が来たら保留中のデバウンスを確定
    App._history.push({ snapshot: serializeHistorySnapshot(), name: actionName });
    if (App._history.length > HISTORY_MAX) App._history.shift();
    App._redoStack = [];
    App._lastAction = actionName;
    updateHistoryUI();
    scheduleAutoSave();
}

/**
 * 同じ操作名の連続変更を集約して 1 履歴にまとめる。
 * 最終的に確定されるスナップショットは「デバウンス満了時点」の状態。
 * @param {string} actionName
 */
function pushHistoryDebounced(actionName) {
    if (App._isRestoring) return;
    // 操作名が変わったら即フラッシュして新しい系統に切り替え
    if (App._historyDebounceTimer && App._historyDebouncePending !== actionName) {
        flushHistoryDebounce();
    }
    App._historyDebouncePending = actionName;
    if (App._historyDebounceTimer) clearTimeout(App._historyDebounceTimer);
    App._historyDebounceTimer = setTimeout(() => {
        App._historyDebounceTimer = null;
        pushHistory(App._historyDebouncePending);
        App._historyDebouncePending = '';
    }, HISTORY_DEBOUNCE_MS);
}

/** デバウンス中の履歴があれば即座に確定する。 */
function flushHistoryDebounce() {
    if (!App._historyDebounceTimer) return;
    clearTimeout(App._historyDebounceTimer);
    App._historyDebounceTimer = null;
    const name = App._historyDebouncePending;
    App._historyDebouncePending = '';
    pushHistory(name);
}

/**
 * 指定スナップショットでアプリ状態を復元する (Undo/Redo 共通)。
 * loadFromJSON 後にセル/地形レイヤーの _cellData Map を再構築する。
 * 選択状態は Q2(a) によりクリアする。
 * @param {string} snapshot
 * @param {string} displayName - ステータスバー表示用 (「元に戻す: ◯◯」等)
 */
function restoreHistorySnapshot(snapshot, displayName) {
    App._isRestoring = true;
    const data = JSON.parse(snapshot);
    App.nextLayerId = data.nextLayerId;
    App.layerCounters = data.layerCounters || {};
    App.selectedLayerIds = [];
    App._drawing = null;
    App._lineStart = null;
    App._pathPoints = [];
    App._polygonPoints = [];
    App._curvePoints = [];

    App.canvas.loadFromJSON(data.canvas, () => {
        const adapter = ga();
        App.canvas.getObjects().forEach((obj) => {
            if ((obj._isCellLayer || obj._isTerrainLayer) && obj.type === 'group') {
                obj.set({ objectCaching: false, noScaleCache: false });
                rebuildCellDataFromEntries(obj, adapter);
                commitCellLayer(obj);
            }
            if (obj._isRoomGroup && obj.type === 'group') {
                obj.set({ objectCaching: false, noScaleCache: false });
                if (typeof obj.getObjects === 'function') {
                    obj.getObjects().forEach((c) => c.set({ objectCaching: false, noScaleCache: false }));
                }
            }
        });
        App.canvas.discardActiveObject();
        // 現ツールに応じて selectable を再設定
        const isSelect = App.activeTool === 'select' || App.activeTool === 'settings';
        getMapLayers().forEach((o) => o.set({ selectable: isSelect, evented: isSelect }));
        renderLayerList();
        updateSelectionInfo();
        App.canvas.renderAll();
        drawGrid();
        App._isRestoring = false;
        // Undo/Redo で表示状態が変わったので、その新状態を IndexedDB に反映する
        scheduleAutoSave();
    });

    App._lastAction = displayName;
    updateHistoryUI();
}

/**
 * 1 ステップ Undo。
 * 履歴の最新エントリ (= 直近操作の "後" 状態) を redo スタックへ退避し、
 * 「1つ前のエントリの snapshot」(もしくは履歴が空なら _historyInitial) を復元する。
 *
 * 履歴は「操作後の状態」を保持しているため、最新を pop して復元しても無変化となる。
 * 正しくは pop した1つ前の状態を表示することで「直近操作を取り消した状態」になる。
 */
function undo() {
    flushHistoryDebounce();
    if (App._history.length === 0) return;
    const top = App._history.pop();
    App._redoStack.push(top);
    const target = App._history.length > 0 ? App._history[App._history.length - 1] : { snapshot: App._historyInitial, name: '初期状態' };
    if (!target.snapshot) {
        // セーフティ: 初期スナップショット未取得時は何もしない
        App._history.push(top);
        App._redoStack.pop();
        return;
    }
    restoreHistorySnapshot(target.snapshot, `元に戻す: ${top.name}`);
}

/**
 * 1 ステップ Redo。
 * redo スタックから 1 エントリ取り出して history に戻し、その snapshot を復元する。
 */
function redo() {
    flushHistoryDebounce();
    if (App._redoStack.length === 0) return;
    const entry = App._redoStack.pop();
    App._history.push(entry);
    restoreHistorySnapshot(entry.snapshot, `やり直し: ${entry.name}`);
}

/**
 * 履歴・redo スタックを全クリアする。マップ読込時等に呼ぶ。
 * 同時に「現在の状態」を _historyInitial に保存し、最初の Undo の戻り先とする。
 */
function clearHistory() {
    flushHistoryDebounce();
    App._history = [];
    App._redoStack = [];
    App._lastAction = '';
    App._historyInitial = serializeHistorySnapshot();
    updateHistoryUI();
}

/** Undo/Redo ボタンの disabled 状態と、ステータスバーの最後の操作名を更新する。 */
function updateHistoryUI() {
    const u = document.getElementById('undo-btn');
    const r = document.getElementById('redo-btn');
    if (u) u.disabled = App._history.length === 0;
    if (r) r.disabled = App._redoStack.length === 0;
    const sb = document.getElementById('sb-last-action');
    if (sb && !_transientStatusTimer) sb.textContent = App._lastAction;
}

let _transientStatusTimer = null;

/**
 * ステータスバーの「最後の操作」エリアに一時メッセージを表示する。
 * 2.5 秒後に App._lastAction の表示に戻る。塗りつぶしの範囲外通知などに使う。
 * @param {string} msg
 */
function setTransientStatus(msg) {
    const el = document.getElementById('sb-last-action');
    if (!el) return;
    if (_transientStatusTimer) clearTimeout(_transientStatusTimer);
    el.textContent = msg;
    _transientStatusTimer = setTimeout(() => {
        _transientStatusTimer = null;
        el.textContent = App._lastAction;
    }, 2500);
}

/* ================================================================
   キーボードショートカット
================================================================ */
document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
    const key = e.key.toLowerCase(),
        ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
    }
    if (ctrl && key === 'y') {
        e.preventDefault();
        redo();
        return;
    }
    if (ctrl && key === 's') {
        e.preventDefault();
        flushSaveNow(true);
        return;
    }
    if (ctrl && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
        return;
    }

    if (e.key === 'Enter' && activeSubtool() === 'path' && App._pathPoints.length >= 2) {
        removePreview();
        const style = getCurrentDrawStyle();
        addCategoryLayer(
            style.namePrefix + '折線',
            new fabric.Polyline(App._pathPoints, {
                stroke: style.stroke,
                strokeWidth: style.strokeWidth,
                strokeDashArray: style.strokeDashArray,
                fill: '',
                selectable: false,
                evented: false,
                objectCaching: false,
            }),
            style.flag
        );
        App._pathPoints = [];
        e.preventDefault();
        return;
    }
    if (e.key === 'Enter' && App._polygonPoints.length >= 3 && activeSubtool() === 'polygon') {
        removePreview();
        if (App.activeTool === 'room') {
            const pts = App._polygonPoints.slice();
            addRoom('部屋_多角形', (st) => new fabric.Polygon(pts.map((p) => ({ x: p.x, y: p.y })), {
                ...st,
                selectable: false,
                evented: false,
                objectCaching: false,
            }));
        } else {
            const style = getCurrentDrawStyle();
            addCategoryLayer(
                style.namePrefix + '多角形',
                new fabric.Polygon(App._polygonPoints, {
                    stroke: style.stroke,
                    strokeWidth: style.strokeWidth,
                    strokeDashArray: style.strokeDashArray,
                    fill: style.fill,
                    selectable: false,
                    evented: false,
                    objectCaching: false,
                }),
                style.flag
            );
        }
        App._polygonPoints = [];
        e.preventDefault();
        return;
    }
    if (e.key === 'Enter' && App._curvePoints.length >= 2 && activeSubtool() === 'curve') {
        removePreview();
        const d = buildBezierPath(App._curvePoints);
        if (d) {
            const style = getCurrentDrawStyle();
            addCategoryLayer(
                style.namePrefix + '曲線',
                new fabric.Path(d, {
                    stroke: style.stroke,
                    strokeWidth: style.strokeWidth,
                    strokeDashArray: style.strokeDashArray,
                    fill: '',
                    objectCaching: false,
                }),
                style.flag
            );
        }
        App._curvePoints = [];
        e.preventDefault();
        return;
    }
    if (e.key === 'Enter' && App._curvePoints.length >= 3 && activeSubtool() === 'curve-closed') {
        removePreview();
        const d = buildClosedBezierPath(App._curvePoints);
        if (d) {
            if (App.activeTool === 'room') {
                addRoom('部屋_閉曲線', (st) => new fabric.Path(d, { ...st, objectCaching: false }));
            } else {
                const style = getCurrentDrawStyle();
                addCategoryLayer(
                    style.namePrefix + '閉曲線',
                    new fabric.Path(d, {
                        stroke: style.stroke,
                        strokeWidth: style.strokeWidth,
                        strokeDashArray: style.strokeDashArray,
                        fill: style.fill,
                        objectCaching: false,
                    }),
                    style.flag
                );
            }
        }
        App._curvePoints = [];
        e.preventDefault();
        return;
    }
    if (e.key === 'Escape') {
        if (App._exportMode) {
            App._exportMode = false;
            App._exportDrag = null;
            App._exportRect = null;
            App.canvas.defaultCursor = 'default';
            App.canvas.requestRenderAll();
            return;
        }
        removePreview();
        App._pathPoints = [];
        App._polygonPoints = [];
        App._curvePoints = [];
        App._lineStart = null;
        App._drawing = null;
        return;
    }

    if (e.shiftKey && key === 'c') {
        setActiveTool('curve-closed');
        return;
    }
    const shortcuts = { v: 'select', b: 'cell', r: 'rect', e: 'ellipse', l: 'line', p: 'path', g: 'polygon', d: 'freehand', t: 'text', i: 'image', c: 'curve' };
    if (shortcuts[key] && !e.shiftKey) {
        setActiveTool(shortcuts[key]);
        return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && App.activeTool === 'select') {
        const targets = App.canvas.getActiveObjects().filter((o) => o._isMapLayer);
        if (targets.length === 0) return;
        targets.forEach((o) => App.canvas.remove(o));
        App.canvas.discardActiveObject();
        App.selectedLayerIds = [];
        renderLayerList();
        App.canvas.renderAll();
        updateSelectionInfo();
        pushHistory(targets.length === 1 ? `${targets[0]._layerName}を削除` : `${targets.length}個のオブジェクトを削除`);
    }
});

/* ================================================================
   初期化
================================================================ */
document.addEventListener('DOMContentLoaded', () => {
    if (window.IKLab?.initNumSpinners) IKLab.initNumSpinners();
    if (window.IKLab?.initModals) IKLab.initModals();

    initPickr();
    initCanvas();

    // ツールバー (ツールボタン)
    document.querySelectorAll('#toolbar .tb-btn[data-tool]').forEach((btn) => {
        btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
    });

    document.getElementById('tb-export')?.addEventListener('click', () => {
        App._exportMode = true;
        App._exportDrag = null;
        App._exportRect = null;
        App.canvas.defaultCursor = 'crosshair';
        App.canvas.requestRenderAll();
    });
    // gridType の切替UIは廃止 (新規作成時に baked されるため)

    // 壁の厚み (wallThickness) — シンプル線幅とは別系統。選択中オブジェクトに即適用 (壁のみ対象)
    document.getElementById('wall-thickness')?.addEventListener('input', function () {
        App.wallThickness = parseInt(this.value) || 12;
        if (App.activeTool === 'select') {
            const targets = App.canvas.getActiveObjects().filter((o) => o._isWallLayer);
            if (targets.length === 0) return;
            targets.forEach((o) => o.set({ strokeWidth: App.wallThickness }));
            App.canvas.renderAll();
            pushHistoryDebounced('壁の厚みを変更');
        }
    });

    // 線幅 — ダッシュ配列も現在のスタイルに合わせて再計算 + 選択中オブジェクトに即適用
    document.getElementById('stroke-width').addEventListener('input', function () {
        App.strokeWidth = parseInt(this.value) || 0;
        const style = document.querySelector('input[name="stroke-style"]:checked')?.value || 'solid';
        App.strokeDashArray = getDashArray(style, App.strokeWidth);
        if (App.activeTool === 'select') {
            const targets = App.canvas.getActiveObjects().filter((o) => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer);
            if (targets.length === 0) return;
            targets.forEach((o) => o.set({ strokeWidth: App.strokeWidth, strokeDashArray: App.strokeDashArray }));
            App.canvas.renderAll();
            pushHistoryDebounced('線幅を変更');
        }
    });

    // 線種
    document.querySelectorAll('input[name="stroke-style"]').forEach((r) =>
        r.addEventListener('change', () => {
            App.strokeDashArray = getDashArray(r.value, App.strokeWidth);
            if (App.activeTool === 'select') {
                const targets = App.canvas.getActiveObjects().filter((o) => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer);
                if (targets.length === 0) return;
                targets.forEach((o) => o.set({ strokeDashArray: App.strokeDashArray }));
                App.canvas.renderAll();
                pushHistory('線種を変更');
            }
        })
    );

    // 角丸
    document.getElementById('corner-radius').addEventListener('input', function () {
        App.cornerRadius = parseInt(this.value) || 0;
        if (App.activeTool === 'select') {
            const targets = App.canvas.getActiveObjects().filter((o) => o._isMapLayer && o.type === 'rect');
            if (targets.length === 0) return;
            targets.forEach((o) => o.set({ rx: App.cornerRadius, ry: App.cornerRadius }));
            App.canvas.renderAll();
            pushHistoryDebounced('角丸を変更');
        }
    });

    // グリッド設定
    document.getElementById('grid-line-width').addEventListener('input', function () {
        App.gridLineWidth = parseInt(this.value) || 1;
        drawGrid();
    });
    document.querySelectorAll('input[name="grid-style"]').forEach((r) =>
        r.addEventListener('change', () => {
            App.gridDashArray = getDashArray(r.value, App.gridLineWidth);
            drawGrid();
        })
    );

    // レイヤー不透明度・ブレンド
    document.getElementById('layer-opacity').addEventListener('input', function () {
        const val = parseFloat(this.value);
        document.getElementById('layer-opacity-val').textContent = Math.round(val * 100) + '%';
        const targets = App.canvas.getActiveObjects();
        if (targets.length === 0) return;
        targets.forEach((o) => o.set({ opacity: val }));
        App.canvas.renderAll();
        pushHistoryDebounced('不透明度を変更');
    });
    document.getElementById('layer-blend').addEventListener('change', function () {
        const targets = App.canvas.getActiveObjects();
        if (targets.length === 0) return;
        targets.forEach((o) => o.set({ globalCompositeOperation: this.value }));
        App.canvas.renderAll();
        pushHistory('ブレンドモードを変更');
    });

    // フリーハンド: ブラシ種類タイル (add-layer タイルは active 対象外、即アクション)
    document.querySelectorAll('#freehand-brush-tiles .tool-tile[data-freehand-brush]').forEach((tile) => {
        tile.addEventListener('click', () => {
            document.querySelectorAll('#freehand-brush-tiles .tool-tile[data-freehand-brush]').forEach((t) => t.classList.remove('active'));
            tile.classList.add('active');
            setFreehandBrush(tile.dataset.freehandBrush);
        });
    });
    document.querySelector('#freehand-brush-tiles [data-freehand-action="add-layer"]')?.addEventListener('click', () => {
        createFreehandLayer();
    });
    // フリーハンド: 線幅
    document.getElementById('freehand-width')?.addEventListener('input', function () {
        App.freehandWidth = parseInt(this.value) || 3;
        syncFreehandBrushProps();
    });
    // フリーハンド: 平滑化 (decimation)
    document.getElementById('freehand-decimation')?.addEventListener('input', function () {
        App.freehandDecimation = parseInt(this.value) || 0;
        syncFreehandBrushProps();
    });
    // フリーハンド: 筆圧検知
    document.getElementById('freehand-pressure')?.addEventListener('change', function () {
        App.freehandPressure = this.checked;
    });

    // スナップ設定
    document.getElementById('snap-enabled')?.addEventListener('change', function () {
        App.snapEnabled = this.checked;
        document.getElementById('snap-targets').classList.toggle('disabled', !this.checked);
    });
    document.getElementById('snap-intersection')?.addEventListener('change', function () {
        App.snapIntersection = this.checked;
    });
    document.getElementById('snap-center')?.addEventListener('change', function () {
        App.snapCenter = this.checked;
    });
    document.getElementById('snap-midpoint')?.addEventListener('change', function () {
        App.snapMidpoint = this.checked;
    });

    // 画像
    document.getElementById('image-upload-btn')?.addEventListener('click', () => document.getElementById('image-upload').click());
    document.getElementById('image-upload')?.addEventListener('change', handleImageUpload);

    // レイヤー追加（空グループ）
    document.getElementById('layer-add')?.addEventListener('click', () => {
        const group = new fabric.Group([], { selectable: true, evented: true, objectCaching: false });
        addLayerObject('レイヤー', group);
    });

    // グループ化 / 解除 (folder ボタン: 選択がグループならば解除、そうでなければグループ化)
    document.getElementById('layer-group')?.addEventListener('click', () => {
        const active = App.canvas.getActiveObject();
        if (active && active.type === 'group' && !active._isCellLayer && !active._isTerrainLayer) {
            ungroupSelected();
        } else {
            groupSelected();
        }
    });

    // セルレイヤー追加タイル — 現在のモードに応じて simple/ground のレイヤーを作成
    document.querySelector('#cell-tool-tiles [data-cell-action="add-layer"]')?.addEventListener('click', () => {
        if (App.activeTool === 'ground') createGroundCellLayer();
        else createCellLayer();
    });

    // 地面ツールタイル (Phase B-1: 状態保持のみ。描画は B-2)
    document.querySelectorAll('#ground-tool-tiles .tool-tile').forEach((tile) => {
        tile.classList.toggle('active', tile.dataset.groundTool === App.groundTool);
        tile.addEventListener('click', () => {
            App.groundTool = tile.dataset.groundTool;
            document.querySelectorAll('#ground-tool-tiles .tool-tile').forEach((t) => t.classList.toggle('active', t === tile));
        });
    });
    // 壁ツールタイル
    document.querySelectorAll('#wall-tool-tiles .tool-tile').forEach((tile) => {
        tile.classList.toggle('active', tile.dataset.wallTool === App.wallTool);
        tile.addEventListener('click', () => {
            App.wallTool = tile.dataset.wallTool;
            document.querySelectorAll('#wall-tool-tiles .tool-tile').forEach((t) => t.classList.toggle('active', t === tile));
        });
    });
    // 壁の太さ
    // パターン選択 UI 初期描画
    refreshPatternPickers();

    // セル塗りツール (ペン/消しゴム/塗りつぶし) のタイル切替 — レイヤー追加タイルは active 対象外
    document.querySelectorAll('#cell-tool-tiles .tool-tile[data-cell-tool]').forEach((tile) => {
        tile.addEventListener('click', () => {
            document.querySelectorAll('#cell-tool-tiles .tool-tile[data-cell-tool]').forEach((t) => t.classList.remove('active'));
            tile.classList.add('active');
        });
    });

    // 地面ツール (セル/矩形/楕円/多角形/閉曲線) のタイル切替 — 描画途中の状態をリセット
    document.querySelectorAll('#ground-tool-tiles .tool-tile').forEach((tile) => {
        tile.addEventListener('click', () => {
            document.querySelectorAll('#ground-tool-tiles .tool-tile').forEach((t) => t.classList.remove('active'));
            tile.classList.add('active');
            App.groundTool = tile.dataset.groundTool;
            resetDrawingState();
            refreshPropGroupVisibility();
            updateFillStrokeVisibility();
        });
    });
    // 初期 active タイル (App.groundTool に対応)
    document.querySelector(`#ground-tool-tiles .tool-tile[data-ground-tool="${App.groundTool}"]`)?.classList.add('active');

    // 壁ツール (矩形/楕円/直線/折線/多角形/曲線/閉曲線) のタイル切替
    document.querySelectorAll('#wall-tool-tiles .tool-tile').forEach((tile) => {
        tile.addEventListener('click', () => {
            document.querySelectorAll('#wall-tool-tiles .tool-tile').forEach((t) => t.classList.remove('active'));
            tile.classList.add('active');
            App.wallTool = tile.dataset.wallTool;
            resetDrawingState();
            updateFillStrokeVisibility();
        });
    });
    document.querySelector(`#wall-tool-tiles .tool-tile[data-wall-tool="${App.wallTool}"]`)?.classList.add('active');

    // 部屋ツールタイル (矩形/楕円/多角形/閉曲線)
    document.querySelectorAll('#room-tool-tiles .tool-tile').forEach((tile) => {
        tile.addEventListener('click', () => {
            document.querySelectorAll('#room-tool-tiles .tool-tile').forEach((t) => t.classList.remove('active'));
            tile.classList.add('active');
            App.roomTool = tile.dataset.roomTool;
            resetDrawingState();
            updateFillStrokeVisibility();
        });
    });
    document.querySelector(`#room-tool-tiles .tool-tile[data-room-tool="${App.roomTool}"]`)?.classList.add('active');

    // 部屋・壁の厚み
    document.getElementById('room-wall-thickness')?.addEventListener('input', function () {
        App.roomWallThickness = parseInt(this.value) || 12;
        if (App.activeTool === 'select') {
            const targets = [];
            App.canvas.getActiveObjects().forEach((o) => {
                if (o._isRoomGroup && typeof o.getObjects === 'function') {
                    const w = o.getObjects().find((c) => c._isRoomWall);
                    if (w) targets.push(w);
                }
            });
            if (targets.length === 0) return;
            targets.forEach((o) => o.set({ strokeWidth: App.roomWallThickness }));
            App.canvas.renderAll();
            pushHistoryDebounced('部屋・壁の厚みを変更');
        }
    });

    // 部屋・影トグル
    document.getElementById('room-ground-shadow-enabled')?.addEventListener('change', function () {
        App.roomGroundShadowEnabled = this.checked;
        pushHistoryDebounced('部屋・地面影設定を変更');
    });
    document.getElementById('room-wall-shadow-enabled')?.addEventListener('change', function () {
        App.roomWallShadowEnabled = this.checked;
        pushHistoryDebounced('部屋・壁影設定を変更');
    });

    // パターン共通設定 (オフセット/回転) — 値を更新するのみ。新規描画時に snapshot されて適用される
    document.getElementById('pattern-offset-x')?.addEventListener('input', function () {
        App.patternOffsetX = parseInt(this.value) || 0;
    });
    document.getElementById('pattern-offset-y')?.addEventListener('input', function () {
        App.patternOffsetY = parseInt(this.value) || 0;
    });
    document.getElementById('pattern-rotation')?.addEventListener('input', function () {
        App.patternRotation = parseInt(this.value) || 0;
    });
    document.getElementById('pattern-scale')?.addEventListener('input', function () {
        // UI は % 単位 (100 = 等倍)、内部は倍率 (1.0 = 等倍)
        const v = parseFloat(this.value);
        App.patternScale = (isFinite(v) && v > 0) ? v / 100 : 1;
    });

    // テキストスタイル切替 (ボールド/イタリック/下線/取消線) — 編集中で選択範囲があれば部分適用
    document.querySelectorAll('#text-style-tiles .tool-tile').forEach((tile) => {
        tile.addEventListener('click', () => {
            const s = tile.dataset.textStyle;
            const key = textStyleKey(s);
            if (!key) return;
            const current = readTextStyle(key);
            const props = computeToggleProps(s, current);
            if (applyTextStyle(props)) {
                refreshTextStyleButtons();
                pushHistoryDebounced(`テキストスタイル変更`);
            }
        });
    });
    // フォント/サイズ変更も対象テキストに即時適用
    document.getElementById('text-font')?.addEventListener('change', function () {
        if (applyTextStyle({ fontFamily: this.value })) {
            pushHistoryDebounced('フォント変更');
        }
    });
    document.getElementById('text-size')?.addEventListener('input', function () {
        const sz = parseInt(this.value) || 48;
        if (applyTextStyle({ fontSize: sz })) {
            pushHistoryDebounced('文字サイズ変更');
        }
    });
    // キーボードショートカット (Ctrl+B / Ctrl+I / Ctrl+U)
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const target = getTextStyleTarget();
        if (!target) return;
        let s = null;
        if (e.key === 'b' || e.key === 'B') s = 'bold';
        else if (e.key === 'i' || e.key === 'I') s = 'italic';
        else if (e.key === 'u' || e.key === 'U') s = 'underline';
        if (!s) return;
        e.preventDefault();
        const key = textStyleKey(s);
        const props = computeToggleProps(s, readTextStyle(key));
        if (applyTextStyle(props)) {
            refreshTextStyleButtons();
            pushHistoryDebounced('テキストスタイル変更');
        }
    });

    // 影 — 新規描画時に適用 (既存は変えない)。on/off だけ地面/壁で別状態。
    document.getElementById('shadow-enabled')?.addEventListener('change', function () {
        if (App.activeTool === 'ground') App.groundShadowEnabled = this.checked;
        else if (App.activeTool === 'wall') App.wallShadowEnabled = this.checked;
        else App.simpleShadowEnabled = this.checked;
    });
    document.getElementById('shadow-blur')?.addEventListener('input', function () {
        App.shadowBlur = parseInt(this.value) || 0;
    });
    document.getElementById('shadow-offset-x')?.addEventListener('input', function () {
        App.shadowOffsetX = parseInt(this.value) || 0;
    });
    document.getElementById('shadow-offset-y')?.addEventListener('input', function () {
        App.shadowOffsetY = parseInt(this.value) || 0;
    });

    // strokeLineJoin (線の継ぎ目) / strokeLineCap (線の端) — 全描画ストロークに適用
    const applyStrokeMod = (prop, value, label) => {
        App[prop] = value;
        if (App.activeTool === 'select') {
            const targets = App.canvas.getActiveObjects().filter((o) => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer);
            if (targets.length === 0) return;
            targets.forEach((o) => o.set({ [prop]: value }));
            App.canvas.renderAll();
            pushHistoryDebounced(label);
        }
    };
    document.getElementById('stroke-line-join')?.addEventListener('change', function () {
        applyStrokeMod('strokeLineJoin', this.value, '線継ぎ目を変更');
    });
    document.getElementById('stroke-line-cap')?.addEventListener('change', function () {
        applyStrokeMod('strokeLineCap', this.value, '線端を変更');
    });

    // 折りたたみセクション (パターン / 影) — クリックで s-sec.collapsed を切替
    document.querySelectorAll('.s-sec.collapsible > .s-ttl').forEach((ttl) => {
        ttl.addEventListener('click', () => {
            ttl.parentElement.classList.toggle('collapsed');
        });
    });

    // 影トグルの初期状態を activeTool に追随させる
    refreshShadowUI();

    // レイヤー削除
    document.getElementById('layer-delete')?.addEventListener('click', () => {
        const targets = App.canvas.getActiveObjects().filter((o) => o._isMapLayer);
        if (targets.length === 0) return;
        targets.forEach((o) => App.canvas.remove(o));
        App.canvas.discardActiveObject();
        App.selectedLayerIds = [];
        renderLayerList();
        App.canvas.renderAll();
        updateSelectionInfo();
        pushHistory(targets.length === 1 ? `${targets[0]._layerName}を削除` : `${targets.length}個のオブジェクトを削除`);
    });

    // レイヤーリスト空白クリック → 選択解除
    document.getElementById('layer-list').addEventListener('click', (e) => {
        if (!e.target.closest('.layer-item')) {
            App.selectedLayerIds = [];
            App.canvas.discardActiveObject();
            App.canvas.renderAll();
            renderLayerList();
            updateSelectionInfo();
        }
    });

    // 右クリックメニュー
    document.querySelectorAll('#ctx-menu .ctx-item').forEach((item) => {
        item.addEventListener('click', () => handleContextAction(item.dataset.action));
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#ctx-menu')) hideContextMenu();
    });
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('#layer-list') && !e.target.closest('.canvas-container')) hideContextMenu();
    });

    // 初期モード/ツール適用
    document.body.setAttribute('data-edit-mode', App.editMode);
    setActiveTool('select');

    // Undo/Redo ボタン初期状態
    updateHistoryUI();

    // URL の ?id= から対象マップを読み込む (無効ID時は一覧へリダイレクト)
    loadMapFromUrl();
});
