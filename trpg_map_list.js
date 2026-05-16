'use strict';

/* ================================================================
   マップ一覧ページ
   - IndexedDB のマップ一覧をカードグリッドで表示
   - 新規作成ウィザード (スクエア / ヘクス[後者は実装準備中])
   - 複製・名前変更・削除・JSON 出力/読込
   - カードクリックで trpg_map_maker.html?id=xxx へ遷移
================================================================ */

/* ----------------------------------------------------------------
   ウィザード状態
---------------------------------------------------------------- */
const Wizard = {
    step: 1,              // 1 | 2 | 3
    gridKind: null,       // 'square' | 'hex'
    orientation: null,    // 'flat' | 'pointy' (ヘクス時のみ)
    fit: false,           // ココフォリア整合
};

/* ----------------------------------------------------------------
   カードグリッドのレンダリング
---------------------------------------------------------------- */
async function renderList() {
    const grid = document.getElementById('map-grid');
    const empty = document.getElementById('empty-state');
    const records = await dbGetAll();
    records.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    grid.innerHTML = '';
    if (records.length === 0) {
        empty.style.display = '';
        // 空状態 → 自動的にウィザード起動 (Q6)
        openCreateModal();
        return;
    }
    empty.style.display = 'none';

    records.forEach(rec => {
        const card = document.createElement('div');
        card.className = 'map-card';
        const gridLabel = gridTypeLabel(rec.gridType || rec.data?.gridType || 'square');
        card.innerHTML = `
            <div class="thumb-wrap">
                ${rec.thumbnail ? `<img src="${rec.thumbnail}" alt="" />` : ''}
                <span class="grid-badge">${escMapHtml(gridLabel)}</span>
            </div>
            <div class="info">
                <div class="name">${escMapHtml(rec.name)}</div>
                <div class="date">更新: ${fmtMapDate(rec.updatedAt)}</div>
            </div>
            <div class="actions">
                <button title="複製" data-act="dup"><span class="material-icons">content_copy</span></button>
                <button title="名前変更" data-act="rename"><span class="material-icons">edit</span></button>
                <button title="JSON出力" data-act="export"><span class="material-icons">file_download</span></button>
                <button title="削除" data-act="delete"><span class="material-icons">delete</span></button>
            </div>`;

        // サムネクリック / info クリックで編集画面へ
        const goEdit = () => { location.href = `trpg_map_maker.html?id=${encodeURIComponent(rec.id)}`; };
        card.querySelector('.thumb-wrap').addEventListener('click', goEdit);
        card.querySelector('.info').addEventListener('click', goEdit);

        card.querySelector('[data-act="dup"]').addEventListener('click', () => duplicateMap(rec));
        card.querySelector('[data-act="rename"]').addEventListener('click', () => renameMap(rec));
        card.querySelector('[data-act="export"]').addEventListener('click', () => exportMapJSON(rec));
        card.querySelector('[data-act="delete"]').addEventListener('click', () => deleteMap(rec));

        grid.appendChild(card);
    });
}

/** gridType 文字列を表示用ラベルに変換。 */
function gridTypeLabel(gt) {
    switch (gt) {
        case 'square': return 'スクエア';
        case 'hex-flat': return 'フラット';
        case 'hex-flat-fit': return 'フラット (fit)';
        case 'hex-pointy': return 'ポインティ';
        case 'hex-pointy-fit': return 'ポインティ (fit)';
        default: return gt;
    }
}

/* ----------------------------------------------------------------
   マップ操作
---------------------------------------------------------------- */
async function duplicateMap(rec) {
    const newRec = {
        ...rec,
        id: generateMapId(),
        name: rec.name + ' (コピー)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    await dbPut(newRec);
    renderList();
}

async function renameMap(rec) {
    const newName = prompt('新しい名前', rec.name);
    if (!newName || newName === rec.name) return;
    rec.name = newName;
    rec.updatedAt = new Date().toISOString();
    await dbPut(rec);
    renderList();
}

async function deleteMap(rec) {
    if (!confirm(`「${rec.name}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    await dbDelete(rec.id);
    renderList();
}

function exportMapJSON(rec) {
    const blob = new Blob([JSON.stringify(rec.data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeName = (rec.name || 'map').replace(/[\\/:*?"<>|]/g, '_');
    a.download = `${safeName}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function importMapJSON(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.canvas) { alert('無効なファイル形式です'); return; }
        const baseName = file.name.replace(/\.json$/i, '');
        const rec = {
            id: generateMapId(),
            name: baseName || `インポート ${new Date().toLocaleDateString('ja-JP')}`,
            gridType: data.gridType || 'square',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            thumbnail: null,
            data,
        };
        await dbPut(rec);
        renderList();
    } catch (err) {
        alert('読込エラー: ' + err.message);
    }
}

/* ----------------------------------------------------------------
   新規作成ウィザード
---------------------------------------------------------------- */
function openCreateModal() {
    // リセット
    Wizard.step = 1;
    Wizard.gridKind = null;
    Wizard.orientation = null;
    Wizard.fit = false;
    document.getElementById('wizard-name').value = `マップ ${new Date().toLocaleDateString('ja-JP')}`;
    document.getElementById('wizard-fit').checked = false;
    updateWizardUI();
    IKLab.openModal('create-modal');
    setTimeout(() => document.getElementById('wizard-name').focus({ preventScroll: true }), 100);
}

function closeCreateModal() {
    IKLab.closeModal('create-modal');
}
window.closeCreateModal = closeCreateModal;

function updateWizardUI() {
    // ステップの表示切替
    document.querySelectorAll('.wizard-step').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.step) === Wizard.step);
    });
    // 戻るボタン
    document.getElementById('wizard-back-btn').disabled = (Wizard.step === 1);
    // タイトル
    const titles = { 1: '新規マップ作成 — 種類', 2: '新規マップ作成 — 向き', 3: '新規マップ作成 — 名前' };
    document.getElementById('wizard-title').textContent = titles[Wizard.step] || '新規マップ作成';
    // 要約
    document.getElementById('wizard-summary').textContent = composeWizardSummary();
    // Step 3 の fit 行 (ヘクス時のみ)
    document.getElementById('wizard-fit-row').style.display = (Wizard.gridKind === 'hex') ? '' : 'none';
}

function composeWizardSummary() {
    const parts = [];
    if (Wizard.gridKind === 'square') parts.push('スクエア');
    if (Wizard.gridKind === 'hex') {
        parts.push('ヘクス');
        if (Wizard.orientation === 'flat') parts.push('フラットトップ');
        if (Wizard.orientation === 'pointy') parts.push('ポインティトップ');
        if (Wizard.step >= 3 && Wizard.fit) parts.push('+ ココフォリア整合');
    }
    return parts.join(' / ');
}

function wizardNext(nextStep) {
    Wizard.step = nextStep;
    updateWizardUI();
}

function wizardBack() {
    if (Wizard.step === 1) return;
    if (Wizard.step === 3 && Wizard.gridKind === 'square') {
        Wizard.step = 1; // square なら step 2 はスキップ
    } else {
        Wizard.step -= 1;
    }
    updateWizardUI();
}

function composeGridType() {
    if (Wizard.gridKind === 'square') return 'square';
    if (Wizard.gridKind === 'hex' && Wizard.orientation) {
        return `hex-${Wizard.orientation}${Wizard.fit ? '-fit' : ''}`;
    }
    return 'square';
}

async function handleCreate() {
    const name = (document.getElementById('wizard-name').value || '').trim();
    if (!name) { alert('マップ名を入力してください'); return; }
    Wizard.fit = document.getElementById('wizard-fit').checked;
    const gridType = composeGridType();
    const rec = {
        id: generateMapId(),
        name,
        gridType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        thumbnail: null,
        // 空マップの初期 data。エディタ側で完全な空のキャンバスをロードする想定。
        data: {
            version: 1,
            cellSize: 60,
            gridType,
            gridColor: 'rgba(0,0,0,1)',
            gridLineWidth: 1,
            gridDashArray: null,
            nextLayerId: 10,
            layerCounters: {},
            viewportTransform: null,
            canvas: { version: '5.3.1', objects: [], background: null },
        },
    };
    await dbPut(rec);
    location.href = `trpg_map_maker.html?id=${encodeURIComponent(rec.id)}`;
}

/* ----------------------------------------------------------------
   初期化
---------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    renderList();

    document.getElementById('btn-new').addEventListener('click', openCreateModal);
    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
    document.getElementById('import-file').addEventListener('change', e => {
        if (e.target.files[0]) importMapJSON(e.target.files[0]);
        e.target.value = '';
    });

    // ウィザード — タイルクリック
    document.querySelectorAll('.wizard-step[data-step="1"] .wizard-tile').forEach(tile => {
        tile.addEventListener('click', () => {
            if (tile.disabled) return;
            Wizard.gridKind = tile.dataset.gridType;
            // square ならステップ 2 (向き) をスキップして 3 (名前) へ
            wizardNext(Wizard.gridKind === 'square' ? 3 : 2);
        });
    });
    document.querySelectorAll('.wizard-step[data-step="2"] .wizard-tile').forEach(tile => {
        tile.addEventListener('click', () => {
            Wizard.orientation = tile.dataset.orientation;
            wizardNext(3);
        });
    });

    document.getElementById('wizard-back-btn').addEventListener('click', wizardBack);
    document.getElementById('wizard-create-btn').addEventListener('click', handleCreate);
    document.getElementById('wizard-name').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
    });
});
