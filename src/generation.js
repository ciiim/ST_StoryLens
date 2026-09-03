import { settings } from './settings.js';
import { collectStorySource, latestAssistantText } from './context.js';
import { loadLibrary, saveLibrary } from './storage.js';

let sessionApiKey = '';

export function setSessionApiKey(value) {
    sessionApiKey = String(value ?? '').trim();
}

function stripCodeFence(text) {
    return String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function parseJson(text) {
    try {
        return JSON.parse(stripCodeFence(text));
    } catch {
        const match = String(text).match(/\{[\s\S]*\}/);
        if (!match) throw new Error('模型没有返回有效 JSON');
        return JSON.parse(match[0]);
    }
}

async function callModel({ systemPrompt, prompt, jsonSchema }) {
    if (settings.apiMode === 'preset') {
        const result = await SillyTavern.getContext().generateRaw({ systemPrompt, prompt, jsonSchema });
        return parseJson(result);
    }

    if (!settings.customEndpoint || !settings.customModel) {
        throw new Error('请先填写自定义 API 地址和模型名称');
    }
    const headers = { 'Content-Type': 'application/json' };
    if (sessionApiKey) headers.Authorization = `Bearer ${sessionApiKey}`;
    const response = await fetch(settings.customEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: settings.customModel,
            temperature: 0.25,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt },
            ],
        }),
    });
    if (!response.ok) throw new Error(`自定义 API 返回 ${response.status}`);
    const payload = await response.json();
    return parseJson(payload.choices?.[0]?.message?.content ?? payload.output_text ?? payload.content);
}

function promptLibrarySchema(sceneCount, stateCount) {
    const item = type => ({
        type: 'object',
        additionalProperties: false,
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            prompt: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            category: type === 'scene'
                ? { type: 'string', enum: ['日常', '非日常'] }
                : { type: 'string', enum: ['默认', '服装', '表情', '动作', '受伤或特殊'] },
        },
        required: ['name', 'description', 'prompt', 'tags', 'category'],
    });
    return {
        name: 'StoryLensAssetLibrary',
        strict: true,
        value: {
            type: 'object',
            additionalProperties: false,
            properties: {
                scenes: { type: 'array', minItems: sceneCount, maxItems: sceneCount, items: item('scene') },
                characterStates: { type: 'array', minItems: stateCount, maxItems: stateCount, items: item('state') },
            },
            required: ['scenes', 'characterStates'],
        },
    };
}

function normalizeItems(items, prefix) {
    return (Array.isArray(items) ? items : []).map((item, index) => ({
        id: `${prefix}-${Date.now()}-${index}`,
        name: String(item.name || `${prefix === 'scene' ? '场景' : '动态'} ${index + 1}`),
        description: String(item.description || ''),
        prompt: String(item.prompt || ''),
        tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        category: String(item.category || ''),
        image: '',
        imageName: '',
    }));
}

export async function generateAssetLibrary({ sceneCount, stateCount, selectedWorldBooks }) {
    const source = await collectStorySource(selectedWorldBooks);
    const result = await callModel({
        systemPrompt: '你是影视概念设计与文生图提示词专家。严格依据给定设定工作，不补充互相冲突的身份或世界观。只输出符合 JSON Schema 的 JSON。提示词应能独立用于主流文生图模型，避免艺术家姓名和受版权保护的风格模仿。',
        prompt: `根据下列角色卡与故事书设定，创建 ${sceneCount} 个可能在剧情中出现的场景，以及 ${stateCount} 个角色形象动态。\n\n场景需要兼顾日常和非日常情境，并明确地点、时间、天气、光线、镜头与氛围；不要在纯场景图中安排主体人物。\n角色动态必须保持角色身份和核心外貌一致，同时覆盖外貌、身材、服装、表情与动作；提示词应包含适合立绘或半身像的构图说明。\n名称简短、互不重复；description 用中文说明用途；prompt 输出详细中文生图提示词。\n\n设定资料：\n${source.serialized}`,
        jsonSchema: promptLibrarySchema(sceneCount, stateCount),
    });
    if (!Array.isArray(result.scenes) || result.scenes.length !== sceneCount || !Array.isArray(result.characterStates) || result.characterStates.length !== stateCount) {
        throw new Error(`模型返回的素材数量不正确：需要 ${sceneCount} 个场景和 ${stateCount} 个角色动态，请重试`);
    }
    const previous = await loadLibrary();
    const library = {
        ...previous,
        source: {
            worldBooks: selectedWorldBooks,
            characterName: source.character.name,
            entryCount: source.entries.length,
            analyzedAt: Date.now(),
        },
        scenes: normalizeItems(result.scenes, 'scene'),
        characterStates: normalizeItems(result.characterStates, 'state'),
    };
    await saveLibrary(library);
    return library;
}

export async function rewriteItemPrompt(item, type, selectedWorldBooks, direction = '') {
    const source = await collectStorySource(selectedWorldBooks);
    const schema = {
        name: 'StoryLensSinglePrompt',
        strict: true,
        value: {
            type: 'object', additionalProperties: false,
            properties: {
                name: { type: 'string' }, description: { type: 'string' }, prompt: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } }, category: { type: 'string' },
            },
            required: ['name', 'description', 'prompt', 'tags', 'category'],
        },
    };
    return await callModel({
        systemPrompt: '你是文生图提示词专家。严格遵守角色与世界观事实，并优先落实用户给出的重写倾向。只输出符合 JSON Schema 的 JSON。',
        prompt: `重写当前选中的${type === 'scene' ? '剧情场景' : '角色形象动态'}栏位。可以调整名称、用途说明、分类、标签和生图提示词，但不得改变设定中的核心事实。\n\n用户的重写倾向：\n${String(direction).trim() || '没有额外倾向，请在保留原意的基础上提升画面表现力和可生成性。'}\n\n当前栏位：\n${JSON.stringify(item)}\n\n角色与故事书设定：\n${source.serialized}`,
        jsonSchema: schema,
    });
}

function missingSuggestionSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'description', 'category', 'tags'],
    };
}

async function generateMissingItem({ type, suggestion, message, library, source }) {
    const isScene = type === 'scene';
    const schema = {
        name: 'StoryLensMissingItem',
        strict: true,
        value: {
            type: 'object',
            additionalProperties: false,
            properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                prompt: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                category: isScene
                    ? { type: 'string', enum: ['日常', '非日常'] }
                    : { type: 'string', enum: ['默认', '服装', '表情', '动作', '受伤或特殊'] },
            },
            required: ['name', 'description', 'prompt', 'tags', 'category'],
        },
    };
    const existing = (isScene ? library.scenes : library.characterStates).map(({ name, description, prompt, tags, category }) => ({
        name,
        description,
        prompt: String(prompt || '').slice(0, 1200),
        tags,
        category,
    }));
    const result = await callModel({
        systemPrompt: '你是影视概念设计与文生图提示词专家。严格依据角色卡、故事书和最新剧情生成一个真正缺失的素材条目。不得改写角色身份或世界观事实，不得与现有条目重复。只输出符合 JSON Schema 的 JSON。',
        prompt: `为素材库补充一个${isScene ? '剧情场景' : '角色形象动态'}。\n\n最新角色回复：\n${message.slice(0, 12000)}\n\n连续性分析给出的建议：\n${JSON.stringify(suggestion)}\n\n同类现有素材（不得生成近义重复项）：\n${JSON.stringify(existing)}\n\n角色与故事书设定：\n${source.serialized}\n\n${isScene ? '场景提示词应完整描述地点、时间、天气、光线、镜头和氛围，不要安排主体人物。' : '角色动态提示词应保持核心外貌与身材一致，并完整描述服装、表情、动作和适合立绘或半身像的构图。'}提示词使用详细中文，可独立交给主流文生图模型。`,
        jsonSchema: schema,
    });
    return normalizeItems([result], isScene ? 'scene' : 'state')[0];
}

function sameName(left, right) {
    return String(left || '').trim().toLocaleLowerCase() === String(right || '').trim().toLocaleLowerCase();
}

export async function analyzeLatestReply() {
    const library = await loadLibrary();
    const message = latestAssistantText();
    if (!message || (!library.scenes.length && !library.characterStates.length)) return null;
    const candidates = {
        scenes: library.scenes.map(({ id, name, description, prompt, tags, category, image }) => ({ id, name, description, prompt: String(prompt || '').slice(0, 1200), tags, category, hasImage: Boolean(image) })),
        characterStates: library.characterStates.map(({ id, name, description, prompt, tags, category, image }) => ({ id, name, description, prompt: String(prompt || '').slice(0, 1200), tags, category, hasImage: Boolean(image) })),
    };
    const schema = {
        name: 'StoryLensRuntimeMatch',
        strict: true,
        value: {
            type: 'object', additionalProperties: false,
            properties: {
                sceneId: { type: ['string', 'null'] },
                characterStateId: { type: ['string', 'null'] },
                confidence: { type: 'number' },
                reason: { type: 'string' },
                newSceneNeeded: { type: 'boolean' },
                newScene: missingSuggestionSchema(),
                newCharacterStateNeeded: { type: 'boolean' },
                newCharacterState: missingSuggestionSchema(),
            },
            required: ['sceneId', 'characterStateId', 'confidence', 'reason', 'newSceneNeeded', 'newScene', 'newCharacterStateNeeded', 'newCharacterState'],
        },
    };
    const result = await callModel({
        systemPrompt: '你是剧情镜头连续性分析器。优先复用候选素材；只有最新回复中的场景或角色形象动态与所有候选都存在明显语义差异时，才要求新增。近义表达、轻微姿势或光线变化不得新增。不要因为图片未上传而改变语义判断。每类最多新增一个。只输出 JSON。',
        prompt: `最新角色回复：\n${message.slice(0, 12000)}\n\n候选素材：\n${JSON.stringify(candidates)}\n\n分别判断场景与角色动态。能合理匹配时填写现有 id，并将对应 new*Needed 设为 false；确实没有合理候选时将 id 设为 null、new*Needed 设为 true，并在对应 new* 对象中给出简短名称、用途说明、分类和标签。不需要新增的 new* 对象仍须返回，内容使用空字符串和空数组。`,
        jsonSchema: schema,
    });
    let scene = library.scenes.find(item => item.id === result.sceneId) ?? null;
    let state = library.characterStates.find(item => item.id === result.characterStateId) ?? null;
    const addedItems = [];
    const additions = [];
    if (settings.autoExpandLibrary && !scene && result.newSceneNeeded && String(result.newScene?.name || '').trim()) {
        additions.push({ type: 'scene', suggestion: result.newScene });
    }
    if (settings.autoExpandLibrary && !state && result.newCharacterStateNeeded && String(result.newCharacterState?.name || '').trim()) {
        additions.push({ type: 'state', suggestion: result.newCharacterState });
    }
    if (additions.length) {
        const source = await collectStorySource(settings.selectedWorldBooks);
        const generated = await Promise.all(additions.map(addition => generateMissingItem({ ...addition, message, library, source })));
        generated.forEach((item, index) => {
            const type = additions[index].type;
            const items = type === 'scene' ? library.scenes : library.characterStates;
            const duplicate = items.find(existing => sameName(existing.name, item.name));
            const resolved = duplicate ?? item;
            if (!duplicate) {
                items.push(item);
                addedItems.push({ type, id: item.id, name: item.name });
            }
            if (type === 'scene') scene = resolved;
            else state = resolved;
        });
        if (addedItems.length) await saveLibrary(library);
    }
    const runtime = {
        sceneId: settings.lockScene ? undefined : scene?.id ?? null,
        stateId: settings.lockState ? undefined : state?.id ?? null,
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
        reason: String(result.reason || ''),
        analyzedAt: Date.now(),
    };
    const context = SillyTavern.getContext();
    const current = context.chatMetadata?.story_lens_runtime ?? {};
    context.chatMetadata.story_lens_runtime = {
        ...current,
        ...Object.fromEntries(Object.entries(runtime).filter(([, value]) => value !== undefined)),
    };
    context.saveMetadataDebounced?.();
    return { ...context.chatMetadata.story_lens_runtime, addedItems };
}
