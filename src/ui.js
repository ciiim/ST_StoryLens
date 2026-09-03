import { settings, saveSettings } from './settings.js';
import { getAvailableWorldBooks, getCurrentCharacter, getDefaultWorldBooks } from './context.js';
import { countUploaded, fileToDataUrl, loadLibrary, saveLibrary } from './storage.js';
import { generateAssetLibrary, rewriteItemPrompt, setSessionApiKey } from './generation.js';

let library;
let selectedType = 'scene';
let selectedId = '';
let activeTab = 'assets';
let workspaceBusy = false;
let runtimeBusy = false;
let manualAnalyze = async () => {};
let rewriteOpen = false;
let rewriteDirection = '';

const icon = (name) => {
    const paths = {
        aperture: '<circle cx="12" cy="12" r="8"/><path d="M4.7 8h14.6M4.7 16h14.6M9 4.6l6 14.8M15 4.6 9 19.4"/>',
        copy: '<rect x="9" y="9" width="10" height="10" rx="2"/><path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
        upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M5 15v4h14v-4"/>',
        refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
        lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
        unlock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.3-2.2"/>',
        chevron: '<path d="m9 18 6-6-6-6"/>',
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="m5 12 4 4L19 6"/>',
        image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-5-5L5 20"/>',
    };
    return `<svg class="sl-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.aperture}</svg>`;
};

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function toast(type, message) {
    if (window.toastr?.[type]) window.toastr[type](message);
    else console[type === 'error' ? 'error' : 'log'](`[剧情镜头] ${message}`);
}

function currentItems() {
    return selectedType === 'scene' ? library.scenes : library.characterStates;
}

function selectedItem() {
    return currentItems().find(item => item.id === selectedId) ?? currentItems()[0] ?? null;
}

function ensureSelection() {
    const items = currentItems();
    if (!items.some(item => item.id === selectedId)) selectedId = items[0]?.id ?? '';
}

function characterName() {
    const character = getCurrentCharacter();
    return character?.data?.name || character?.name || (SillyTavern.getContext().groupId ? '当前群聊' : '未选择角色');
}

function renderSettingsPanel() {
    const target = document.querySelector('#extensions_settings2');
    if (!target || document.querySelector('#story-lens-settings')) return;
    target.insertAdjacentHTML('beforeend', `
        <div id="story-lens-settings" class="story-lens-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <span class="sl-settings-title">${icon('aperture')}剧情镜头</span>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <p>根据最新剧情自动匹配场景和角色形象。</p>
                    <label class="checkbox_label"><input id="sl-enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}> 启用每轮自动分析</label>
                    <label class="checkbox_label"><input id="sl-show-rail" type="checkbox" ${settings.showRuntimeRail ? 'checked' : ''}> 显示剧情侧栏</label>
                    <button id="sl-open-workspace" class="menu_button">打开素材工作台</button>
                </div>
            </div>
        </div>`);
    document.querySelector('#sl-enabled').addEventListener('change', event => saveSettings({ enabled: event.target.checked, autoAnalyze: event.target.checked }));
    document.querySelector('#sl-show-rail').addEventListener('change', event => {
        saveSettings({ showRuntimeRail: event.target.checked });
        refreshRuntime();
    });
    document.querySelector('#sl-open-workspace').addEventListener('click', openWorkspace);
}

function renderSourceControls() {
    const books = getAvailableWorldBooks();
    const selected = new Set(settings.selectedWorldBooks);
    return `
        <section class="sl-source-strip">
            <div class="sl-source-card"><span>当前角色</span><strong>${escapeHtml(characterName())}</strong><small>来自角色卡</small></div>
            <details class="sl-source-card sl-book-picker">
                <summary><span>故事书</span><strong>${selected.size ? `已选 ${selected.size} 本` : '仅内嵌故事书'}</strong><small>点击选择来源</small></summary>
                <div class="sl-book-menu">
                    ${books.length ? books.map(name => `<label><input type="checkbox" data-world-book="${escapeHtml(name)}" ${selected.has(name) ? 'checked' : ''}> ${escapeHtml(name)}</label>`).join('') : '<p>没有可用的外部故事书</p>'}
                </div>
            </details>
            <label class="sl-stepper"><span>场景数量</span><input id="sl-scene-count" type="number" min="1" max="30" value="${settings.sceneCount}"></label>
            <label class="sl-stepper"><span>角色动态</span><input id="sl-state-count" type="number" min="1" max="40" value="${settings.stateCount}"></label>
            <button class="sl-primary" data-action="generate" ${workspaceBusy ? 'disabled' : ''}>${workspaceBusy ? '<span class="sl-spinner"></span> 正在分析设定' : `${icon('aperture')} 分析设定并生成提示词`}</button>
        </section>`;
}

function renderItemList() {
    ensureSelection();
    const items = currentItems();
    return `
        <aside class="sl-library-list">
            <div class="sl-list-switch">
                <button class="${selectedType === 'scene' ? 'active' : ''}" data-type="scene">场景 <b>${library.scenes.length}</b></button>
                <button class="${selectedType === 'state' ? 'active' : ''}" data-type="state">角色动态 <b>${library.characterStates.length}</b></button>
            </div>
            <div class="sl-list-heading"><span>${selectedType === 'scene' ? '剧情场景' : '角色形象'}</span><button title="添加空白槽位" data-action="add">${icon('plus')}</button></div>
            <div class="sl-list-scroll">
                ${items.length ? items.map(item => `
                    <button class="sl-list-row ${item.id === selectedId ? 'selected' : ''}" data-item-id="${escapeHtml(item.id)}">
                        <span class="sl-thumb">${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : icon('image')}</span>
                        <span class="sl-row-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category || '未分类')} · ${item.image ? '已上传' : '待上传'}</small><em>${escapeHtml(item.description || '暂无说明')}</em></span>
                        ${icon('chevron')}
                    </button>`).join('') : '<div class="sl-empty-list">尚未生成提示词<br><button data-action="generate">开始创建素材库</button></div>'}
            </div>
        </aside>`;
}

function renderInspector() {
    const item = selectedItem();
    if (!item) return `<main class="sl-inspector sl-empty-inspector">${icon('image')}<h3>选择或创建一个素材槽位</h3><p>提示词生成后，可逐张上传图片；不需要全部上传完也能进入实时模式。</p></main>`;
    const typeLabel = selectedType === 'scene' ? '场景' : '角色动态';
    return `
        <main class="sl-inspector">
            <div class="sl-inspector-head">
                <div><small>${typeLabel}详情</small><input id="sl-item-name" value="${escapeHtml(item.name)}" aria-label="素材名称"></div>
                <div class="sl-head-actions"><span class="sl-unsaved" hidden>未保存的更改</span><button data-action="rewrite" ${workspaceBusy ? 'disabled' : ''}>${icon('refresh')} 重写</button><button class="danger" data-action="delete">${icon('trash')} 删除</button></div>
            </div>
            <div class="sl-inspector-grid">
                <label class="sl-upload-zone" data-action="upload">
                    ${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">` : `${icon('upload')}<strong>拖拽图片到此处上传</strong><span>或点击选择文件 · JPG / PNG / WebP · 最大 15MB</span>`}
                    <input id="sl-file-input" type="file" accept="image/*" hidden>
                    ${item.image ? '<span class="sl-image-replace">点击或拖拽以替换图片</span>' : ''}
                </label>
                <div class="sl-prompt-column">
                    <div class="sl-field-head"><label for="sl-item-prompt">生图提示词</label><button data-action="copy">${icon('copy')} 复制提示词</button></div>
                    <textarea id="sl-item-prompt" rows="11">${escapeHtml(item.prompt)}</textarea>
                    <label class="sl-field"><span>用途说明</span><textarea id="sl-item-description" rows="3">${escapeHtml(item.description)}</textarea></label>
                </div>
            </div>
            <div class="sl-meta-row">
                <label class="sl-field"><span>分类</span><input id="sl-item-category" value="${escapeHtml(item.category)}"></label>
                <label class="sl-field sl-grow"><span>标签（逗号分隔）</span><input id="sl-item-tags" value="${escapeHtml(item.tags.join(', '))}"></label>
                <div class="sl-file-status"><span class="sl-status-dot ${item.image ? 'ready' : ''}"></span>${item.image ? escapeHtml(item.imageName || '已上传图片') : '此槽位尚未上传图片'}</div>
            </div>
        </main>`;
}

function renderAssetsTab() {
    const uploaded = countUploaded(library);
    const total = library.scenes.length + library.characterStates.length;
    return `
        ${renderSourceControls()}
        <div class="sl-work-area">${renderItemList()}${renderInspector()}</div>
        <footer class="sl-workspace-footer">
            <div class="sl-progress-copy"><strong>已上传 ${uploaded} / ${total}</strong><span>${uploaded < total ? '素材不完整，但可以直接继续' : '素材库已准备完成'}</span></div>
            <div class="sl-progress"><i style="width:${total ? Math.round(uploaded / total * 100) : 0}%"></i></div>
            <button class="sl-secondary" data-action="close">稍后继续</button>
            <button class="sl-primary" data-action="realtime">${icon('check')} 进入实时模式</button>
        </footer>`;
}

function renderApiTab() {
    return `<div class="sl-settings-page">
        <section><h2>分析 API</h2><p>首次生成素材提示词和每轮剧情匹配都使用这里选择的接口。</p>
            <div class="sl-api-choice">
                <label class="${settings.apiMode === 'preset' ? 'selected' : ''}"><input type="radio" name="sl-api-mode" value="preset" ${settings.apiMode === 'preset' ? 'checked' : ''}><strong>使用酒馆当前预设</strong><span>通过当前已连接的文本生成 API 调用，不需要额外填写密钥。</span></label>
                <label class="${settings.apiMode === 'custom' ? 'selected' : ''}"><input type="radio" name="sl-api-mode" value="custom" ${settings.apiMode === 'custom' ? 'checked' : ''}><strong>OpenAI 兼容自定义接口</strong><span>浏览器直接请求，需要接口允许 CORS。</span></label>
            </div>
        </section>
        <section class="sl-custom-api ${settings.apiMode !== 'custom' ? 'muted' : ''}"><h3>自定义接口</h3>
            <label class="sl-field"><span>Chat Completions 完整地址</span><input id="sl-custom-endpoint" value="${escapeHtml(settings.customEndpoint)}" placeholder="https://example.com/v1/chat/completions" ${settings.apiMode !== 'custom' ? 'disabled' : ''}></label>
            <label class="sl-field"><span>模型名称</span><input id="sl-custom-model" value="${escapeHtml(settings.customModel)}" placeholder="model-name" ${settings.apiMode !== 'custom' ? 'disabled' : ''}></label>
            <label class="sl-field"><span>API Key（仅本次页面会话，绝不保存）</span><input id="sl-custom-key" type="password" autocomplete="off" placeholder="sk-…" ${settings.apiMode !== 'custom' ? 'disabled' : ''}></label>
            <p class="sl-security-note">密钥不会写入扩展设置或素材库。刷新酒馆后需要重新输入。</p>
        </section>
    </div>`;
}

function renderDisplayTab() {
    return `<div class="sl-settings-page"><section><h2>实时显示</h2><p>角色回复渲染完成后，插件会在后台匹配最贴合的场景与角色动态。</p>
        <label class="sl-toggle"><span><strong>每轮自动分析</strong><small>关闭后仍可从侧栏手动重新分析</small></span><input id="sl-auto-analyze" type="checkbox" ${settings.autoAnalyze ? 'checked' : ''}></label>
        <label class="sl-toggle"><span><strong>自动补充缺失素材</strong><small>最新回复明显无法用现有素材表达时，生成并加入一个新场景或角色动态</small></span><input id="sl-auto-expand" type="checkbox" ${settings.autoExpandLibrary ? 'checked' : ''}></label>
        <label class="sl-toggle"><span><strong>显示剧情侧栏</strong><small>窄屏设备自动变为底部抽屉</small></span><input id="sl-display-rail" type="checkbox" ${settings.showRuntimeRail ? 'checked' : ''}></label>
        <div class="sl-note"><strong>未上传素材的处理</strong><p>允许模型正常选择该槽位，侧栏会明确显示“此槽位尚未上传图片”，不会悄悄换成语义不符的其他图片。</p></div>
    </section></div>`;
}

function renderRewriteDialog() {
    const item = selectedItem();
    if (!rewriteOpen || !item) return '';
    return `<div class="sl-rewrite-backdrop">
        <section class="sl-rewrite-dialog" role="dialog" aria-modal="true" aria-labelledby="sl-rewrite-title">
            <header><div><small>${selectedType === 'scene' ? '场景' : '角色动态'} · ${escapeHtml(item.name)}</small><h2 id="sl-rewrite-title">定向重写当前栏位</h2></div><button data-action="rewrite-cancel" aria-label="关闭" ${workspaceBusy ? 'disabled' : ''}>${icon('close')}</button></header>
            <p>写下希望强化、弱化或改变的方向。角色和世界观中的核心事实仍会保留，已上传图片不会被删除。</p>
            <label for="sl-rewrite-direction">重写倾向</label>
            <textarea id="sl-rewrite-direction" rows="7" placeholder="例如：把场景改成暴雨刚停后的清晨，减少霓虹元素，突出潮湿石板路与冷色自然光；镜头更开阔，不要出现人物。" ${workspaceBusy ? 'disabled' : ''}>${escapeHtml(rewriteDirection)}</textarea>
            <small class="sl-rewrite-hint">留空则执行一般性的提示词优化。</small>
            <footer><button class="sl-secondary" data-action="rewrite-cancel" ${workspaceBusy ? 'disabled' : ''}>取消</button><button class="sl-primary" data-action="rewrite-confirm" ${workspaceBusy ? 'disabled' : ''}>${workspaceBusy ? '<span class="sl-spinner"></span> 正在重写' : `${icon('refresh')} 开始重写`}</button></footer>
        </section>
    </div>`;
}

function renderWorkspace() {
    const root = document.querySelector('#story-lens-workspace');
    if (!root) return;
    root.innerHTML = `<div class="sl-modal-shell" role="dialog" aria-modal="true" aria-label="剧情镜头素材工作台">
        <header class="sl-modal-header"><div class="sl-brand">${icon('aperture')}<strong>剧情镜头</strong></div>
            <nav><button class="${activeTab === 'assets' ? 'active' : ''}" data-tab="assets">素材库</button><button class="${activeTab === 'api' ? 'active' : ''}" data-tab="api">API与分析</button><button class="${activeTab === 'display' ? 'active' : ''}" data-tab="display">显示设置</button></nav>
            <button class="sl-close" data-action="close" aria-label="关闭">${icon('close')}</button></header>
        <div class="sl-modal-content">${activeTab === 'assets' ? renderAssetsTab() : activeTab === 'api' ? renderApiTab() : renderDisplayTab()}</div>
    </div>${renderRewriteDialog()}`;
    bindWorkspaceControls(root);
    if (rewriteOpen && !workspaceBusy) requestAnimationFrame(() => root.querySelector('#sl-rewrite-direction')?.focus());
}

async function openWorkspace() {
    library = await loadLibrary();
    if (!settings.selectedWorldBooks.length) {
        const defaults = getDefaultWorldBooks().filter(name => getAvailableWorldBooks().includes(name));
        if (defaults.length) saveSettings({ selectedWorldBooks: defaults });
    }
    if (!document.querySelector('#story-lens-workspace')) {
        const root = document.createElement('div');
        root.id = 'story-lens-workspace';
        root.className = 'story-lens-workspace';
        document.body.append(root);
    }
    document.body.classList.add('sl-workspace-open');
    renderWorkspace();
}

function closeWorkspace() {
    document.querySelector('#story-lens-workspace')?.remove();
    document.body.classList.remove('sl-workspace-open');
}

function updateSelectedFromFields() {
    const item = selectedItem();
    if (!item) return;
    item.name = document.querySelector('#sl-item-name')?.value.trim() || item.name;
    item.prompt = document.querySelector('#sl-item-prompt')?.value ?? item.prompt;
    item.description = document.querySelector('#sl-item-description')?.value ?? item.description;
    item.category = document.querySelector('#sl-item-category')?.value.trim() ?? item.category;
    item.tags = (document.querySelector('#sl-item-tags')?.value ?? '').split(/[,，]/).map(value => value.trim()).filter(Boolean);
    saveLibrary(library);
}

async function uploadSelected(file) {
    const item = selectedItem();
    if (!item || !file) return;
    try {
        item.image = await fileToDataUrl(file);
        item.imageName = file.name;
        await saveLibrary(library);
        renderWorkspace();
        await refreshRuntime();
        toast('success', '图片已保存到素材库');
    } catch (error) {
        toast('error', error.message);
    }
}

function bindWorkspaceControls(root) {
    root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { activeTab = button.dataset.tab; renderWorkspace(); }));
    root.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => { selectedType = button.dataset.type; selectedId = ''; renderWorkspace(); }));
    root.querySelectorAll('[data-item-id]').forEach(button => button.addEventListener('click', () => { selectedId = button.dataset.itemId; renderWorkspace(); }));
    root.querySelectorAll('[data-world-book]').forEach(input => input.addEventListener('change', () => {
        const selectedWorldBooks = [...root.querySelectorAll('[data-world-book]:checked')].map(node => node.dataset.worldBook);
        saveSettings({ selectedWorldBooks });
    }));
    root.querySelector('#sl-scene-count')?.addEventListener('change', event => saveSettings({ sceneCount: Math.max(1, Math.min(30, Number(event.target.value) || 8)) }));
    root.querySelector('#sl-state-count')?.addEventListener('change', event => saveSettings({ stateCount: Math.max(1, Math.min(40, Number(event.target.value) || 12)) }));
    root.querySelectorAll('input[name="sl-api-mode"]').forEach(input => input.addEventListener('change', event => { saveSettings({ apiMode: event.target.value }); renderWorkspace(); }));
    root.querySelector('#sl-custom-endpoint')?.addEventListener('change', event => saveSettings({ customEndpoint: event.target.value.trim() }));
    root.querySelector('#sl-custom-model')?.addEventListener('change', event => saveSettings({ customModel: event.target.value.trim() }));
    root.querySelector('#sl-custom-key')?.addEventListener('input', event => setSessionApiKey(event.target.value));
    root.querySelector('#sl-auto-analyze')?.addEventListener('change', event => saveSettings({ enabled: event.target.checked, autoAnalyze: event.target.checked }));
    root.querySelector('#sl-auto-expand')?.addEventListener('change', event => saveSettings({ autoExpandLibrary: event.target.checked }));
    root.querySelector('#sl-display-rail')?.addEventListener('change', event => { saveSettings({ showRuntimeRail: event.target.checked }); refreshRuntime(); });

    ['sl-item-name', 'sl-item-prompt', 'sl-item-description', 'sl-item-category', 'sl-item-tags'].forEach(id => root.querySelector(`#${id}`)?.addEventListener('input', updateSelectedFromFields));
    const input = root.querySelector('#sl-file-input');
    input?.addEventListener('change', () => uploadSelected(input.files?.[0]));
    const zone = root.querySelector('.sl-upload-zone');
    zone?.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragging'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone?.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('dragging'); uploadSelected(event.dataTransfer?.files?.[0]); });

    root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async event => {
        const action = event.currentTarget.dataset.action;
        if (action === 'close') closeWorkspace();
        if (action === 'copy') {
            await navigator.clipboard.writeText(selectedItem()?.prompt ?? '');
            toast('success', '提示词已复制');
        }
        if (action === 'add') {
            const item = { id: `${selectedType}-${Date.now()}`, name: selectedType === 'scene' ? '新场景' : '新动态', description: '', prompt: '', tags: [], category: '', image: '', imageName: '' };
            currentItems().push(item); selectedId = item.id; await saveLibrary(library); renderWorkspace();
        }
        if (action === 'delete') {
            if (!confirm('删除这个素材槽位及其中的图片？')) return;
            const items = currentItems();
            const index = items.findIndex(item => item.id === selectedId);
            if (index >= 0) items.splice(index, 1);
            selectedId = ''; await saveLibrary(library); renderWorkspace(); await refreshRuntime();
        }
        if (action === 'generate') {
            if ((library.scenes.length || library.characterStates.length) && !confirm('重新生成会替换现有提示词与已上传图片。是否继续？')) return;
            workspaceBusy = true; renderWorkspace();
            try {
                library = await generateAssetLibrary({ sceneCount: settings.sceneCount, stateCount: settings.stateCount, selectedWorldBooks: settings.selectedWorldBooks });
                selectedType = 'scene'; selectedId = library.scenes[0]?.id ?? '';
                toast('success', '提示词素材库已生成');
            } catch (error) { toast('error', error.message); }
            finally { workspaceBusy = false; renderWorkspace(); await refreshRuntime(); }
        }
        if (action === 'rewrite') {
            rewriteDirection = '';
            rewriteOpen = true;
            renderWorkspace();
        }
        if (action === 'rewrite-cancel') {
            rewriteOpen = false;
            rewriteDirection = '';
            renderWorkspace();
        }
        if (action === 'rewrite-confirm') {
            rewriteDirection = root.querySelector('#sl-rewrite-direction')?.value ?? '';
            workspaceBusy = true; renderWorkspace();
            try {
                const item = selectedItem();
                Object.assign(item, await rewriteItemPrompt(item, selectedType, settings.selectedWorldBooks, rewriteDirection));
                await saveLibrary(library);
                rewriteOpen = false;
                rewriteDirection = '';
                toast('success', '当前栏位已按倾向重写');
            } catch (error) { toast('error', error.message); }
            finally { workspaceBusy = false; renderWorkspace(); }
        }
        if (action === 'realtime') {
            saveSettings({ enabled: true, autoAnalyze: true, showRuntimeRail: true });
            closeWorkspace(); await refreshRuntime(); toast('success', '实时剧情匹配已开启');
        }
    }));
}

function runtimeCard(item, type) {
    const title = type === 'scene' ? '场景' : '形象';
    const locked = type === 'scene' ? settings.lockScene : settings.lockState;
    return `<section class="sl-runtime-card ${type}"><div class="sl-runtime-label"><span>${title}：${escapeHtml(item?.name || '尚未选择')}</span><small>${type === 'scene' ? '16:9' : '4:5'}</small></div>
        <div class="sl-runtime-media">${item?.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">` : `<div class="sl-runtime-empty">${icon('image')}<span>此槽位尚未上传图片</span><button data-runtime="workspace">前往素材库</button></div>`}<button class="prev" data-runtime="previous-${type}" aria-label="上一个">‹</button><button class="next" data-runtime="next-${type}" aria-label="下一个">›</button></div>
        <button class="sl-lock ${locked ? 'active' : ''}" data-runtime="lock-${type}">${icon(locked ? 'lock' : 'unlock')}${type === 'scene' ? (locked ? '已锁定场景' : '锁定场景') : (locked ? '已锁定形象' : '锁定形象')}</button></section>`;
}

export async function refreshRuntime(runtimeOverride) {
    let rail = document.querySelector('#story-lens-runtime');
    if (!settings.showRuntimeRail) { rail?.remove(); return; }
    library = await loadLibrary();
    const context = SillyTavern.getContext();
    const runtime = runtimeOverride ?? context.chatMetadata?.story_lens_runtime ?? {};
    const scene = Object.hasOwn(runtime, 'sceneId')
        ? library.scenes.find(item => item.id === runtime.sceneId) ?? null
        : library.scenes[0] ?? null;
    const state = Object.hasOwn(runtime, 'stateId')
        ? library.characterStates.find(item => item.id === runtime.stateId) ?? null
        : library.characterStates[0] ?? null;
    if (!rail) { rail = document.createElement('aside'); rail.id = 'story-lens-runtime'; document.body.append(rail); }
    rail.className = `story-lens-runtime ${settings.railCollapsed ? 'collapsed' : ''}`;
    rail.innerHTML = `<header><div>${icon('aperture')}<strong>剧情镜头</strong></div><button data-runtime="collapse" aria-label="收起">${icon('chevron')}</button></header>
        <div class="sl-runtime-body"><div class="sl-runtime-status"><span class="${runtimeBusy ? 'busy' : ''}"></span>${runtimeBusy ? '正在分析最新回复…' : settings.autoAnalyze ? '实时匹配中' : '手动匹配'}<small>${runtime.analyzedAt ? new Date(runtime.analyzedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</small></div>
        ${runtimeCard(scene, 'scene')}${runtimeCard(state, 'state')}
        <div class="sl-analysis-strip"><span>场景：${escapeHtml(scene?.name || '—')}</span><span>动态：${escapeHtml(state?.name || '—')}</span><strong>置信度 ${Math.round((runtime.confidence ?? 0) * 100)}%</strong></div>
        ${runtime.reason ? `<p class="sl-runtime-reason">${escapeHtml(runtime.reason)}</p>` : ''}
        <button class="sl-reanalyze" data-runtime="analyze" ${runtimeBusy ? 'disabled' : ''}>${icon('refresh')} 重新分析</button></div>`;
    bindRuntimeControls(rail);
}

function cycleRuntime(type, direction) {
    const context = SillyTavern.getContext();
    const runtime = context.chatMetadata.story_lens_runtime ?? {};
    const items = type === 'scene' ? library.scenes : library.characterStates;
    if (!items.length) return;
    const key = type === 'scene' ? 'sceneId' : 'stateId';
    const index = Math.max(0, items.findIndex(item => item.id === runtime[key]));
    runtime[key] = items[(index + direction + items.length) % items.length].id;
    runtime.analyzedAt = Date.now();
    context.chatMetadata.story_lens_runtime = runtime;
    context.saveMetadataDebounced?.();
    refreshRuntime(runtime);
}

function bindRuntimeControls(rail) {
    rail.querySelectorAll('[data-runtime]').forEach(button => button.addEventListener('click', async () => {
        const action = button.dataset.runtime;
        if (action === 'collapse') { saveSettings({ railCollapsed: !settings.railCollapsed }); refreshRuntime(); }
        if (action === 'workspace') openWorkspace();
        if (action === 'analyze') await manualAnalyze();
        if (action === 'lock-scene') { saveSettings({ lockScene: !settings.lockScene }); refreshRuntime(); }
        if (action === 'lock-state') { saveSettings({ lockState: !settings.lockState }); refreshRuntime(); }
        if (action === 'previous-scene') cycleRuntime('scene', -1);
        if (action === 'next-scene') cycleRuntime('scene', 1);
        if (action === 'previous-state') cycleRuntime('state', -1);
        if (action === 'next-state') cycleRuntime('state', 1);
    }));
}

export function setRuntimeBusy(value) {
    runtimeBusy = value;
    refreshRuntime();
}

export async function initializeUI(handlers = {}) {
    manualAnalyze = handlers.onManualAnalyze ?? manualAnalyze;
    renderSettingsPanel();
    await refreshRuntime();
}
