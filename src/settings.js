export const MODULE_NAME = 'story_lens';

const defaults = Object.freeze({
    enabled: true,
    autoAnalyze: true,
    showRuntimeRail: true,
    sceneCount: 8,
    stateCount: 12,
    apiMode: 'preset',
    customEndpoint: '',
    customModel: '',
    selectedWorldBooks: [],
    railCollapsed: false,
    lockScene: false,
    lockState: false,
});

export let settings = structuredClone(defaults);

export function initializeSettings() {
    const context = SillyTavern.getContext();
    const stored = context.extensionSettings?.[MODULE_NAME] ?? {};
    settings = Object.assign(structuredClone(defaults), stored);
    context.extensionSettings[MODULE_NAME] = settings;
    return settings;
}

export function saveSettings(patch = {}) {
    Object.assign(settings, patch);
    const context = SillyTavern.getContext();
    context.extensionSettings[MODULE_NAME] = settings;
    context.saveSettingsDebounced();
}
