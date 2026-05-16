'use strict';

/* ================================================================
   ヘッダー拡張
================================================================ */
(function injectHeaderExtension() {
    const wait = () => {
        const nav = document.querySelector('.header-nav');
        if (!nav) return requestAnimationFrame(wait);
        const ext = document.createElement('div');
        ext.className = 'header-ext';
        ext.innerHTML = `
            <div class="seg"><input type="radio" name="grid-type" id="gt-square" value="square" checked><label for="gt-square">スクエア</label><input type="radio" name="grid-type" id="gt-hex" value="hex"><label for="gt-hex">ヘクス</label></div>`;
        nav.parentNode.insertBefore(ext, nav);
    };
    wait();
})();

/* ================================================================
   App 状態
================================================================ */
const App = {
    gridType: 'square',
    activeTool: 'select',
    cellSize: 60,
    canvas: null,
    fillColor: '#4a90c4',
    fillOpacity: 1,
    strokeColor: '#000000',
    strokeOpacity: 1,
    strokeWidth: 2,
    strokeDashArray: null,       // null=実線, [10,5]=破線, [2,4]=点線
    cornerRadius: 0,
    gridColor: 'rgba(0,0,0,1)',
    gridLineWidth: 1,
    gridDashArray: null,
    nextLayerId: 10,
    layerCounters: {},           // 種別ごとのレイヤー連番 { '矩形': 2, 'セル': 1, ... }
    selectedLayerIds: [],        // レイヤーパネル上の選択
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
    _exportMode: false,  // 出力範囲選択モード
    _exportRect: null,   // { x, y, w, h } キャンバス座標での出力範囲
    _exportDrag: null,   // 1クリック目の開始点
    _shiftHeld: false,   // Shift押下中はスナップ一時無効
};

/* ================================================================
   地形プリセット
================================================================ */
const TERRAIN_PRESETS = {
    indoor: [
        { id: 'stone_floor', name: '石床',   color: '#8a8a8a', pattern: 'speckle' },
        { id: 'wood_floor',  name: '木床',   color: '#a0724e', pattern: 'stripe'  },
        { id: 'tile_floor',  name: 'タイル', color: '#c4b9a0', pattern: 'grid'    },
        { id: 'brick',       name: 'レンガ', color: '#a85d3e', pattern: 'brick'   },
        { id: 'carpet',      name: 'カーペット', color: '#7b3344', pattern: 'none' },
        { id: 'marble',      name: '大理石', color: '#d4cfc8', pattern: 'speckle' },
    ],
    outdoor: [
        { id: 'grass',       name: '草',      color: '#4a8c3f', pattern: 'speckle' },
        { id: 'dirt',        name: '土',      color: '#8b6e4e', pattern: 'speckle' },
        { id: 'sand',        name: '砂',      color: '#d4c07a', pattern: 'dot'     },
        { id: 'water_s',     name: '水(浅)',  color: '#5ba3cf', pattern: 'wave'    },
        { id: 'water_d',     name: '水(深)',  color: '#2a6496', pattern: 'wave'    },
        { id: 'swamp',       name: '沼',      color: '#5e7a4a', pattern: 'wave'    },
        { id: 'road',        name: '道',      color: '#9e9078', pattern: 'none'    },
        { id: 'snow',        name: '雪',      color: '#e8e8ee', pattern: 'dot'     },
    ],
    cave: [
        { id: 'cave_stone',  name: '石床',    color: '#6b6b6b', pattern: 'speckle' },
        { id: 'gravel',      name: '砂利',    color: '#7a7568', pattern: 'dot'     },
        { id: 'cave_water',  name: '水',      color: '#3a7aaa', pattern: 'wave'    },
        { id: 'lava',        name: '溶岩',    color: '#c43e1a', pattern: 'wave'    },
        { id: 'ice',         name: '氷',      color: '#aad4e6', pattern: 'hatch'   },
        { id: 'moss',        name: '苔',      color: '#4e6e3a', pattern: 'speckle' },
    ],
};

/**
 * 地形プリセットからセル1枚分のテクスチャを生成し、繰り返しタイル可能な fabric.Pattern として返す。
 * @param {string} baseColor - ベース色 (#RRGGBB)
 * @param {'stripe'|'grid'|'brick'|'hatch'|'dot'|'speckle'|'wave'|'none'} patternType
 * @param {number} cellSize - 1セルの一辺 (px)
 * @returns {fabric.Pattern}
 */
function generateTerrainPattern(baseColor, patternType, cellSize) {
    const sz = cellSize;
    const c = document.createElement('canvas');
    c.width = sz; c.height = sz;
    const ctx = c.getContext('2d');
    // ベース色
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, sz, sz);
    // パターン描画
    const pColor = adjustBrightness(baseColor, -30);
    const pColorLight = adjustBrightness(baseColor, 20);
    ctx.strokeStyle = pColor; ctx.fillStyle = pColor;
    switch (patternType) {
        case 'stripe': {
            // フローリング: 4段の横板、横目地のみ
            const rows = 4;
            const bh = sz / rows;
            const line = adjustBrightness(baseColor, -30);
            ctx.strokeStyle = line;
            ctx.lineWidth = Math.max(1, sz / 40);
            for (let r = 1; r < rows; r++) {
                const y = r * bh;
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sz, y); ctx.stroke();
            }
            break;
        }
        case 'grid': {
            ctx.lineWidth = 1;
            ctx.strokeStyle = adjustBrightness(baseColor, -15);
            const step = sz / 2;
            for (let x = step; x < sz; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sz); ctx.stroke(); }
            for (let y = step; y < sz; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sz, y); ctx.stroke(); }
            break;
        }
        case 'brick': {
            // レンガ: 4段、偶数段は半レンガオフセット、色統一
            const rows = 4;
            const bh = sz / rows;
            const brickW = sz / 2;
            const mortar = adjustBrightness(baseColor, -40);
            const mw = Math.max(1, sz / 40);
            ctx.strokeStyle = mortar;
            ctx.lineWidth = mw;
            // 横目地
            for (let r = 0; r <= rows; r++) {
                ctx.beginPath(); ctx.moveTo(0, r * bh); ctx.lineTo(sz, r * bh); ctx.stroke();
            }
            // 縦目地
            for (let r = 0; r < rows; r++) {
                const y = r * bh;
                const off = r % 2 === 0 ? 0 : brickW * 0.5;
                for (let x = off; x <= sz; x += brickW) {
                    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bh); ctx.stroke();
                }
            }
            break;
        }
        case 'hatch': {
            ctx.lineWidth = 1; ctx.globalAlpha = 0.3;
            const step = Math.max(4, sz / 6);
            for (let x = 0; x < sz * 2; x += step) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - sz, sz); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x - sz, 0); ctx.lineTo(x, sz); ctx.stroke();
            }
            ctx.globalAlpha = 1;
            break;
        }
        case 'dot': {
            ctx.globalAlpha = 0.35;
            const step = Math.max(5, sz / 5);
            const r = Math.max(1, sz / 25);
            for (let y = step / 2; y < sz; y += step) {
                for (let x = step / 2; x < sz; x += step) {
                    ctx.beginPath();
                    ctx.arc(x + (Math.sin(x * 7 + y * 3) * step * 0.2), y + (Math.cos(x * 3 + y * 7) * step * 0.2), r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
            break;
        }
        case 'speckle': {
            ctx.globalAlpha = 0.25;
            const count = Math.max(8, Math.floor(sz * sz / 80));
            const r = Math.max(1, sz / 30);
            // deterministic pseudo-random based on baseColor hash
            let seed = 0;
            for (let i = 0; i < baseColor.length; i++) seed = (seed * 31 + baseColor.charCodeAt(i)) | 0;
            const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
            for (let i = 0; i < count; i++) {
                ctx.fillStyle = rng() > 0.5 ? pColor : pColorLight;
                ctx.beginPath();
                ctx.arc(rng() * sz, rng() * sz, r * (0.5 + rng()), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            break;
        }
        case 'wave': {
            ctx.lineWidth = Math.max(1, sz / 25);
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = pColorLight;
            const amp = sz / 10, wl = sz / 2;
            for (let row = 0; row < 3; row++) {
                const yBase = sz * (row + 0.5) / 3;
                ctx.beginPath();
                for (let x = 0; x <= sz; x += 2) {
                    ctx.lineTo(x, yBase + Math.sin((x / wl) * Math.PI * 2 + row) * amp);
                }
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            break;
        }
        // 'none': ベース色のみ
    }
    return new fabric.Pattern({ source: c, repeat: 'repeat' });
}

/**
 * 16進カラーの各チャンネルに amount を加減して明度を調整する。
 * @param {string} hex - #RRGGBB
 * @param {number} amount - -255〜255 (負で暗く、正で明るく)
 * @returns {string} #RRGGBB
 */
function adjustBrightness(hex, amount) {
    let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    r = Math.max(0, Math.min(255, r + amount));
    g = Math.max(0, Math.min(255, g + amount));
    b = Math.max(0, Math.min(255, b + amount));
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
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
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
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
    const cs = App.cellSize;
    const thresh = 18 / App.canvas.getZoom();
    let best = null, bestD = Infinity;
    const tryPt = (sx, sy) => {
        const d = Math.hypot(sx - x, sy - y);
        if (d < thresh && d < bestD) { bestD = d; best = { x: sx, y: sy }; }
    };
    if (App.snapIntersection) {
        tryPt(Math.round(x / cs) * cs, Math.round(y / cs) * cs);
    }
    if (App.snapCenter) {
        tryPt((Math.floor(x / cs) + 0.5) * cs, (Math.floor(y / cs) + 0.5) * cs);
    }
    if (App.snapMidpoint) {
        tryPt((Math.floor(x / cs) + 0.5) * cs, Math.round(y / cs) * cs);
        tryPt(Math.round(x / cs) * cs, (Math.floor(y / cs) + 0.5) * cs);
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
    let best = null, bestD = Infinity;
    for (const p of points) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < thresh && d < bestD) { bestD = d; best = p; }
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
            const p1 = pts[i], p2 = pts[i + 1];
            if (i === pts.length - 2) {
                d += ` Q ${p1.x} ${p1.y}, ${p2.x} ${p2.y}`;
            } else {
                const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
                d += ` Q ${p1.x} ${p1.y}, ${mx} ${my}`;
            }
        }
    }
    return d;
}
/**
 * キャンバス上のオブジェクトのうち「ユーザー編集対象のレイヤー」だけを z 順 (低→高) で返す。
 * プレビューやスナップマーカーなどの一時オブジェクトは除外される。
 * @returns {fabric.Object[]}
 */
function getMapLayers() {
    return App.canvas.getObjects().filter(o => o._isMapLayer);
}

/**
 * 現在のツール / 選択状況に応じて、フィル&ストロークセクション・角丸行・スナップ設定セクションの
 * 表示/非表示を更新する。プロパティパネルの状態を一元管理する司令塔。
 */
function updateFillStrokeVisibility() {
    const drawTools = ['cell','rect','ellipse','line','path','polygon','freehand','text','wall','room','curve'];
    let show = drawTools.includes(App.activeTool);
    if (App.activeTool === 'select') {
        show = App.canvas.getActiveObjects().some(o => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer);
    }
    document.getElementById('fill-stroke-sec').style.display = show ? '' : 'none';
    // 角丸は矩形ツール or 選択中の矩形にのみ表示
    let showRadius = App.activeTool === 'rect';
    if (App.activeTool === 'select') {
        showRadius = App.canvas.getActiveObjects().some(o => o._isMapLayer && o.type === 'rect');
    }
    document.getElementById('corner-radius-row').style.display = showRadius ? '' : 'none';
    // スナップ設定: 描画系ツールで表示
    const snapTools = ['rect','ellipse','line','path','polygon','curve','wall','room','door','object','label'];
    document.getElementById('snap-sec').style.display = snapTools.includes(App.activeTool) ? '' : 'none';
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
    const opts = (el, def) => ({
        el, theme: 'nano', default: def,
        components: { preview: true, opacity: true, hue: true, interaction: { hex: true, rgba: true, input: true, save: true } },
    });
    fillPickr = Pickr.create(opts('#fill-color-picker', App.fillColor));
    fillPickr.on('save', (c) => {
        if (c) { App.fillColor = c.toHEXA().toString().slice(0,7); App.fillOpacity = c.toRGBA()[3]; }
        fillPickr.hide();
        if (App.activeTool === 'select') {
            App.canvas.getActiveObjects().filter(o => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer)
                .forEach(o => o.set({ fill: rgba(App.fillColor, App.fillOpacity) }));
            App.canvas.renderAll();
        }
    });
    strokePickr = Pickr.create(opts('#stroke-color-picker', App.strokeColor));
    strokePickr.on('save', (c) => {
        if (c) { App.strokeColor = c.toHEXA().toString().slice(0,7); App.strokeOpacity = c.toRGBA()[3]; }
        strokePickr.hide();
        if (App.activeTool === 'select') {
            App.canvas.getActiveObjects().filter(o => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer)
                .forEach(o => o.set({ stroke: rgba(App.strokeColor, App.strokeOpacity) }));
            App.canvas.renderAll();
        }
    });
    gridPickr = Pickr.create(opts('#grid-color-picker', 'rgba(0,0,0,1)'));
    gridPickr.on('save', (c) => {
        if (c) App.gridColor = c.toRGBA().toString();
        gridPickr.hide();
        drawGrid();
    });
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
    c.width = area.clientWidth; c.height = area.clientHeight;

    App.canvas = new fabric.Canvas('main-canvas', {
        selection: true, preserveObjectStacking: true,
        stopContextMenu: true, fireRightClick: true,
    });
    App.canvas.setWidth(area.clientWidth);
    App.canvas.setHeight(area.clientHeight);

    const vpt = App.canvas.viewportTransform;
    vpt[4] = Math.round(area.clientWidth / 2); vpt[5] = Math.round(area.clientHeight / 2);
    App.canvas.setViewportTransform(vpt);

    // ズーム
    App.canvas.on('mouse:wheel', function(opt) {
        let zoom = App.canvas.getZoom() * (0.999 ** opt.e.deltaY);
        zoom = Math.min(20, Math.max(0.05, zoom));
        App.canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        opt.e.preventDefault(); opt.e.stopPropagation();
        drawGrid(); updateStatusBar();
    });

    // パン
    let isPanning = false, panX = 0, panY = 0, spaceHeld = false;
    document.addEventListener('keydown', e => {
        if (e.code === 'Space' && !e.repeat) { spaceHeld = true; e.preventDefault(); }
        if (e.key === 'Shift') App._shiftHeld = true;
    });
    document.addEventListener('keyup', e => {
        if (e.code === 'Space') spaceHeld = false;
        if (e.key === 'Shift') App._shiftHeld = false;
    });

    App.canvas.on('mouse:down', function(opt) {
        const e = opt.e, ptr = App.canvas.getPointer(e);

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

        // パン
        if (e.altKey || spaceHeld) {
            isPanning = true; panX = e.clientX; panY = e.clientY;
            App.canvas.selection = false; App.canvas.defaultCursor = 'grab';
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
                    x: Math.min(d.startX, pt.x), y: Math.min(d.startY, pt.y),
                    w: Math.abs(pt.x - d.startX), h: Math.abs(pt.y - d.startY),
                };
                App._exportDrag = null;
                App._exportMode = false;
                App.canvas.defaultCursor = 'default';
                if (App._exportRect.w < 5 || App._exportRect.h < 5) { App._exportRect = null; }
                App.canvas.requestRenderAll();
                if (App._exportRect) openExportModal();
            }
            return;
        }

        // ツール別
        switch (App.activeTool) {
            case 'rect': case 'ellipse': {
                const pt = snapToGrid(ptr.x, ptr.y) || ptr;
                if (!App._drawing) {
                    // 1クリック目: 開始点を記録
                    App._drawing = { startX: pt.x, startY: pt.y, obj: null };
                } else {
                    // 2クリック目: 確定
                    const d = App._drawing;
                    const w = Math.abs(pt.x - d.startX), h = Math.abs(pt.y - d.startY);
                    if (w > 2 && h > 2) {
                        removePreview();
                        const left = Math.min(d.startX, pt.x), top = Math.min(d.startY, pt.y);
                        const hsw = App.strokeWidth / 2;
                        const obj = App.activeTool === 'rect'
                            ? new fabric.Rect({ left: left - hsw, top: top - hsw, width: w, height: h, rx: App.cornerRadius, ry: App.cornerRadius, fill: rgba(App.fillColor, App.fillOpacity), stroke: rgba(App.strokeColor, App.strokeOpacity), strokeWidth: App.strokeWidth, strokeDashArray: App.strokeDashArray, objectCaching: false })
                            : new fabric.Ellipse({ left: left - hsw, top: top - hsw, rx: w/2, ry: h/2, fill: rgba(App.fillColor, App.fillOpacity), stroke: rgba(App.strokeColor, App.strokeOpacity), strokeWidth: App.strokeWidth, strokeDashArray: App.strokeDashArray, objectCaching: false });
                        addLayerObject(App.activeTool === 'rect' ? '矩形' : '楕円', obj);
                    }
                    App._drawing = null;
                }
                break;
            }
            case 'line': {
                const pt = snapToGrid(ptr.x, ptr.y) || ptr;
                if (!App._lineStart) { App._lineStart = pt; }
                else {
                    const hsw = App.strokeWidth / 2;
                    const line = new fabric.Line([
                        App._lineStart.x - hsw, App._lineStart.y - hsw,
                        pt.x - hsw, pt.y - hsw
                    ], {
                        stroke: rgba(App.strokeColor, App.strokeOpacity), strokeWidth: App.strokeWidth,
                        strokeDashArray: App.strokeDashArray, fill: null,
                        selectable: false, evented: false, objectCaching: false,
                    });
                    addLayerObject('直線', line);
                    removePreview(); App._lineStart = null;
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
            case 'curve': {
                const raw = snapToGrid(ptr.x, ptr.y) || ptr;
                const pt = snapToEditPoints(ptr.x, ptr.y, App._curvePoints) || raw;
                App._curvePoints.push({ x: pt.x, y: pt.y });
                break;
            }
            case 'cell': {
                const col = Math.floor(ptr.x / App.cellSize), row = Math.floor(ptr.y / App.cellSize);
                const tool = document.querySelector('input[name="cell-tool"]:checked')?.value || 'pen';
                handleCellPaint(col, row, tool);
                App._drawing = { cellTool: tool };
                break;
            }
            case 'text': {
                if (opt.target && opt.target._isMapText) { opt.target.enterEditing(); App.canvas.renderAll(); return; }
                const font = document.getElementById('text-font')?.value || 'Noto Sans JP';
                const size = parseInt(document.getElementById('text-size')?.value) || 20;
                const tb = new fabric.Textbox('テキスト', {
                    left: ptr.x, top: ptr.y, fontFamily: font, fontSize: size,
                    fill: rgba(App.fillColor, App.fillOpacity),
                    stroke: App.strokeWidth > 0 ? rgba(App.strokeColor, App.strokeOpacity) : null,
                    strokeWidth: App.strokeWidth > 0 ? App.strokeWidth : 0,
                    editable: true, objectCaching: false, _isMapText: true,
                });
                addLayerObject('テキスト', tb);
                tb.enterEditing(); tb.selectAll(); App.canvas.renderAll();
                break;
            }
        }
    });

    App.canvas.on('mouse:move', function(opt) {
        const ptr = App.canvas.getPointer(opt.e);
        document.getElementById('sb-coord').textContent =
            `${Math.floor(ptr.x / App.cellSize)}, ${Math.floor(ptr.y / App.cellSize)}`;

        if (isPanning) {
            App._snapPt = null;
            const v = App.canvas.viewportTransform;
            v[4] = Math.round(v[4] + opt.e.clientX - panX);
            v[5] = Math.round(v[5] + opt.e.clientY - panY);
            panX = opt.e.clientX; panY = opt.e.clientY;
            App.canvas.requestRenderAll(); drawGrid(); return;
        }

        // スナップ先を計算（水色マーカー用 — スナップ対応ツールのみ）
        {
            const _snapTools = ['rect','ellipse','line','path','polygon','curve','wall','room','door','object','label'];
            const _needSnap = _snapTools.includes(App.activeTool) || App._exportMode;
            if (_needSnap) {
                const _editPts = App.activeTool === 'path' ? App._pathPoints
                    : App.activeTool === 'polygon' ? App._polygonPoints
                    : App.activeTool === 'curve' ? App._curvePoints : [];
                const _raw = snapToGrid(ptr.x, ptr.y);
                App._snapPt = snapToEditPoints(ptr.x, ptr.y, _editPts) || _raw || null;
            } else {
                App._snapPt = null;
            }
            App.canvas.requestRenderAll();
        }

        // 矩形/楕円プレビュー（1クリック後、マウス追従）
        if (App._drawing && (App.activeTool === 'rect' || App.activeTool === 'ellipse')) {
            const pt = snapToGrid(ptr.x, ptr.y) || ptr;
            const d = App._drawing;
            const left = Math.min(d.startX, pt.x), top = Math.min(d.startY, pt.y);
            const w = Math.abs(pt.x - d.startX), h = Math.abs(pt.y - d.startY);
            removePreview();
            if (w > 0 || h > 0) {
                const hsw = App.strokeWidth / 2;
                const preview = App.activeTool === 'rect'
                    ? new fabric.Rect({ left: left - hsw, top: top - hsw, width: w, height: h, rx: App.cornerRadius, ry: App.cornerRadius, fill: rgba(App.fillColor, App.fillOpacity * 0.5), stroke: rgba(App.strokeColor, App.strokeOpacity * 0.5), strokeWidth: App.strokeWidth, strokeDashArray: App.strokeDashArray, selectable: false, evented: false, objectCaching: false, isPreview: true })
                    : new fabric.Ellipse({ left: left - hsw, top: top - hsw, rx: w/2, ry: h/2, fill: rgba(App.fillColor, App.fillOpacity * 0.5), stroke: rgba(App.strokeColor, App.strokeOpacity * 0.5), strokeWidth: App.strokeWidth, strokeDashArray: App.strokeDashArray, selectable: false, evented: false, objectCaching: false, isPreview: true });
                App.canvas.add(preview);
            }
            App.canvas.renderAll();
        }

        // 直線プレビュー
        if (App.activeTool === 'line' && App._lineStart) {
            const pt = snapToGrid(ptr.x, ptr.y) || ptr;
            const hsw = App.strokeWidth / 2;
            removePreview();
            App.canvas.add(new fabric.Line([
                App._lineStart.x - hsw, App._lineStart.y - hsw,
                pt.x - hsw, pt.y - hsw
            ], {
                stroke: rgba(App.strokeColor, App.strokeOpacity * 0.5), strokeWidth: App.strokeWidth,
                selectable: false, evented: false, isPreview: true, objectCaching: false,
            }));
            App.canvas.renderAll();
        }

        // 折線プレビュー
        if (App.activeTool === 'path' && App._pathPoints.length > 0) {
            const raw = snapToGrid(ptr.x, ptr.y) || ptr;
            const pt = snapToEditPoints(ptr.x, ptr.y, App._pathPoints) || raw;
            removePreview();
            App.canvas.add(new fabric.Polyline([...App._pathPoints, pt], {
                stroke: rgba(App.strokeColor, App.strokeOpacity * 0.5), strokeWidth: App.strokeWidth,
                fill: rgba(App.fillColor, App.fillOpacity * 0.3),
                selectable: false, evented: false, isPreview: true, objectCaching: false,
            }));
            App.canvas.renderAll();
        }

        // 多角形プレビュー
        if (App.activeTool === 'polygon' && App._polygonPoints.length > 0) {
            const raw = snapToGrid(ptr.x, ptr.y) || ptr;
            const pt = snapToEditPoints(ptr.x, ptr.y, App._polygonPoints) || raw;
            removePreview();
            App.canvas.add(new fabric.Polygon([...App._polygonPoints, pt], {
                stroke: rgba(App.strokeColor, App.strokeOpacity * 0.5), strokeWidth: App.strokeWidth,
                fill: rgba(App.fillColor, App.fillOpacity * 0.3),
                selectable: false, evented: false, isPreview: true, objectCaching: false,
            }));
            App.canvas.renderAll();
        }

        // 曲線プレビュー
        if (App.activeTool === 'curve' && App._curvePoints.length > 0) {
            const raw = snapToGrid(ptr.x, ptr.y) || ptr;
            const pt = snapToEditPoints(ptr.x, ptr.y, App._curvePoints) || raw;
            removePreview();
            const previewPts = [...App._curvePoints, pt];
            const d = buildBezierPath(previewPts);
            if (d) {
                App.canvas.add(new fabric.Path(d, {
                    stroke: rgba(App.strokeColor, App.strokeOpacity * 0.5), strokeWidth: App.strokeWidth,
                    fill: '', selectable: false, evented: false, isPreview: true, objectCaching: false,
                }));
            }
            App.canvas.renderAll();
        }

        // 出力範囲プレビュー（exportモード、1クリック後のマウス追従）
        if (App._exportMode && App._exportDrag) {
            const ep = snapToGrid(ptr.x, ptr.y) || ptr;
            const d = App._exportDrag;
            App._exportRect = {
                x: Math.min(d.startX, ep.x), y: Math.min(d.startY, ep.y),
                w: Math.abs(ep.x - d.startX), h: Math.abs(ep.y - d.startY),
            };
            App.canvas.requestRenderAll();
        }

        // セル塗り（ドラッグ）
        if (App._drawing && App.activeTool === 'cell') {
            handleCellPaint(Math.floor(ptr.x / App.cellSize), Math.floor(ptr.y / App.cellSize), App._drawing.cellTool);
        }
    });

    App.canvas.on('mouse:up', function() {
        if (isPanning) { isPanning = false; App.canvas.selection = (App.activeTool === 'select'); App.canvas.defaultCursor = 'default'; return; }
        if (App._drawing && App.activeTool === 'cell') App._drawing = null;
    });

    App.canvas.on('text:editing:exited', function(opt) {
        if (opt.target?._isMapText && opt.target.text.trim() === '') { App.canvas.remove(opt.target); App.canvas.discardActiveObject(); }
        renderLayerList(); App.canvas.renderAll();
    });

    App.canvas.on('selection:created', () => { syncLayerSelectionFromCanvas(); updateSelectionInfo(); });
    App.canvas.on('selection:updated', () => { syncLayerSelectionFromCanvas(); updateSelectionInfo(); });
    App.canvas.on('selection:cleared', () => { App.selectedLayerIds = []; renderLayerList(); updateSelectionInfo(); });
    App.canvas.on('object:modified', updateSelectionInfo);
    App.canvas.on('object:moving', function(opt) {
        if (!App.snapEnabled) return;
        const obj = opt.target;
        const snapped = snapToGrid(obj.left, obj.top);
        if (snapped) obj.set({ left: snapped.x, top: snapped.y });
    });
    App.canvas.on('path:created', opt => { if (opt.path) { opt.path.set({ selectable: false, evented: false }); addLayerObject('フリーハンド', opt.path); } });

    window.addEventListener('resize', () => { App.canvas.setWidth(area.clientWidth); App.canvas.setHeight(area.clientHeight); drawGrid(); });
    App.canvas.on('mouse:out', () => { App._snapPt = null; App.canvas.requestRenderAll(); });

    _initGridRenderer();
    updateStatusBar();
}

/** 描画途中のプレビュー用オブジェクト (isPreview フラグ付き) を全て除去する。 */
function removePreview() { App.canvas.getObjects().filter(o => o.isPreview).forEach(o => App.canvas.remove(o)); }

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
    App.canvas.on('after:render', function() {
        const vpt = App.canvas.viewportTransform;
        const zoom = App.canvas.getZoom();

        // チェッカーボード背景をビューポートに追従させる
        const S = 12 * zoom;
        const ox = ((vpt[4] % S) + S) % S;
        const oy = ((vpt[5] % S) + S) % S;
        area.style.backgroundSize = `${S}px ${S}px`;
        area.style.backgroundPosition = `${ox}px ${oy}px`;
        const cw = App.canvas.getWidth(), ch = App.canvas.getHeight(), cs = App.cellSize;
        const wl = -vpt[4]/zoom, wt = -vpt[5]/zoom, wr = wl+cw/zoom, wb = wt+ch/zoom;
        const sc = Math.floor(wl/cs)-1, ec = Math.ceil(wr/cs)+1;
        const sr = Math.floor(wt/cs)-1, er = Math.ceil(wb/cs)+1;

        const ctx = App.canvas.getContext();
        ctx.save();
        ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
        ctx.strokeStyle = App.gridColor;
        ctx.lineWidth = App.gridLineWidth;
        ctx.setLineDash(App.gridDashArray || []);
        ctx.beginPath();
        for (let c = sc; c <= ec; c++) { ctx.moveTo(c*cs, sr*cs); ctx.lineTo(c*cs, er*cs); }
        for (let r = sr; r <= er; r++) { ctx.moveTo(sc*cs, r*cs); ctx.lineTo(ec*cs, r*cs); }
        ctx.stroke();
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
                ctx.rect(wl - cs, wt - cs, (wr - wl) + cs * 2, r.y - wt + cs);
                ctx.rect(wl - cs, r.y, r.x - wl + cs, r.h);
                ctx.rect(r.x + r.w, r.y, wr - r.x - r.w + cs, r.h);
                ctx.rect(wl - cs, r.y + r.h, (wr - wl) + cs * 2, wb - r.y - r.h + cs);
                ctx.fill();
                // 選択範囲の枠
                ctx.strokeStyle = '#00e5ff';
                ctx.lineWidth = 2 / zoom;
                ctx.setLineDash([]);
                ctx.strokeRect(r.x, r.y, r.w, r.h);
            } else {
                // まだ範囲未指定: 全体を暗く
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillRect(wl - cs, wt - cs, (wr - wl) + cs * 2, (wb - wt) + cs * 2);
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
        _layerId: id, _isMapLayer: true,
        _layerName: `${typeName}${App.layerCounters[typeName]}`,
        borderColor: '#40b7fc', cornerColor: 'white', cornerStrokeColor: '#40b7fc',
        cornerSize: 10, transparentCorners: false, borderScaleFactor: 2,
        selectable: App.activeTool === 'select',  // ← 追加
        evented: App.activeTool === 'select',
    });
    // フリーハンド等、既にcanvas上にある場合はadd不要
    if (!App.canvas.getObjects().includes(obj)) App.canvas.add(obj);
    // 新規レイヤーをパネル上でハイライト（canvasのactive化はしない — 現ツールの操作性を維持）
    App.selectedLayerIds = [id];
    renderLayerList();
    App.canvas.renderAll();
}

/**
 * canvas のアクティブ選択 → App.selectedLayerIds への片方向同期。
 * selection:created / selection:updated イベントから呼ばれる。
 */
function syncLayerSelectionFromCanvas() {
    App.selectedLayerIds = App.canvas.getActiveObjects().filter(o => o._isMapLayer).map(o => o._layerId);
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

    layers.forEach(obj => {
        const item = document.createElement('div');
        item.className = 'layer-item' + (App.selectedLayerIds.includes(obj._layerId) ? ' selected' : '');
        item.dataset.id = obj._layerId;
        item.draggable = true;

        // 可視アイコン
        const vis = document.createElement('span');
        vis.className = 'material-icons';
        vis.textContent = obj.visible ? 'visibility' : 'visibility_off';
        vis.addEventListener('click', e => { e.stopPropagation(); obj.set({ visible: !obj.visible }); App.canvas.renderAll(); renderLayerList(); });

        // 名前
        const name = document.createElement('span');
        name.className = 'layer-name';
        name.textContent = obj._layerName || 'レイヤー';

        item.appendChild(vis);
        item.appendChild(name);

        // クリック（Ctrl/Shift対応 + ツール切替）
        item.addEventListener('click', e => {
            const id = obj._layerId;
            if (e.ctrlKey || e.metaKey) {
                if (App.selectedLayerIds.includes(id)) App.selectedLayerIds = App.selectedLayerIds.filter(i => i !== id);
                else App.selectedLayerIds.push(id);
            } else if (e.shiftKey && App.lastClickedLayerId != null) {
                const allIds = layers.map(l => l._layerId);
                const a = allIds.indexOf(App.lastClickedLayerId), b = allIds.indexOf(id);
                const range = allIds.slice(Math.min(a,b), Math.max(a,b)+1);
                App.selectedLayerIds = [...new Set([...App.selectedLayerIds, ...range])];
            } else {
                App.selectedLayerIds = [id];
            }
            App.lastClickedLayerId = id;
            // セル/地形ツール中の同種レイヤー選択 → ペイント対象切替のみ
            const isPaintException = (App.activeTool === 'cell' && obj._isCellLayer);
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
        item.addEventListener('dblclick', e => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'text'; input.className = 'layer-name-input';
            input.value = obj._layerName || '';
            name.replaceWith(input);
            input.focus(); input.select();
            const commit = () => { obj._layerName = input.value || obj._layerName; renderLayerList(); };
            input.addEventListener('blur', commit);
            input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') { input.value = obj._layerName; input.blur(); } });
        });

        // 右クリック
        item.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (!App.selectedLayerIds.includes(obj._layerId)) {
                App.selectedLayerIds = [obj._layerId];
                applyLayerSelectionToCanvas(); renderLayerList();
            }
            showContextMenu(e.clientX, e.clientY, obj);
        });

        // ドラッグ＆ドロップ
        item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(obj._layerId)); item.style.opacity = '0.4'; });
        item.addEventListener('dragend', () => { item.style.opacity = '1'; document.querySelectorAll('.layer-item').forEach(i => i.classList.remove('drag-over-top','drag-over-bottom')); });
        item.addEventListener('dragover', e => {
            e.preventDefault();
            const rect = item.getBoundingClientRect();
            item.classList.toggle('drag-over-top', e.clientY < rect.top + rect.height/2);
            item.classList.toggle('drag-over-bottom', e.clientY >= rect.top + rect.height/2);
        });
        item.addEventListener('dragleave', () => { item.classList.remove('drag-over-top','drag-over-bottom'); });
        item.addEventListener('drop', e => {
            e.preventDefault();
            document.querySelectorAll('.layer-item').forEach(i => i.classList.remove('drag-over-top','drag-over-bottom'));
            const draggedId = parseInt(e.dataTransfer.getData('text/plain'));
            if (draggedId === obj._layerId) return;

            const rect = item.getBoundingClientRect();
            const above = e.clientY < rect.top + rect.height / 2;

            // 複数選択時は全選択レイヤーを一括移動
            const draggedIds = App.selectedLayerIds.includes(draggedId)
                ? [...App.selectedLayerIds] : [draggedId];
            if (draggedIds.includes(obj._layerId)) return;

            // 現在のマップレイヤー順を取得（canvas z順: 低→高）
            const mapLayers = getMapLayers();
            const draggedObjs = mapLayers.filter(o => draggedIds.includes(o._layerId));
            const remaining = mapLayers.filter(o => !draggedIds.includes(o._layerId));

            // ドロップ先のインデックス（remaining配列内）
            const targetIdx = remaining.findIndex(o => o._layerId === obj._layerId);
            // UI上で「上」= canvas z-indexが高い = remaining配列の後方
            const insertIdx = above ? targetIdx + 1 : targetIdx;
            remaining.splice(insertIdx, 0, ...draggedObjs);

            // canvas上のマップレイヤーを再配置
            mapLayers.forEach(o => App.canvas.remove(o));
            remaining.forEach(o => App.canvas.add(o));

            renderLayerList(); App.canvas.renderAll();
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
    const objs = App.canvas.getObjects().filter(o => idsToSelect.includes(o._layerId));
    if (objs.length === 1) {
        objs[0].set({ selectable: true, evented: true });
        App.canvas.setActiveObject(objs[0]);
    } else if (objs.length > 1) {
        objs.forEach(o => o.set({ selectable: true, evented: true }));
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
    const active = App.canvas.getActiveObjects().filter(o => o._isMapLayer);
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
            <div class="f"><span class="fl">幅</span><span class="unit">${Math.round(o.width * (o.scaleX||1))}</span></div>
            <div class="f"><span class="fl">高さ</span><span class="unit">${Math.round(o.height * (o.scaleY||1))}</span></div>
            <div class="f"><span class="fl">回転</span><span class="unit">${Math.round(o.angle||0)}°</span></div>`;
        // X/Y 編集
        info.querySelector('#si-x')?.addEventListener('change', function() { o.set({ left: parseInt(this.value) }); o.setCoords(); App.canvas.renderAll(); });
        info.querySelector('#si-y')?.addEventListener('change', function() { o.set({ top: parseInt(this.value) }); o.setCoords(); App.canvas.renderAll(); });
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
    const selected = App.canvas.getObjects().find(o => o._isCellLayer && App.selectedLayerIds.includes(o._layerId));
    if (selected) return selected;
    // 最上位のセルレイヤー
    const existing = getMapLayers().reverse().find(o => o._isCellLayer);
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
        selectable: false, evented: false, objectCaching: false,
        _isCellLayer: true, _cellData: new Map(),
    });
    addLayerObject('セル', group);
    // 作成直後に選択状態にする
    App.selectedLayerIds = [group._layerId];
    renderLayerList();
    return group;
}

/**
 * セルレイヤー上の1セルをペン塗り / 消しゴム消去する。ドラッグ中も毎フレーム呼ばれる。
 * @param {number} col - セル列 (0始まり, 負値可)
 * @param {number} row - セル行
 * @param {'pen'|'eraser'} tool
 */
function handleCellPaint(col, row, tool) {
    const layer = getOrCreateCellLayer();
    // 使用するセルレイヤーを選択状態にする（描き始め時の自動選択）
    if (!App.selectedLayerIds.includes(layer._layerId)) {
        App.selectedLayerIds = [layer._layerId];
        renderLayerList();
    }
    const key = `${col},${row}`;
    const cs = App.cellSize;

    if (tool === 'pen') {
        // 既存セルを探す
        const existing = layer._cellData?.get(key);
        if (existing) {
            existing.set({ fill: rgba(App.fillColor, App.fillOpacity) });
        } else {
            const rect = new fabric.Rect({
                left: col * cs,
                top: row * cs,
                width: cs, height: cs,
                fill: rgba(App.fillColor, App.fillOpacity),
                stroke: null, strokeWidth: 0,
                selectable: false, evented: false, objectCaching: false,
                _cellCol: col, _cellRow: row,
            });
            layer.addWithUpdate(rect);
            if (!layer._cellData) layer._cellData = new Map();
            layer._cellData.set(key, rect);
        }
    } else if (tool === 'eraser') {
        const existing = layer._cellData?.get(key);
        if (existing) { layer.removeWithUpdate(existing); layer._cellData.delete(key); }
    }
    App.canvas.renderAll();
}

/* ================================================================
   地形パターン（データのみ保持 — 描画UIは別途実装）
================================================================ */
let _terrainPatternCache = new Map(); // key: `${id}_${cellSize}` → fabric.Pattern

/**
 * 地形プリセットから fill 値を返す。pattern='none' は色文字列、それ以外は
 * `(id, cellSize)` キーでキャッシュした fabric.Pattern を返す。
 * @param {{id:string,color:string,pattern:string}} preset
 * @returns {string|fabric.Pattern}
 */
function getTerrainFill(preset) {
    if (preset.pattern === 'none') return preset.color;
    const key = `${preset.id}_${App.cellSize}`;
    if (!_terrainPatternCache.has(key)) {
        _terrainPatternCache.set(key, generateTerrainPattern(preset.color, preset.pattern, App.cellSize));
    }
    return _terrainPatternCache.get(key);
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
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
    menu.classList.add('open');
    // ロック表示更新
    const lockItem = menu.querySelector('[data-action="lock"]');
    if (lockItem) {
        const icon = lockItem.querySelector('.material-icons');
        icon.textContent = target.lockMovementX ? 'lock_open' : 'lock';
        lockItem.childNodes[1].textContent = target.lockMovementX ? 'ロック解除' : 'ロック';
    }
}
/** 右クリックメニューを閉じ、ctxTarget をクリアする。 */
function hideContextMenu() { document.getElementById('ctx-menu').classList.remove('open'); ctxTarget = null; }

/**
 * 右クリックメニューの各項目に対応する操作を実行する。
 * @param {'rename'|'duplicate'|'bring-front'|'send-back'|'lock'|'delete'} action
 */
function handleContextAction(action) {
    if (!ctxTarget) return;
    switch (action) {
        case 'rename': {
            const items = document.querySelectorAll('.layer-item');
            const item = [...items].find(i => parseInt(i.dataset.id) === ctxTarget._layerId);
            if (item) item.dispatchEvent(new MouseEvent('dblclick'));
            break;
        }
        case 'duplicate': {
            ctxTarget.clone(function(cloned) {
                cloned.set({ left: cloned.left + 20, top: cloned.top + 20 });
                addLayerObject(ctxTarget._layerName + ' コピー', cloned);
            });
            break;
        }
        case 'bring-front': {
            App.canvas.bringToFront(ctxTarget);
            renderLayerList(); App.canvas.renderAll();
            break;
        }
        case 'send-back': {
            App.canvas.sendToBack(ctxTarget);
            renderLayerList(); App.canvas.renderAll();
            break;
        }
        case 'lock': {
            const locked = !ctxTarget.lockMovementX;
            ctxTarget.set({ lockMovementX: locked, lockMovementY: locked, lockRotation: locked, lockScalingX: locked, lockScalingY: locked, hasControls: !locked });
            App.canvas.renderAll();
            break;
        }
        case 'delete': {
            App.canvas.remove(ctxTarget);
            App.canvas.discardActiveObject();
            App.selectedLayerIds = App.selectedLayerIds.filter(id => id !== ctxTarget._layerId);
            renderLayerList(); App.canvas.renderAll();
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
function setGridType(type) { App.gridType = type; drawGrid(); }

/**
 * アクティブツールを切替える。描画途中の状態 (_drawing, _pathPoints 等) を全てリセットし、
 * ツールバー / プロパティパネル / canvas の selectable・evented・isDrawingMode を更新する。
 * セルツール選択時は最上位セルレイヤーを自動選択、フリーハンド時はブラシ設定を反映。
 * @param {string} toolName
 */
function setActiveTool(toolName) {
    removePreview(); App._drawing = null; App._lineStart = null; App._pathPoints = []; App._polygonPoints = []; App._curvePoints = [];
    App._exportMode = false; App._exportDrag = null; App._exportRect = null;
    App.canvas.isDrawingMode = false;
    App.activeTool = toolName;

    // ツールバーボタンのアクティブ状態
    document.querySelectorAll('#toolbar .tb-btn[data-tool]').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.tool === toolName));

    // プロパティパネル: data-prop グループを切替
    document.querySelectorAll('#prop-panel .prop-group').forEach(pg =>
        pg.classList.toggle('active', pg.dataset.prop === toolName));

    const isSelect = toolName === 'select' || toolName === 'settings';
    App.canvas.selection = isSelect;
    getMapLayers().forEach(obj => {
        obj.set({ selectable: isSelect, evented: isSelect });
    });
    if (!isSelect) App.canvas.discardActiveObject();

    // セルツール切替時: 最上位セルレイヤーを自動選択
    if (toolName === 'cell') {
        const cellLayer = getMapLayers().reverse().find(o => o._isCellLayer);
        if (cellLayer && !App.selectedLayerIds.includes(cellLayer._layerId)) {
            App.selectedLayerIds = [cellLayer._layerId];
            renderLayerList();
        }
    }

    if (toolName === 'freehand') {
        App.canvas.isDrawingMode = true;
        App.canvas.freeDrawingBrush.width = parseInt(document.getElementById('freehand-width')?.value) || 3;
        App.canvas.freeDrawingBrush.color = rgba(App.strokeColor, App.strokeOpacity);
    }
    App.canvas.defaultCursor = 'default';
    App.canvas.renderAll();
    updateFillStrokeVisibility();
    updateSelectionInfo();
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
    reader.onload = evt => {
        fabric.Image.fromURL(evt.target.result, img => {
            img.set({ left: 0, top: 0, objectCaching: false });
            addLayerObject('画像', img);
        });
    };
    reader.readAsDataURL(file); e.target.value = '';
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
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    objs.forEach(o => {
        const br = o.getBoundingRect(true);
        const zoom = App.canvas.getZoom(), vpt = App.canvas.viewportTransform;
        const oLeft = (br.left - vpt[4]) / zoom, oTop = (br.top - vpt[5]) / zoom;
        x1 = Math.min(x1, oLeft); y1 = Math.min(y1, oTop);
        x2 = Math.max(x2, oLeft + br.width / zoom); y2 = Math.max(y2, oTop + br.height / zoom);
    });
    const cs = App.cellSize;
    x1 = Math.floor(x1 / cs) * cs; y1 = Math.floor(y1 / cs) * cs;
    x2 = Math.ceil(x2 / cs) * cs; y2 = Math.ceil(y2 / cs) * cs;
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
    const savedW = App.canvas.width, savedH = App.canvas.height;
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
    document.getElementById('export-modal-info').textContent =
        `${(r.w/cs).toFixed(1)} × ${(r.h/cs).toFixed(1)} マス  (内部: ${Math.round(r.w)} × ${Math.round(r.h)} px)`;
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
    if (!r) { el.textContent = ''; return; }
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
    if (!r || r.w < 1 || r.h < 1) { alert('出力範囲を指定してください'); return; }

    const fmt = document.querySelector('input[name="export-format"]:checked').value;
    const bg = document.querySelector('input[name="export-bg"]:checked').value;
    const scale = getExportScale();
    const includeGrid = document.getElementById('export-grid').checked;

    const savedVpt = App.canvas.viewportTransform.slice();
    const savedW = App.canvas.width, savedH = App.canvas.height;
    const savedGridColor = App.gridColor;
    const savedBg = App.canvas.backgroundColor;
    const savedRect = App._exportRect;

    if (!includeGrid) App.gridColor = 'rgba(0,0,0,0)';
    if (bg === 'white') App.canvas.backgroundColor = '#ffffff';
    else if (bg === 'transparent') App.canvas.backgroundColor = null;
    App._exportRect = null;

    const outW = Math.round(r.w * scale), outH = Math.round(r.h * scale);
    App.canvas.setDimensions({ width: outW, height: outH });
    App.canvas.setViewportTransform([scale, 0, 0, scale, -r.x * scale, -r.y * scale]);
    App.canvas.renderAll();

    if (fmt === 'svg') {
        const svgStr = App.canvas.toSVG();
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'trpg-map.svg'; a.click();
        URL.revokeObjectURL(url);
    } else {
        // getElement() で実際の描画結果（グリッド含む）をキャプチャ
        const mimeType = fmt === 'jpeg' ? 'image/jpeg' : 'image/png';
        const quality = fmt === 'jpeg' ? 0.92 : undefined;
        const dataURL = App.canvas.getElement().toDataURL(mimeType, quality);
        const a = document.createElement('a'); a.href = dataURL;
        a.download = `trpg-map.${fmt === 'jpeg' ? 'jpg' : 'png'}`; a.click();
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
    document.querySelectorAll('input[name="export-bg"]').forEach(r => r.addEventListener('change', updateExportPreview));
});

/* ================================================================
   保存 / 読込  — IndexedDB
================================================================ */
const SAVE_CUSTOM_PROPS = ['_layerId','_isMapLayer','_layerName','_isCellLayer','_isTerrainLayer','_isMapText','_cellCol','_cellRow','_terrainId'];
const DB_NAME = 'trpg-mapper';
const DB_VERSION = 1;
const STORE_NAME = 'maps';

/**
 * IndexedDB 接続を返す。初回起動時に 'maps' ストアを作成する。
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** maps ストアの全レコードを取得する。 @returns {Promise<Array>} */
function dbGetAll() {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

/** maps ストアにレコードを put する (キー: record.id)。 @param {object} record */
function dbPut(record) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
}

/** maps ストアから指定 ID を削除する。 @param {string} id */
function dbDelete(id) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
}

/**
 * 現在のマップ状態をシリアライズ可能なオブジェクトに変換する。
 * Fabric の toJSON に SAVE_CUSTOM_PROPS を渡してマップ固有プロパティ (_layerId 等) を含める。
 * @returns {object}
 */
function buildSaveData() {
    return {
        version: 1,
        cellSize: App.cellSize,
        gridType: App.gridType,
        gridColor: App.gridColor,
        gridLineWidth: App.gridLineWidth,
        gridDashArray: App.gridDashArray,
        nextLayerId: App.nextLayerId,
        layerCounters: App.layerCounters,
        viewportTransform: App.canvas.viewportTransform.slice(),
        canvas: App.canvas.toJSON(SAVE_CUSTOM_PROPS),
    };
}

/**
 * buildSaveData の逆操作。App 設定とキャンバスを復元し、セル/地形レイヤーの
 * _cellData Map を子要素から再構築する (toJSON では Map が落ちるため)。
 * @param {object} data - buildSaveData() の出力
 */
function restoreSaveData(data) {
    App.cellSize = data.cellSize || 50;
    App.gridType = data.gridType || 'square';
    App.gridColor = data.gridColor || 'rgba(0,0,0,1)';
    App.gridLineWidth = data.gridLineWidth || 1;
    App.gridDashArray = data.gridDashArray || null;
    App.nextLayerId = data.nextLayerId || 10;
    App.layerCounters = data.layerCounters || {};
    App.selectedLayerIds = [];
    App._pathPoints = []; App._polygonPoints = []; App._curvePoints = [];
    App._lineStart = null; App._drawing = null;

    App.canvas.loadFromJSON(data.canvas, function() {
        if (data.viewportTransform) App.canvas.setViewportTransform(data.viewportTransform);
        App.canvas.getObjects().forEach(obj => {
            if ((obj._isCellLayer || obj._isTerrainLayer) && obj.type === 'group') {
                obj._cellData = new Map();
                obj.getObjects().forEach(r => {
                    if (r._cellCol !== undefined && r._cellRow !== undefined) {
                        obj._cellData.set(`${r._cellCol},${r._cellRow}`, r);
                    }
                });
            }
        });
        renderLayerList();
        App.canvas.renderAll();
        drawGrid();
    });
}

/**
 * 全レイヤーの範囲を 160×120 以内に収めた PNG サムネ DataURL を生成する。
 * 保存レコードの thumbnail フィールドに使う。
 * @returns {string|null} レイヤーが無ければ null
 */
function generateThumbnail() {
    const rect = calcAutoExportRect();
    if (!rect) return null;
    const savedVpt = App.canvas.viewportTransform.slice();
    const savedW = App.canvas.width, savedH = App.canvas.height;
    const savedRect = App._exportRect;
    App._exportRect = null;

    const thumbW = 160, thumbH = 120;
    const scale = Math.min(thumbW / rect.w, thumbH / rect.h, 1);
    App.canvas.setDimensions({ width: Math.round(rect.w * scale), height: Math.round(rect.h * scale) });
    App.canvas.setViewportTransform([scale, 0, 0, scale, -rect.x * scale, -rect.y * scale]);
    App.canvas.renderAll();
    const url = App.canvas.toDataURL({ format: 'png', quality: 0.8, multiplier: 1 });

    App._exportRect = savedRect;
    App.canvas.setDimensions({ width: savedW, height: savedH });
    App.canvas.setViewportTransform(savedVpt);
    App.canvas.renderAll();
    return url;
}

/**
 * 新規プロジェクトとして IndexedDB に保存する。
 * @param {string} [name] - 省略時は日付ベースの自動名
 * @returns {Promise<object>} 保存されたレコード
 */
async function saveNewProject(name) {
    const record = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name || `マップ ${new Date().toLocaleDateString('ja-JP')}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        thumbnail: generateThumbnail(),
        data: buildSaveData(),
    };
    await dbPut(record);
    return record;
}

/**
 * 既存レコードを現在の状態で上書き保存する。createdAt は維持される。
 * @param {string} id
 * @param {string} name
 */
async function overwriteProject(id, name) {
    const record = {
        id, name,
        updatedAt: new Date().toISOString(),
        thumbnail: generateThumbnail(),
        data: buildSaveData(),
    };
    // createdAt を維持
    const all = await dbGetAll();
    const existing = all.find(r => r.id === id);
    record.createdAt = existing?.createdAt || record.updatedAt;
    await dbPut(record);
}

/** ISO日付文字列を 'YYYY/MM/DD HH:mm' 形式に整形する。 @param {string} iso */
function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/** 保存モーダル内のマップ一覧を再描画する。更新日時の新しい順に並ぶ。 */
async function renderSaveList() {
    const list = document.getElementById('save-list');
    const empty = document.getElementById('save-empty');
    const records = await dbGetAll();
    records.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    list.innerHTML = '';
    if (records.length === 0) { empty.style.display = ''; return; }
    empty.style.display = 'none';

    records.forEach(rec => {
        const item = document.createElement('div');
        item.className = 'save-item';
        item.innerHTML = `
            <img class="save-thumb" src="${rec.thumbnail || ''}" alt="" />
            <div class="save-info">
                <div class="save-name">${escHtml(rec.name)}</div>
                <div class="save-date">更新: ${fmtDate(rec.updatedAt)}</div>
            </div>
            <div class="save-actions">
                <button title="開く" data-act="open"><span class="material-icons">folder_open</span></button>
                <button title="上書き保存" data-act="overwrite"><span class="material-icons">save</span></button>
                <button title="複製" data-act="dup"><span class="material-icons">content_copy</span></button>
                <button title="名前変更" data-act="rename"><span class="material-icons">edit</span></button>
                <button title="削除" data-act="delete"><span class="material-icons">delete</span></button>
            </div>`;

        item.querySelector('[data-act="open"]').addEventListener('click', () => {
            restoreSaveData(rec.data);
            IKLab.closeModal('save-modal');
        });
        item.querySelector('[data-act="overwrite"]').addEventListener('click', async () => {
            await overwriteProject(rec.id, rec.name);
            renderSaveList();
        });
        item.querySelector('[data-act="dup"]').addEventListener('click', async () => {
            await saveNewProject(rec.name + ' (コピー)');
            renderSaveList();
        });
        item.querySelector('[data-act="rename"]').addEventListener('click', () => {
            const newName = prompt('新しい名前', rec.name);
            if (newName && newName !== rec.name) {
                rec.name = newName;
                dbPut(rec).then(() => renderSaveList());
            }
        });
        item.querySelector('[data-act="delete"]').addEventListener('click', async () => {
            if (!confirm(`「${rec.name}」を削除しますか？`)) return;
            await dbDelete(rec.id);
            renderSaveList();
        });
        list.appendChild(item);
    });
}

/** 文字列を HTML エスケープして innerHTML に安全に埋め込めるようにする。 */
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/** 保存モーダルを開き、一覧を描画してから表示する。 */
async function openSaveModal() {
    await renderSaveList();
    IKLab.openModal('save-modal');
}

/** 現在のマップ状態を JSON ファイルとしてダウンロードする (バックアップ/共有用)。 */
function handleExportJSON() {
    const data = buildSaveData();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trpg-map-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

/**
 * ユーザーが選択した JSON ファイルからマップを復元する。
 * @param {File} file
 */
function handleImportJSON(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.canvas) { alert('無効なファイル形式です'); return; }
            restoreSaveData(data);
            IKLab.closeModal('save-modal');
        } catch (err) { alert('読込エラー: ' + err.message); }
    };
    reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('save-new-btn')?.addEventListener('click', async () => {
        const name = prompt('マップ名', `マップ ${new Date().toLocaleDateString('ja-JP')}`);
        if (!name) return;
        await saveNewProject(name);
        renderSaveList();
    });
    document.getElementById('save-export-btn')?.addEventListener('click', handleExportJSON);
    document.getElementById('save-import-btn')?.addEventListener('click', () => document.getElementById('save-import-input').click());
    document.getElementById('save-import-input')?.addEventListener('change', e => { if (e.target.files[0]) handleImportJSON(e.target.files[0]); e.target.value = ''; });
});

/* ================================================================
   キーボードショートカット
================================================================ */
document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
    const key = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && key === 'z') { e.preventDefault(); return; }
    if (ctrl && key === 's') { e.preventDefault(); openSaveModal(); return; }
    if (ctrl && key === 'g') { e.preventDefault(); return; }

    if (e.key === 'Enter' && App.activeTool === 'path' && App._pathPoints.length >= 2) {
        removePreview();
        addLayerObject('折線', new fabric.Polyline(App._pathPoints, {
            stroke: rgba(App.strokeColor, App.strokeOpacity), strokeWidth: App.strokeWidth,
            strokeDashArray: App.strokeDashArray,
            fill: rgba(App.fillColor, App.fillOpacity),
            selectable: false, evented: false, objectCaching: false,
        }));
        App._pathPoints = []; e.preventDefault(); return;
    }
    if (e.key === 'Enter' && App._polygonPoints.length >= 3 && App.activeTool === 'polygon') {
        removePreview();
        addLayerObject('多角形', new fabric.Polygon(App._polygonPoints, {
            stroke: rgba(App.strokeColor, App.strokeOpacity), strokeWidth: App.strokeWidth,
            strokeDashArray: App.strokeDashArray,
            fill: rgba(App.fillColor, App.fillOpacity),
            selectable: false, evented: false, objectCaching: false,
        }));
        App._polygonPoints = []; e.preventDefault(); return;
    }
    if (e.key === 'Enter' && App._curvePoints.length >= 2 && App.activeTool === 'curve') {
        removePreview();
        const d = buildBezierPath(App._curvePoints);
        if (d) {
            addLayerObject('曲線', new fabric.Path(d, {
                stroke: rgba(App.strokeColor, App.strokeOpacity), strokeWidth: App.strokeWidth,
                strokeDashArray: App.strokeDashArray,
                fill: '',
                objectCaching: false,
            }));
        }
        App._curvePoints = []; e.preventDefault(); return;
    }
    if (e.key === 'Escape') {
        if (App._exportMode) { App._exportMode = false; App._exportDrag = null; App._exportRect = null; App.canvas.defaultCursor = 'default'; App.canvas.requestRenderAll(); return; }
        removePreview(); App._pathPoints = []; App._polygonPoints = []; App._curvePoints = []; App._lineStart = null; App._drawing = null; return;
    }

    const shortcuts = { v:'select', b:'cell', r:'rect', e:'ellipse', l:'line', p:'path', g:'polygon', d:'freehand', t:'text', i:'image', c:'curve' };
    if (shortcuts[key]) { setActiveTool(shortcuts[key]); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && App.activeTool === 'select') {
        App.canvas.getActiveObjects().forEach(o => App.canvas.remove(o));
        App.canvas.discardActiveObject();
        App.selectedLayerIds = [];
        renderLayerList(); App.canvas.renderAll(); updateSelectionInfo();
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
    document.querySelectorAll('#toolbar .tb-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
    });

    document.getElementById('tb-export')?.addEventListener('click', () => {
        App._exportMode = true;
        App._exportDrag = null;
        App._exportRect = null;
        App.canvas.defaultCursor = 'crosshair';
        App.canvas.requestRenderAll();
    });
    document.getElementById('tb-save')?.addEventListener('click', openSaveModal);

    // モード切替・グリッドタイプ（event delegation: ヘッダーが遅延挿入されるため）
    document.addEventListener('change', e => {
        if (e.target.name === 'grid-type') setGridType(e.target.value);
    });

    // 線幅 — ダッシュ配列も現在のスタイルに合わせて再計算 + 選択中オブジェクトに即適用
    document.getElementById('stroke-width').addEventListener('input', function() {
        App.strokeWidth = parseInt(this.value) || 0;
        const style = document.querySelector('input[name="stroke-style"]:checked')?.value || 'solid';
        App.strokeDashArray = getDashArray(style, App.strokeWidth);
        if (App.activeTool === 'select') {
            App.canvas.getActiveObjects().filter(o => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer)
                .forEach(o => o.set({ strokeWidth: App.strokeWidth, strokeDashArray: App.strokeDashArray }));
            App.canvas.renderAll();
        }
    });

    // 線種
    document.querySelectorAll('input[name="stroke-style"]').forEach(r => r.addEventListener('change', () => {
        App.strokeDashArray = getDashArray(r.value, App.strokeWidth);
        if (App.activeTool === 'select') {
            App.canvas.getActiveObjects().filter(o => o._isMapLayer && !o._isCellLayer && !o._isTerrainLayer)
                .forEach(o => o.set({ strokeDashArray: App.strokeDashArray }));
            App.canvas.renderAll();
        }
    }));

    // 角丸
    document.getElementById('corner-radius').addEventListener('input', function() {
        App.cornerRadius = parseInt(this.value) || 0;
        if (App.activeTool === 'select') {
            App.canvas.getActiveObjects().filter(o => o._isMapLayer && o.type === 'rect')
                .forEach(o => o.set({ rx: App.cornerRadius, ry: App.cornerRadius }));
            App.canvas.renderAll();
        }
    });

    // グリッド設定
    document.getElementById('grid-line-width').addEventListener('input', function() {
        App.gridLineWidth = parseInt(this.value) || 1; drawGrid();
    });
    document.querySelectorAll('input[name="grid-style"]').forEach(r => r.addEventListener('change', () => {
        App.gridDashArray = getDashArray(r.value, App.gridLineWidth); drawGrid();
    }));

    // レイヤー不透明度・ブレンド
    document.getElementById('layer-opacity').addEventListener('input', function() {
        const val = parseFloat(this.value);
        document.getElementById('layer-opacity-val').textContent = Math.round(val * 100) + '%';
        App.canvas.getActiveObjects().forEach(o => o.set({ opacity: val }));
        App.canvas.renderAll();
    });
    document.getElementById('layer-blend').addEventListener('change', function() {
        App.canvas.getActiveObjects().forEach(o => o.set({ globalCompositeOperation: this.value }));
        App.canvas.renderAll();
    });

    // フリーハンド線幅
    document.getElementById('freehand-width')?.addEventListener('input', function() {
        if (App.canvas.isDrawingMode) App.canvas.freeDrawingBrush.width = parseInt(this.value) || 3;
    });

    // スナップ設定
    document.getElementById('snap-enabled')?.addEventListener('change', function() {
        App.snapEnabled = this.checked;
        document.getElementById('snap-targets').classList.toggle('disabled', !this.checked);
    });
    document.getElementById('snap-intersection')?.addEventListener('change', function() { App.snapIntersection = this.checked; });
    document.getElementById('snap-center')?.addEventListener('change', function() { App.snapCenter = this.checked; });
    document.getElementById('snap-midpoint')?.addEventListener('change', function() { App.snapMidpoint = this.checked; });

    // 画像
    document.getElementById('image-upload-btn')?.addEventListener('click', () => document.getElementById('image-upload').click());
    document.getElementById('image-upload')?.addEventListener('change', handleImageUpload);

    // レイヤー追加（空グループ）
    document.getElementById('layer-add')?.addEventListener('click', () => {
        const group = new fabric.Group([], { selectable: true, evented: true, objectCaching: false });
        addLayerObject('レイヤー', group);
    });

    // セルレイヤー追加
    document.getElementById('add-cell-layer')?.addEventListener('click', createCellLayer);

    // レイヤー削除
    document.getElementById('layer-delete')?.addEventListener('click', () => {
        App.canvas.getActiveObjects().forEach(o => App.canvas.remove(o));
        App.canvas.discardActiveObject();
        App.selectedLayerIds = [];
        renderLayerList(); App.canvas.renderAll(); updateSelectionInfo();
    });

    // レイヤーリスト空白クリック → 選択解除
    document.getElementById('layer-list').addEventListener('click', e => {
        if (!e.target.closest('.layer-item')) {
            App.selectedLayerIds = [];
            App.canvas.discardActiveObject();
            App.canvas.renderAll();
            renderLayerList();
            updateSelectionInfo();
        }
    });

    // 右クリックメニュー
    document.querySelectorAll('#ctx-menu .ctx-item').forEach(item => {
        item.addEventListener('click', () => handleContextAction(item.dataset.action));
    });
    document.addEventListener('click', e => { if (!e.target.closest('#ctx-menu')) hideContextMenu(); });
    document.addEventListener('contextmenu', e => { if (!e.target.closest('#layer-list') && !e.target.closest('.canvas-container')) hideContextMenu(); });

    // 初期ツール適用
    setActiveTool('select');
});
