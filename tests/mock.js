window.__storyLensQaErrors = [];
window.addEventListener('error', event => window.__storyLensQaErrors.push(event.message));
window.addEventListener('unhandledrejection', event => window.__storyLensQaErrors.push(String(event.reason)));
const originalConsoleError = console.error.bind(console);
console.error = (...args) => {
    window.__storyLensQaErrors.push(args.map(String).join(' '));
    originalConsoleError(...args);
};

const seed = {
    version: 1,
    key: 'character:demo.png',
    source: { worldBooks: ['现代都市设定'], characterName: '陆沉舟', entryCount: 18 },
    scenes: [
        ['scene-1', '雨夜街巷', '非日常', '潮湿旧城区的狭窄街巷，深夜暴雨与昏黄路灯。'],
        ['scene-2', '温暖客厅', '日常', '旧公寓里安静温暖的客厅，适合日常谈话。'],
        ['scene-3', '旧车站月台', '非日常', '空旷月台与远处朦胧列车灯光。'],
        ['scene-4', '日常·窗边', '日常', '午后窗边书桌，柔和自然光。'],
    ].map(([id, name, category, description]) => ({ id, name, category, description, prompt: `${description}，电影感构图，写实光影，环境细节丰富，无人物。`, tags: [category, '电影感'], image: '', imageName: '' })),
    characterStates: [
        ['state-1', '默认立绘', '默认', '黑发青年，沉静克制的默认形象。'],
        ['state-2', '警觉', '表情', '目光锐利，身体微侧，保持戒备。'],
        ['state-3', '受伤', '受伤或特殊', '额角轻伤，衣物凌乱但神情镇定。'],
        ['state-4', '微笑', '表情', '罕见的浅淡微笑，目光柔和。'],
    ].map(([id, name, category, description]) => ({ id, name, category, description, prompt: `${description}，半身人物立绘，角色外貌一致，电影级写实光线。`, tags: [category, '半身'], image: '', imageName: '' })),
};

const memory = new Map([['library:character:demo.png', seed]]);
const db = { getItem: key => Promise.resolve(memory.get(key)), setItem: (key, value) => { memory.set(key, structuredClone(value)); return Promise.resolve(value); } };
const listeners = new Map();
const context = {
    extensionSettings: {},
    saveSettingsDebounced() {},
    characters: [{ avatar: 'demo.png', name: '陆沉舟', data: { name: '陆沉舟', description: '黑发灰眸的青年调查员。', personality: '冷静、敏锐。', scenario: '现代架空都市。', extensions: { world: '现代都市设定' } } }],
    characterId: 0,
    groupId: null,
    chat: [{ is_user: false, is_system: false, mes: '雨还在下。他靠在墙边，警觉地望向巷口。' }],
    chatMetadata: { story_lens_runtime: { sceneId: 'scene-1', stateId: 'state-2', confidence: .87, reason: '回复明确描写雨夜街巷与警觉动作。', analyzedAt: Date.now() } },
    saveMetadataDebounced() {},
    getWorldInfoNames: () => ['现代都市设定', '组织与人物'],
    loadWorldInfo: async () => ({ entries: {} }),
    generateRaw: async ({ jsonSchema, prompt }) => {
        if (jsonSchema?.name === 'StoryLensAssetLibrary') {
            const sceneCount = jsonSchema.value.properties.scenes.minItems;
            const stateCount = jsonSchema.value.properties.characterStates.minItems;
            return JSON.stringify({
                scenes: Array.from({ length: sceneCount }, (_, index) => ({ name: `测试场景 ${index + 1}`, description: '用于自动化验收的场景。', prompt: '完整场景提示词。', tags: ['测试'], category: index % 2 ? '日常' : '非日常' })),
                characterStates: Array.from({ length: stateCount }, (_, index) => ({ name: `测试动态 ${index + 1}`, description: '用于自动化验收的角色动态。', prompt: '完整角色提示词。', tags: ['测试'], category: index ? '表情' : '默认' })),
            });
        }
        if (jsonSchema?.name === 'StoryLensSinglePrompt') {
            if (!prompt.includes('更偏向冷色雨夜氛围，动作更警觉。')) throw new Error('重写倾向没有传入模型');
            return JSON.stringify({ name: '重写条目', description: '重写成功。', prompt: '重写后的完整提示词。', tags: ['重写'], category: '日常' });
        }
        if (jsonSchema?.name === 'StoryLensRuntimeMatch') return JSON.stringify({
            sceneId: null,
            characterStateId: null,
            confidence: .94,
            reason: '最新回复出现了素材库中没有的新场景和动作。',
            newSceneNeeded: true,
            newScene: { name: '雨后天台', description: '暴雨刚停后的城市天台。', category: '非日常', tags: ['天台', '雨后'] },
            newCharacterStateNeeded: true,
            newCharacterState: { name: '持伞戒备', description: '角色持伞观察四周的戒备姿态。', category: '动作', tags: ['持伞', '戒备'] },
        });
        if (jsonSchema?.name === 'StoryLensMissingItem') {
            if (prompt.includes('剧情场景')) return JSON.stringify({ name: '雨后天台', description: '暴雨刚停后的城市天台。', prompt: '雨后城市天台，积水倒映冷色天光，广角电影构图，无人物。', tags: ['天台', '雨后'], category: '非日常' });
            return JSON.stringify({ name: '持伞戒备', description: '角色持伞观察四周的戒备姿态。', prompt: '黑发灰眸青年持黑伞侧身戒备，湿润风衣，半身立绘。', tags: ['持伞', '戒备'], category: '动作' });
        }
        return '{}';
    },
    eventTypes: { CHARACTER_MESSAGE_RENDERED: 'character', CHAT_CHANGED: 'chat' },
    eventSource: { on: (event, handler) => listeners.set(event, handler) },
};

window.SillyTavern = {
    getContext: () => context,
    libs: { localforage: { createInstance: () => db } },
};
window.toastr = { success: console.log, error: console.error };
window.confirm = () => true;

await import('../index.js');
const query = new URLSearchParams(location.search);
if (query.has('smoke')) {
    setTimeout(async () => {
        const click = selector => document.querySelector(selector)?.click();
        click('#sl-open-workspace');
        await new Promise(resolve => setTimeout(resolve, 80));
        click('[data-tab="api"]');
        const custom = document.querySelector('input[name="sl-api-mode"][value="custom"]');
        custom.checked = true;
        custom.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 40));
        const preset = document.querySelector('input[name="sl-api-mode"][value="preset"]');
        preset.checked = true;
        preset.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 40));
        click('[data-tab="assets"]');
        click('[data-action="generate"]');
        await new Promise(resolve => setTimeout(resolve, 300));
        click('[data-type="state"]');
        click('[data-action="rewrite"]');
        const direction = document.querySelector('#sl-rewrite-direction');
        direction.value = '更偏向冷色雨夜氛围，动作更警觉。';
        click('[data-action="rewrite-confirm"]');
        await new Promise(resolve => setTimeout(resolve, 220));
        const rewriteApplied = document.querySelector('#sl-item-prompt')?.value === '重写后的完整提示词。';
        click('[data-action="add"]');
        const prompt = document.querySelector('#sl-item-prompt');
        prompt.value = '用户编辑后的提示词';
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
        const beforeAnalyze = structuredClone(memory.get('library:character:demo.png'));
        click('[data-action="realtime"]');
        await new Promise(resolve => setTimeout(resolve, 100));
        click('[data-runtime="analyze"]');
        await new Promise(resolve => setTimeout(resolve, 450));
        const afterAnalyze = memory.get('library:character:demo.png');
        const additionsSaved = afterAnalyze.scenes.length === beforeAnalyze.scenes.length + 1
            && afterAnalyze.characterStates.length === beforeAnalyze.characterStates.length + 1
            && afterAnalyze.scenes.some(item => item.name === '雨后天台' && item.prompt.includes('雨后城市天台'))
            && afterAnalyze.characterStates.some(item => item.name === '持伞戒备' && item.prompt.includes('持黑伞'));
        const railText = document.querySelector('#story-lens-runtime')?.textContent ?? '';
        const additionsSelected = railText.includes('雨后天台') && railText.includes('持伞戒备');
        const countsAfterFirstAnalysis = { scenes: afterAnalyze.scenes.length, states: afterAnalyze.characterStates.length };
        click('[data-runtime="analyze"]');
        await new Promise(resolve => setTimeout(resolve, 450));
        const afterRepeatedAnalysis = memory.get('library:character:demo.png');
        const duplicatePrevented = afterRepeatedAnalysis.scenes.length === countsAfterFirstAnalysis.scenes
            && afterRepeatedAnalysis.characterStates.length === countsAfterFirstAnalysis.states;
        const passed = rewriteApplied && additionsSaved && additionsSelected && duplicatePrevented && !window.__storyLensQaErrors.length && !document.querySelector('#story-lens-workspace') && document.querySelector('#story-lens-runtime');
        document.documentElement.dataset.smokeDetail = JSON.stringify({ rewriteApplied, additionsSaved, additionsSelected, duplicatePrevented, errors: window.__storyLensQaErrors });
        document.documentElement.dataset.smoke = passed ? 'pass' : 'fail';
    }, 120);
} else if (query.has('rewrite')) {
    setTimeout(async () => {
        document.querySelector('#sl-open-workspace')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        document.querySelector('[data-action="rewrite"]')?.click();
    }, 120);
} else if (query.has('display')) {
    setTimeout(async () => {
        document.querySelector('#sl-open-workspace')?.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        document.querySelector('[data-tab="display"]')?.click();
    }, 120);
} else if (!query.has('rail')) {
    setTimeout(() => document.querySelector('#sl-open-workspace')?.click(), 120);
}
