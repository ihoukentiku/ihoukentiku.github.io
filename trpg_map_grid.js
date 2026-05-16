'use strict';

/* ================================================================
   GridAdapter — グリッド種別ごとの座標計算・スナップ・セル形状・描画を
   差し替え可能にする抽象層。
   App.gridType ('square' | 'hex-flat' | 'hex-flat-fit' | 'hex-pointy' | 'hex-pointy-fit')
   に対応するアダプタを GridAdapters[type] で参照する。
   呼び出し側は ga() で現在のアダプタを取得して使う。

   インタフェース (各アダプタが実装するメソッド):
     pxToCell(x, y)
        ピクセル座標 → セル住所 {col, row}。
     cellExists(col, row)
        その (col, row) が有効か (現状はスクエア・ヘクスとも常に true)。
     cellKey(col, row)
        _cellData Map のキー文字列 ("c,r")。
     createCellShape(col, row, fillStyle)
        セル1個分の fabric オブジェクト (Rect / Polygon) を生成。
        _cellCol / _cellRow をオブジェクトに付与する。
     snapPoints(x, y)
        その付近のスナップ候補配列 [{x, y, type}, ...]。
        type は 'intersection' | 'center' | 'midpoint' (呼び出し側が enabled で絞る)。
     drawGridLines(ctx, viewport)
        ctx は既に viewport transform 済みの世界座標系。グリッド線を直接描画する。
        viewport は {wl, wt, wr, wb} の世界座標範囲。
     cellNeighbors(col, row)
        塗りつぶし BFS 用の隣接セル一覧 [[col, row], ...]。
        スクエアは 4近傍、ヘクスは 6近傍。
     formatCoord(col, row)
        ステータスバー表示用の文字列 (例: "12, 7")。
================================================================ */

const GridAdapters = {};

/** 現在の App.gridType に対応する GridAdapter を返す。未対応なら square を返す。 */
function ga() {
    return GridAdapters[App.gridType] || GridAdapters.square;
}

/* ----------------------------------------------------------------
   スクエア (正方形セル) アダプタ — 既存挙動の完全な実装
---------------------------------------------------------------- */
GridAdapters.square = {
    type: 'square',

    pxToCell(x, y) {
        const cs = App.cellSize;
        return { col: Math.floor(x / cs), row: Math.floor(y / cs) };
    },

    cellExists(_col, _row) {
        return true;
    },

    cellKey(col, row) {
        return `${col},${row}`;
    },

    createCellShape(col, row, fillStyle) {
        const cs = App.cellSize;
        return new fabric.Rect({
            left: col * cs,
            top: row * cs,
            width: cs,
            height: cs,
            fill: fillStyle,
            // 隣接セル間のアンチエイリアス由来の隙間を埋めるため同色の極細ストロークを引く
            stroke: fillStyle,
            strokeWidth: 0.1,
            selectable: false,
            evented: false,
            objectCaching: false,
            _cellCol: col,
            _cellRow: row,
        });
    },

    snapPoints(x, y) {
        const cs = App.cellSize;
        return [
            // 格子点 (交点)
            { x: Math.round(x / cs) * cs, y: Math.round(y / cs) * cs, type: 'intersection' },
            // セル中心
            { x: (Math.floor(x / cs) + 0.5) * cs, y: (Math.floor(y / cs) + 0.5) * cs, type: 'center' },
            // 辺の中点 (縦辺 / 横辺)
            { x: (Math.floor(x / cs) + 0.5) * cs, y: Math.round(y / cs) * cs, type: 'midpoint' },
            { x: Math.round(x / cs) * cs, y: (Math.floor(y / cs) + 0.5) * cs, type: 'midpoint' },
        ];
    },

    drawGridLines(ctx, viewport) {
        const cs = App.cellSize;
        const sc = Math.floor(viewport.wl / cs) - 1;
        const ec = Math.ceil(viewport.wr / cs) + 1;
        const sr = Math.floor(viewport.wt / cs) - 1;
        const er = Math.ceil(viewport.wb / cs) + 1;
        ctx.beginPath();
        for (let c = sc; c <= ec; c++) {
            ctx.moveTo(c * cs, sr * cs);
            ctx.lineTo(c * cs, er * cs);
        }
        for (let r = sr; r <= er; r++) {
            ctx.moveTo(sc * cs, r * cs);
            ctx.lineTo(ec * cs, r * cs);
        }
        ctx.stroke();
    },

    cellNeighbors(col, row) {
        return [
            [col + 1, row],
            [col - 1, row],
            [col, row + 1],
            [col, row - 1],
        ];
    },

    formatCoord(col, row) {
        return `${col}, ${row}`;
    },
};

/* ================================================================
   ヘクスアダプタ — 4 種 (flat / pointy × regular / fit) を factory で生成

   座標系: 平行四辺形 (axial) — 全ての (col, row) が有効。
   セルキー: "col,row" (sub は使わない — 1 ヘクス = 1 ポリゴン)
   形状: 6 頂点の正六角形 (fit 時は変形ヘクス)
   原点: hex(0,0) のバウンディング左上が (0, 0)
   三角形塗りはスナップ + 多角形ツールで代替可能なので非対応。

   寸法 (cellSize は flat-top の高さ / pointy-top の幅):
     flat-top regular:  幅 = cellSize * 2/√3 ≈ 1.155*cs,  高さ = cellSize
     flat-top fit:      幅 = cellSize * 4/3   ≈ 1.333*cs,  高さ = cellSize
     pointy-top regular:幅 = cellSize,        高さ = cellSize * 2/√3
     pointy-top fit:    幅 = cellSize,        高さ = cellSize * 4/3

   axial 基底ベクトル (中心→隣接ヘクス):
     flat-top:   col軸 = (3dx, dy),  row軸 = (0, 2dy)
     pointy-top: col軸 = (2dx, 0),   row軸 = (dx, 3dy)

   スナップ: ヘクス頂点 (intersection) + ヘクス中心 (center) の 2 種類。
   セル塗り隣接: 6 ヘクス (BFS で塗りつぶし)。
================================================================ */

/**
 * ヘクスアダプタを生成する factory。
 * @param {'flat'|'pointy'} orientation
 * @param {boolean} fit - ココフォリア整合モード
 */
function createHexAdapter(orientation, fit) {
    const isFlat = orientation === 'flat';
    const typeName = `hex-${orientation}${fit ? '-fit' : ''}`;

    /** 現在の App.cellSize に基づくヘクス寸法パラメータ。 */
    function getParams() {
        const cs = App.cellSize;
        // csx = hex_maker の "csx" (内側次元のパラメータ)
        const csx = fit ? cs : (cs / 2) * Math.sqrt(3);
        if (isFlat) {
            return { dx: csx / 3, dy: cs / 2, W: 4 * (csx / 3), H: cs };
        } else {
            return { dx: cs / 2, dy: csx / 3, W: cs, H: 4 * (csx / 3) };
        }
    }

    /** ヘクス (col, row) の中心 px 座標。原点は hex(0,0) の bbox 左上。 */
    function hexCenter(col, row) {
        const p = getParams();
        if (isFlat) {
            return {
                x: p.W / 2 + 3 * p.dx * col,
                y: p.H / 2 + p.dy * col + 2 * p.dy * row,
            };
        } else {
            return {
                x: p.W / 2 + 2 * p.dx * col + p.dx * row,
                y: p.H / 2 + 3 * p.dy * row,
            };
        }
    }

    /** ヘクスの6頂点を時計回り (V0..V5) で返す。 */
    function hexVertices(cx, cy) {
        const { dx, dy } = getParams();
        if (isFlat) {
            return [
                { x: cx - dx, y: cy - dy }, // V0 top-left
                { x: cx + dx, y: cy - dy }, // V1 top-right
                { x: cx + 2 * dx, y: cy }, // V2 right
                { x: cx + dx, y: cy + dy }, // V3 bottom-right
                { x: cx - dx, y: cy + dy }, // V4 bottom-left
                { x: cx - 2 * dx, y: cy }, // V5 left
            ];
        } else {
            return [
                { x: cx, y: cy - 2 * dy }, // V0 top
                { x: cx + dx, y: cy - dy }, // V1 top-right
                { x: cx + dx, y: cy + dy }, // V2 bottom-right
                { x: cx, y: cy + 2 * dy }, // V3 bottom
                { x: cx - dx, y: cy + dy }, // V4 bottom-left
                { x: cx - dx, y: cy - dy }, // V5 top-left
            ];
        }
    }

    /** axial 浮動座標 (col_f, row_f) を最寄りのヘクス整数座標に丸める。 */
    function axialRound(col_f, row_f) {
        // cube 座標: x = col, z = row, y = -x-z
        const xf = col_f,
            zf = row_f,
            yf = -xf - zf;
        let rx = Math.round(xf),
            ry = Math.round(yf),
            rz = Math.round(zf);
        const ex = Math.abs(rx - xf),
            ey = Math.abs(ry - yf),
            ez = Math.abs(rz - zf);
        if (ex > ey && ex > ez) rx = -ry - rz;
        else if (ey > ez) ry = -rx - rz;
        else rz = -rx - ry;
        return { col: rx, row: rz };
    }

    /** ピクセル → 含まれるヘクス座標 (col, row)。 */
    function pxToHex(x, y) {
        const p = getParams();
        // 原点シフト後の px
        const lx = x - p.W / 2;
        const ly = y - p.H / 2;
        // 中心式の逆変換 → 浮動 axial
        if (isFlat) {
            const col_f = lx / (3 * p.dx);
            const row_f = (ly - p.dy * col_f) / (2 * p.dy);
            return axialRound(col_f, row_f);
        } else {
            const row_f = ly / (3 * p.dy);
            const col_f = (lx - p.dx * row_f) / (2 * p.dx);
            return axialRound(col_f, row_f);
        }
    }

    /** 6 ヘクス隣接へのオフセット (col, row)。順序: 上, 右上, 右下, 下, 左下, 左上 (flat) / 右上, 右, 右下, 左下, 左, 左上 (pointy)。 */
    const HEX_NEIGHBOR_OFFSETS = isFlat
        ? [
              [0, -1], // 上
              [1, -1], // 右上
              [1, 0], // 右下
              [0, 1], // 下
              [-1, 1], // 左下
              [-1, 0], // 左上
          ]
        : [
              [1, -1], // 右上
              [1, 0], // 右
              [0, 1], // 右下
              [-1, 1], // 左下
              [-1, 0], // 左
              [0, -1], // 左上
          ];

    return {
        type: typeName,
        isHex: true,
        orientation,
        fit,

        pxToCell(x, y) {
            return pxToHex(x, y);
        },

        cellExists(_col, _row) {
            return true; // axial: 全座標有効
        },

        cellKey(col, row) {
            return `${col},${row}`;
        },

        createCellShape(col, row, fillStyle) {
            const c = hexCenter(col, row);
            const verts = hexVertices(c.x, c.y);
            return new fabric.Polygon(verts, {
                fill: fillStyle,
                // 隣接ヘクス間のアンチエイリアス由来の隙間を埋めるため同色の極細ストロークを引く
                selectable: false,
                evented: false,
                objectCaching: false,
                _cellCol: col,
                _cellRow: row,
            });
        },

        snapPoints(x, y) {
            // 三角形頂点 = ヘクス頂点 + ヘクス中心
            // (x, y) を含むヘクスとその 6 近傍を候補に挙げる
            const { col, row } = pxToHex(x, y);
            const offsets = [
                [0, 0],
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
                [1, -1],
                [-1, 1],
            ];
            const candidates = [];
            for (const [dc, dr] of offsets) {
                const c = hexCenter(col + dc, row + dr);
                // ヘクス中心: 'center' タイプ (三角形頂点でもある)
                candidates.push({ x: c.x, y: c.y, type: 'center' });
                // 6 頂点: 'intersection' タイプ
                for (const v of hexVertices(c.x, c.y)) {
                    candidates.push({ x: v.x, y: v.y, type: 'intersection' });
                }
            }
            return candidates;
        },

        drawGridLines(ctx, viewport) {
            const p = getParams();
            // ビューポートをカバーする (col, row) 範囲を概算
            const margin = 2;
            let cMin, cMax, rMin, rMax;
            const lx0 = viewport.wl - p.W / 2,
                lx1 = viewport.wr - p.W / 2;
            const ly0 = viewport.wt - p.H / 2,
                ly1 = viewport.wb - p.H / 2;
            if (isFlat) {
                cMin = Math.floor(lx0 / (3 * p.dx)) - margin;
                cMax = Math.ceil(lx1 / (3 * p.dx)) + margin;
                // row は col に依存するので、両端の col に対して row 範囲を計算
                rMin = Math.floor(Math.min(ly0 / (2 * p.dy) - cMax / 2, ly0 / (2 * p.dy) - cMin / 2)) - margin;
                rMax = Math.ceil(Math.max(ly1 / (2 * p.dy) - cMin / 2, ly1 / (2 * p.dy) - cMax / 2)) + margin;
            } else {
                rMin = Math.floor(ly0 / (3 * p.dy)) - margin;
                rMax = Math.ceil(ly1 / (3 * p.dy)) + margin;
                cMin = Math.floor(Math.min(lx0 / (2 * p.dx) - rMax / 2, lx0 / (2 * p.dx) - rMin / 2)) - margin;
                cMax = Math.ceil(Math.max(lx1 / (2 * p.dx) - rMin / 2, lx1 / (2 * p.dx) - rMax / 2)) + margin;
            }
            ctx.beginPath();
            for (let c = cMin; c <= cMax; c++) {
                for (let r = rMin; r <= rMax; r++) {
                    const cen = hexCenter(c, r);
                    const verts = hexVertices(cen.x, cen.y);
                    ctx.moveTo(verts[0].x, verts[0].y);
                    for (let i = 1; i < 6; i++) ctx.lineTo(verts[i].x, verts[i].y);
                    ctx.closePath();
                }
            }
            ctx.stroke();
        },

        cellNeighbors(col, row) {
            // 6 ヘクス隣接
            return HEX_NEIGHBOR_OFFSETS.map(([dc, dr]) => [col + dc, row + dr]);
        },

        formatCoord(col, row) {
            return `${col}, ${row}`;
        },
    };
}

GridAdapters['hex-flat'] = createHexAdapter('flat', false);
GridAdapters['hex-flat-fit'] = createHexAdapter('flat', true);
GridAdapters['hex-pointy'] = createHexAdapter('pointy', false);
GridAdapters['hex-pointy-fit'] = createHexAdapter('pointy', true);
