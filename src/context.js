const MAX_SOURCE_CHARS = 60000;

function cleanText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\0/g, '').trim();
}

function collectCharacter(character) {
    const data = character?.data ?? character ?? {};
    return {
        name: cleanText(data.name || character?.name),
        description: cleanText(data.description),
        personality: cleanText(data.personality),
        scenario: cleanText(data.scenario),
        firstMessage: cleanText(data.first_mes),
        exampleDialogue: cleanText(data.mes_example),
        creatorNotes: cleanText(data.creator_notes),
        systemPrompt: cleanText(data.system_prompt),
        postHistoryInstructions: cleanText(data.post_history_instructions),
    };
}

function embeddedBookEntries(character) {
    const data = character?.data ?? character ?? {};
    const entries = data.character_book?.entries;
    if (!Array.isArray(entries)) return [];
    return entries.map((entry, index) => ({
        book: '角色卡内嵌故事书',
        title: cleanText(entry.name || entry.comment || `条目 ${index + 1}`),
        keys: Array.isArray(entry.keys) ? entry.keys : [],
        content: cleanText(entry.content),
    })).filter(entry => entry.content);
}

function normalizeBookEntries(bookName, book) {
    const rawEntries = Array.isArray(book?.entries) ? book.entries : Object.values(book?.entries ?? {});
    return rawEntries.map((entry, index) => ({
        book: bookName,
        title: cleanText(entry.comment || entry.name || `条目 ${index + 1}`),
        keys: Array.isArray(entry.key) ? entry.key : (Array.isArray(entry.keys) ? entry.keys : []),
        content: cleanText(entry.content),
        disabled: Boolean(entry.disable ?? entry.disabled),
    })).filter(entry => entry.content && !entry.disabled);
}

export function getCurrentCharacter() {
    const context = SillyTavern.getContext();
    return context.characters?.[context.characterId] ?? null;
}

export function getAvailableWorldBooks() {
    const context = SillyTavern.getContext();
    return context.getWorldInfoNames?.() ?? [];
}

export function getDefaultWorldBooks() {
    const character = getCurrentCharacter();
    const data = character?.data ?? character ?? {};
    const extra = Array.isArray(data.extensions?.world_info) ? data.extensions.world_info : [];
    const names = [data.extensions?.world, ...extra]
        .filter(value => typeof value === 'string' && value.trim());
    return [...new Set(names)];
}

export async function collectStorySource(selectedWorldBooks = []) {
    const context = SillyTavern.getContext();
    const characterRaw = getCurrentCharacter();
    if (!characterRaw && !context.groupId) throw new Error('请先打开一个角色聊天');

    const character = collectCharacter(characterRaw);
    const entries = embeddedBookEntries(characterRaw);
    for (const name of selectedWorldBooks) {
        try {
            const book = await context.loadWorldInfo(name);
            entries.push(...normalizeBookEntries(name, book));
        } catch (error) {
            console.warn(`[story_lens] 无法读取故事书 ${name}`, error);
        }
    }

    const compact = { character, worldInfo: entries };
    let serialized = JSON.stringify(compact, null, 2);
    if (serialized.length > MAX_SOURCE_CHARS) {
        serialized = serialized.slice(0, MAX_SOURCE_CHARS) + '\n[内容因长度限制被截断]';
    }
    return { character, entries, serialized };
}

export function latestAssistantText() {
    const chat = SillyTavern.getContext().chat ?? [];
    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index];
        if (!message?.is_user && !message?.is_system && message?.mes) return String(message.mes);
    }
    return '';
}
