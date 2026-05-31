'use strict';

/* ================================================================
   TRPG マップ用 IndexedDB アクセス層
   map_list.html と map_editor.html の両方から読み込む共通モジュール。
   保存レコードの構造: { id, name, gridType, createdAt, updatedAt, thumbnail, data }
================================================================ */

const DB_NAME = 'trpg-mapper';
const DB_VERSION = 1;
const STORE_NAME = 'maps';

/** Fabric.js toJSON に渡すマップ固有プロパティ。両ページ共通。 */
const SAVE_CUSTOM_PROPS = [
    '_layerId', '_isMapLayer', '_layerName',
    '_isCellLayer', '_isTerrainLayer', '_isMapText', '_isFreehandLayer',
    '_isGroundLayer', '_isWallLayer',
    '_isRoomGroup', '_isRoomGround', '_isRoomWall',
    '_isDecorLayer', '_decorId', '_decorIsSvg', '_decorScale', '_decorFlipX', '_decorFlipY', '_decorFill', '_decorStroke',
    '_terrainId', '_worldLeft', '_worldTop',
    // セルレイヤーは _cellEntries (配列) として保存 (内部 Map は再構築される)
    '_cellEntries',
    '_patternOffsetX', '_patternOffsetY', '_patternRotation', '_patternScale',
    '_patternState',
    'globalCompositeOperation',
];

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
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

/** 指定 ID のレコードを取得する。存在しなければ undefined。 */
function dbGet(id) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    }));
}

/** maps ストアにレコードを put する (キー: record.id)。 */
function dbPut(record) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
}

/** maps ストアから指定 ID を削除する。 */
function dbDelete(id) {
    return openDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const req = tx.objectStore(STORE_NAME).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    }));
}

/** ランダムなレコード ID を生成する (時刻 + 乱数)。 */
function generateMapId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** ISO 日付文字列を 'YYYY/MM/DD HH:mm' 形式に整形。 */
function fmtMapDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/** 文字列を HTML エスケープして innerHTML に安全に埋め込めるようにする。 */
function escMapHtml(s) {
    const d = document.createElement('div');
    d.textContent = s ?? '';
    return d.innerHTML;
}
