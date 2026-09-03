import { initializeSettings, settings, saveSettings } from './src/settings.js';
import { initializeUI, refreshRuntime, setRuntimeBusy } from './src/ui.js';
import { analyzeLatestReply } from './src/generation.js';

const MODULE_NAME = 'story_lens';
let initialized = false;
let analysisSequence = 0;

async function handleAssistantMessage() {
    if (!settings.enabled || !settings.autoAnalyze) return;
    const sequence = ++analysisSequence;
    setRuntimeBusy(true);
    try {
        const result = await analyzeLatestReply();
        if (sequence !== analysisSequence || !result) return;
        if (result.addedItems?.length) {
            const names = result.addedItems.map(item => `${item.type === 'scene' ? '场景' : '角色动态'}“${item.name}”`).join('、');
            window.toastr?.success?.(`已自动补充${names}，生图提示词已加入素材库`);
        }
        await refreshRuntime(result);
    } catch (error) {
        console.error(`[${MODULE_NAME}] 实时分析失败`, error);
        window.toastr?.error?.(`剧情镜头分析失败：${error.message}`);
    } finally {
        if (sequence === analysisSequence) setRuntimeBusy(false);
    }
}

async function boot() {
    if (initialized || !window.SillyTavern?.getContext) return;
    if (!document.querySelector('#extensions_settings2')) {
        setTimeout(boot, 100);
        return;
    }
    initialized = true;
    initializeSettings();
    await initializeUI({ onManualAnalyze: handleAssistantMessage });

    const context = SillyTavern.getContext();
    const events = context.eventTypes ?? context.event_types;
    if (events?.CHARACTER_MESSAGE_RENDERED) {
        context.eventSource.on(events.CHARACTER_MESSAGE_RENDERED, handleAssistantMessage);
    } else if (events?.MESSAGE_RECEIVED) {
        context.eventSource.on(events.MESSAGE_RECEIVED, handleAssistantMessage);
    }
    if (events?.CHAT_CHANGED) {
        context.eventSource.on(events.CHAT_CHANGED, () => refreshRuntime());
    }
    console.log(`[${MODULE_NAME}] 插件已加载`);
}

async function onActivate() {
    await boot();
}

export { onActivate, settings, saveSettings };

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0), { once: true });
} else {
    setTimeout(boot, 0);
}
