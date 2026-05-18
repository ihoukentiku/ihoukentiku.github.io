# パターン画像

## ディレクトリ構成

```
patterns/
  full/    フル解像度のパターン画像 (使用時 lazy load)
  thumb/   ピッカー用の超低画質サムネ (起動時 eager load)
```

地面/壁はディレクトリを分けない (同じ画像を両用途で使えるように)。

## 仕様

- 形式: **WebP** (帯域節約)
- フル画像: サイズは画像次第 (タイル想定なので絶対値はあまり重要ではない)。シームレスにリピートできるよう作成
- サムネ画像: 96×96 px 程度、低品質 (quality 40 程度) で OK

## 新しいパターンを追加するには

1. `full/foo.webp` (フル) と `thumb/foo.webp` (サムネ) を配置 — ファイル名は同じ
2. `map_editor.js` の `PATTERNS` 配列にエントリ追加:
   ```js
   { id: 'foo', name: '名前', file: 'foo.webp', color: '#888888', ground: 'outdoor', wall: null }
   ```
   - `ground` / `wall`: 該当ジャンル ID を入れる。両方使うなら両方埋める。使わない側は `null`
   - `color`: 画像が無いときの単色フォールバック
3. ジャンル ID は `GROUND_GENRES` / `WALL_GENRES` から (なければ追加)

## サムネ自動生成

ImageMagick / Python+PIL 等で:
```sh
python3 -c "
from PIL import Image
import os
for f in os.listdir('full'):
    if f.endswith('.webp'):
        img = Image.open(f'full/{f}')
        img.thumbnail((96, 96))
        img.save(f'thumb/{f}', 'WEBP', quality=40)
"
```
