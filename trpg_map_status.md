# TRPGマップ作成ツール — 実装状況メモ

最終更新: 2026-05-16

## 当初の実装計画 (ユーザー提示)

1. Undo / Redo
2. グループ化、グループ化解除
3. ヘクス
4. シンプルモード / 地図モード切替 (現在あるのがシンプルモード、地形や部屋ツールで使うのが地図モード)
5. セルモードの機能追加
    - ペン / 消しゴムの大きさ変更
    - 塗りつぶし (バケツ)

---

## 実装完了

### 当初リストから

- ✅ **Undo / Redo** — A 方式 (スナップショット履歴) で実装
    - 履歴上限 50、Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y、ヘッダーボタン
    - 連続編集 (スライダー類) は 500ms デバウンスで集約
    - 揮発 (マップ読込時にクリア)、Q1〜Q7 で挙動を決定
- ✅ **ヘクス** — フラットトップ / ポインティトップ × 通常 / ココフォリア整合の **4 種**
    - 平行四辺形 (axial) 座標、全 (col, row) が有効
    - 1 ヘクス = 1 `fabric.Polygon`、6 ヘクス隣接の BFS
    - スナップ: ヘクス頂点 + ヘクス中心
- ✅ **セル塗りつぶし (バケツ)** — bbox 内 BFS
    - 4 近傍 (square) / 6 近傍 (hex)
    - レイヤー範囲外クリック時はステータスバー警告
    - 上限 10000 セルで安全弁

### 追加で実装したもの

- ✅ **ページ構成変更 (案2)** — 一覧画面と編集画面を分離
    - `trpg_map_list.html` (カードグリッド + 新規作成ウィザード + JSON 入出力 + 複製 / 改名 / 削除)
    - `trpg_map_maker.html?id=xxx` (編集画面)
    - 一覧が空なら自動でウィザード起動
- ✅ **3 段ウィザード** — スクエア / ヘクス → フラット / ポインティ → ココフォリア整合 → 名前
- ✅ **自動保存 (ハイブリッド)**
    - 編集後 2.5 秒で IndexedDB へデバウンス保存 (サムネ無し)
    - Ctrl+S で即時保存 (サムネ込み)
    - ページ離脱時 (`beforeunload`) でも保存
- ✅ **保存ステータス表示** — ヘッダーに「保存済み / 編集中… / 保存中… / エラー」ピル
- ✅ **編集画面ヘッダー再設計**
    - CSS Grid 3 列レイアウト (左: マイマップへ戻る / 中: マップ名 + ステータス / 右: Undo・Redo)
- ✅ **カラーピッカー改善**
    - hex_maker と同じ Pickr スタイル
    - `change` イベントでライブ反映、`applyColor(true)` でボタン色も同期
    - 履歴はデバウンスで連続変更を集約
- ✅ **セル塗りツール UI 強化** — 3 タイルボタン (ペン / 消しゴム / 塗りつぶし)
- ✅ **JSDoc 追加** — 主要関数すべて
- ✅ **JS ファイル分離** — `trpg_map_storage.js` (DB)、`trpg_map_grid.js` (GridAdapter)、`trpg_map_list.js` (一覧)
- ✅ **GridAdapter 抽象化** — 5 種 (square + hex 4 種) を統一インタフェース
- ✅ **隣接セル AA 隙間対策** — fill と同色の 0.1〜0.5px ストロークで埋める
- ✅ **ヘクス選択肢の baked** — マップ作成時に gridType を固定 (ヘッダーの切替 UI 廃止)

---

## 未実装 (今後の課題)

### 当初リストから未着手

- ❌ **グループ化 / グループ化解除**
    - レイヤーパネルのヘッダーに `folder` アイコンボタンはあるがハンドラ未実装
    - Ctrl+G のショートカットも preventDefault のみ
- ❌ **シンプルモード / 地図モード切替**
    - 地図モード用のツール (壁・部屋・ドア・オブジェクト・ラベル) は未実装
    - `snapTools` の配列に名前だけある (`wall, room, door, object, label`)
    - 地形プリセット (`TERRAIN_PRESETS`: indoor / outdoor / cave) のデータ・パターン生成関数はあるが UI 未配置
- ❌ **ペン / 消しゴムの大きさ変更**
    - 現在は 1 セル単位固定

### 周辺の未実装

- ❌ **マップ一覧の検索 / フィルタ / ソート** — 現在は更新日順固定
- ❌ **多人数共有 / クラウド保存** — 完全ローカル (IndexedDB)
- ❌ **複数選択時のプロパティ一括編集の充実** (現在は不透明度・ブレンドモードのみ)
- ❌ **テキストの詳細編集** (フォント色を fill ピッカーと別管理にする等)

---

## 実装中に変更 / 破棄した決定事項

- **三角形セル塗り → ヘクス単位に統一**
    - 当初 1 ヘクスを 6 三角形に分割する案で実装したが、UI 複雑化と AA 隙間問題で中止
    - 多角形ツール + ヘクス頂点 / 中心スナップで三角形描画は再現可能と判断
- **ダブル座標系 → 平行四辺形 (axial) 座標**
    - hex_maker.html 流のパリティ判定システムを当初検討したが、シンプルさを優先
    - 全 (col, row) が有効になり、隣接判定・BFS・bbox 計算がクリーンに
- **編集画面の JSON 入出力 → 一覧画面のみに集約**
    - 当初は両方に置く方針 (Q4=c) だったが、編集中のマップ置換は混乱を招くため一覧専用に
- **ヘッダーの「スクエア / ヘクス」切替セグメント → 廃止**
    - マップ作成時に gridType を baked する方針に伴い不要
- **保存モーダル → 廃止**
    - 一覧画面に機能を移管
- **gridType 切替時のシェイプ保持機構 (案3) → 案2 に置き換え**
    - 案 2 (ページ分離) の方が UX として優れる

---

## アーキテクチャ概要

```
trpg_map_list.html / .js     — マップ一覧画面 + 新規作成ウィザード + JSON 入出力
trpg_map_maker.html / .js    — 編集画面 (Fabric.js キャンバス + ツール群)
trpg_map_grid.js             — GridAdapter (5 種のセル幾何を統一インタフェースで提供)
trpg_map_storage.js          — IndexedDB ラッパ + 共通ユーティリティ
common.css / common.js       — サイト共通 (ヘッダー / フッター / テーマ / モーダル / 数値スピナー)
```

### データ永続化

- **IndexedDB**: `trpg-mapper.maps` ストア
- **レコード**: `{id, name, gridType, createdAt, updatedAt, thumbnail, data}`
- **`data`** = `buildSaveData()` の出力
    ```js
    {
      version, cellSize, gridType, gridColor, gridLineWidth, gridDashArray,
      nextLayerId, layerCounters, viewportTransform,
      canvas: App.canvas.toJSON(SAVE_CUSTOM_PROPS),
    }
    ```
- **`SAVE_CUSTOM_PROPS`**: `_layerId / _isMapLayer / _layerName / _isCellLayer / _isTerrainLayer / _isMapText / _cellCol / _cellRow / _terrainId`
- **id 形式**: `Date.now().toString(36) + Math.random()` 由来の短い英数字列

### GridAdapter インタフェース

```js
{
  type,                                    // 'square' | 'hex-flat' | 'hex-flat-fit' | 'hex-pointy' | 'hex-pointy-fit'
  pxToCell(x, y),                          // → { col, row }
  cellExists(col, row),                    // → bool
  cellKey(col, row),                       // → "col,row"
  createCellShape(col, row, fillStyle),    // → fabric.Rect | fabric.Polygon
  snapPoints(x, y),                        // → [{x, y, type:'intersection'|'center'|'midpoint'}]
  drawGridLines(ctx, viewport),            // 副作用: ctx に直接描画
  cellNeighbors(col, row),                 // → [[col, row], ...]
  formatCoord(col, row),                   // → string
}
```

呼び出し側は `ga()` で現在のアダプタを参照。`case App.gridType` の分岐はゼロ。

### ヘクスの寸法 (cellSize = 60 の場合)

| gridType         | 幅    | 高さ  | 形状                              |
| ---------------- | ----- | ----- | --------------------------------- |
| `square`         | 60    | 60    | 正方形                            |
| `hex-flat`       | ~69.3 | 60    | 正六角形 (上下が平)               |
| `hex-flat-fit`   | 80    | 60    | 横長変形ヘクス (ココフォリア整合) |
| `hex-pointy`     | 60    | ~69.3 | 正六角形 (上下が頂点)             |
| `hex-pointy-fit` | 60    | 80    | 縦長変形ヘクス (ココフォリア整合) |

### 座標系 (ヘクス, axial)

- 原点: hex(0,0) のバウンディング左上が (0, 0)
- 全 (col, row) 整数組合せが有効
- フラットトップ: col 軸 = (3dx, dy), row 軸 = (0, 2dy)
- ポインティトップ: col 軸 = (2dx, 0), row 軸 = (dx, 3dy)
- 隣接 6 ヘクス: HEX_NEIGHBOR_OFFSETS で定義

---

## ファイル変更履歴 (主要マイルストーン)

1. **JSDoc 追加** — 主要関数 40+ に
2. **JS ファイル分離** — インライン `<script>` を `trpg_map_maker.js` に
3. **Undo / Redo 実装** — A 方式、Q1〜Q7 で挙動決定
4. **塗りつぶし (バケツ) 実装** — 3 タイル UI、レイヤー範囲制限
5. **カラーピッカー改善** — change イベント + applyColor(true)
6. **ページ構成変更 (案 2)** — list / maker 分離、自動保存、ウィザード
7. **ヘッダー再設計** — Grid レイアウト、目立つ「マイマップへ戻る」ボタン
8. **Undo バグ修正** — 「初期スナップショット」と「1つ前を復元」方式に
9. **GridAdapter 抽象化 (Phase 2.1)** — square を adapter 経由に
10. **ヘクス本実装 (Phase 2.2)** — 4 種実装、三角形塗り → ヘクス塗りに変更
11. **AA 隙間対策** — 同色ストローク
