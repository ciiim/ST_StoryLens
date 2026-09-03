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

export async function regenerateItemPrompt(item, type, selectedWorldBooks) {
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
        systemPrompt: '你是文生图提示词专家。只输出符合 JSON Schema 的 JSON。',
        prompt: `依据设定重新编写一个${type === 'scene' ? '剧情场景' : '角色形象动态'}提示词。保留原意但提升可生成性。\n原条目：${JSON.stringify(item)}\n设定：${source.serialized}`,
        jsonSchema: schema,
    });
}

export async function analyzeLatestReply() {
    const library = await loadLibrary();
    const message = latestAssistantText();
    if (!message || (!library.scenes.length && !library.characterStates.length)) return null;
    const candidates = {
        scenes: library.scenes.map(({ id, name, description, tags, category, image }) => ({ id, name, description, tags, category, hasImage: Boolean(image) })),
        characterStates: library.characterStates.map(({ id, name, description, tags, category, image }) => ({ id, name, description, tags, category, hasImage: Boolean(image) })),
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
            },
            required: ['sceneId', 'characterStateId', 'confidence', 'reason'],
        },
    };
    const result = await callModel({
        systemPrompt: '你是剧情镜头连续性分析器。只从候选列表中选择最贴合最新回复的场景和角色动态。若没有合理候选则返回 null。不要因为图片未上传而改变语义判断。只输出 JSON。',
        prompt: `最新角色回复：\n${message.slice(0, 12000)}\n\n候选素材：\n${JSON.stringify(candidates)}`,
        jsonSchema: schema,
    });
    const scene = library.scenes.find(item => item.id === result.sceneId) ?? null;
    const state = library.characterStates.find(item => item.id === result.characterStateId) ?? null;
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
    return context.chatMetadata.story_lens_runtime;
}
