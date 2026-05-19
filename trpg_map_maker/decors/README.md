# 装飾スタンプ素材

## ディレクトリ構成

```
decors/
  svg/    SVG スタンプ (色変更可)
  image/  画像スタンプ (WebP/PNG など)
  thumb/  画像スタンプのピッカー用サムネ (SVG は不要)
```

## 仕様

- **SVG**: `viewBox` 必須。`fill` / `stroke` 属性は要素に直接付ける (CSS インライン推奨)
- **画像**: タイル必要なし。透過 PNG / WebP 推奨
- **scale**: `map_editor.js` の `DECORS` 配列で「1セル幅にフィットするときの初期倍率」を指定 (1 = ちょうど 1 セル、0.5 = 1セルの半分)

## 新しい装飾を追加するには

1. ファイルを `svg/` または `image/` に置く
2. (画像のみ) `thumb/` に同名のサムネを置く
3. `map_editor.js` の `DECORS` 配列にエントリ追加:
   ```js
   { id: 'foo', name: '名前', type: 'svg', file: 'foo.svg',
     genres: ['furniture', 'icon'], scale: 1,
     anchorX: 'center', anchorY: 'center' }
   ```
   - `type`: `'svg'` / `'image'`
   - `genres`: 所属ジャンル (複数可)。`floorplan` / `icon` / `furniture` / `door` / `nature` / `light` / `misc`
   - `scale`: 1 セル幅基準の初期倍率 (1 = ちょうど 1 セル幅)
   - `anchorX` / `anchorY`: 基準点 (省略時は `'center'`)
     - `anchorX`: `'left'` / `'center'` / `'right'`
     - `anchorY`: `'top'` / `'center'` / `'bottom'`
     - 9 つの組合せから 1 つ。**カーソル追従・スナップ・回転** すべての基準点になる
     - 例: ドアならヒンジを基準にしたい → `anchorX: 'left', anchorY: 'top'`

## SVG の色変更について

ピッカーで色変更すると **全 path に一律適用** されます。元の多色は失われます。
初期状態 (ピッカー未タッチ) では SVG の元色がそのまま使われます。

## ライセンス

外部素材を使用する場合 (game-icons.net など) は、公開時にライセンス表記を追加すること。
