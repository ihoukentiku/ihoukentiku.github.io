# 装飾 SVG 素材クレジット

`decors/svg/` 配下の SVG は主に [game-icons.net](https://game-icons.net/) からのアセットです。
ライセンス: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)

`jp-*.svg` の日本の地図記号は [openstreetmap/map-icons](https://github.com/openstreetmap/map-icons) の `japan/` ディレクトリから取得。
ライセンス: パブリックドメイン相当 (PD-style)。

公開時にサイトのフッタまたは about ページにクレジット表記すること。

## 使用素材一覧 (game-icons.net, CC BY 3.0)

| ファイル | 作者 | 元アイコン名 |
|---|---|---|
| door-simple.svg     | Delapouite | door |
| door-arched.svg     | Delapouite | arabic-door |
| double-door.svg     | Delapouite | closed-doors |
| bed.svg             | Delapouite | bed |
| desk.svg            | Delapouite | desk |
| bookshelf.svg       | Delapouite | bookshelf |
| chest.svg           | Delapouite | chest |
| barrel.svg          | Delapouite | barrel |
| fireplace.svg       | Delapouite | fireplace |
| stairs.svg          | Delapouite | 3d-stairs |
| escalator.svg       | Delapouite | escalator |
| ladder.svg          | Delapouite | ladder |
| campfire.svg        | Lorc       | campfire |
| tree-pine.svg       | Lorc       | pine-tree |
| wood-pile.svg       | Delapouite | wood-pile |
| wood-cabin.svg      | Delapouite | wood-cabin |

## 使用素材一覧 (openstreetmap/map-icons, PD)

| ファイル | 元アイコン (japan/) |
|---|---|
| jp-school.svg       | education/school/junior_high.svg |
| jp-university.svg   | education/university.svg |
| jp-hospital.svg     | health/hospital.svg |
| jp-shrine.svg       | incomming/Shrine.svg |
| jp-temple.svg       | incomming/Temple.svg |
| jp-cemetery.svg     | religion/cemetery.svg |
| jp-police.svg       | incomming/Police_station.svg |
| jp-koban.svg        | incomming/Koban.svg |
| jp-firebrigade.svg  | public/firebrigade.svg |
| jp-post.svg         | public/post_office.svg |
| jp-townhall.svg     | public/administration/townhall.svg |
| jp-court.svg        | public/administration/court_of_law.svg |
| jp-castle.svg       | sightseeing/castle.svg |
| jp-museum.svg       | sightseeing/museum.svg |
| jp-library.svg      | shopping/rental/library.svg |
| jp-spa.svg          | incomming/Spa.svg |
| jp-historical.svg   | incomming/Historical_site.svg |
| jp-factory.svg      | incomming/Factory.svg |
| jp-power-plant.svg  | incomming/Power_plant.svg |
| jp-lighthouse.svg   | misc/landmark/lighthouse.svg |
| jp-high-tower.svg   | incomming/High_Tower.svg |
| jp-rice-field.svg   | incomming/Rice_field.svg |
| jp-high-school.svg     | incomming/High_school.svg |
| jp-town-office.svg     | incomming/Town_or_Village_Office.svg |
| jp-met-observatory.svg | incomming/Meteorological_observatory.svg |
| jp-sdf.svg             | incomming/the_Self-Defense_Forces.svg |
| jp-fishing-port.svg    | incomming/Fishing_port.svg |
| jp-port.svg            | incomming/Important_port.svg |
| jp-mine.svg            | incomming/Mine.svg |
| jp-quarry.svg          | incomming/Quarry.svg |
| jp-field.svg           | incomming/Field.svg |
| jp-orchard.svg         | incomming/Orchard.svg |
| jp-tea.svg             | incomming/Tea_plantation.svg |
| jp-broadleaf.svg       | incomming/Broadleaf_trees.svg |
| jp-conifer.svg         | incomming/Coniferous_trees.svg |
| jp-bamboo.svg          | incomming/Bamboo_grove.svg |
| jp-monument.svg        | sightseeing/monument.svg |
| jp-chimney.svg         | misc/landmark/chimney.svg |
| jp-tower.svg           | misc/landmark/tower.svg |
| jp-windmill.svg        | misc/landmark/windmill.svg |

## 加工内容

### game-icons.net SVG
1. 元の SVG は黒地白アイコン (背景 path + 白アイコン path) の構造
2. 背景 path (`<path d="M0 0h512v512H0z"/>`) を削除
3. アイコン本体の `fill="#fff"` を `fill="#505050"` に変更 (白背景での視認性のため)

### 日本の地図記号 SVG
1. 元の SVG は白地に黒線 (背景 `<rect fill="white">` + 黒い `<line>`/`<path>`) の構造。一部は色付き (例: 田の青線)
2. 背景 `<rect fill="white">` を削除
3. `stroke` / `fill` の色を全て `black` に統一 (ただし `white` / `none` は保持: 内側の白抜きを残すため)

ピッカーのフィル/ストロークで色を上書きできます。
