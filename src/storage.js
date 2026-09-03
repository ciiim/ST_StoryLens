const DB_NAME = 'story_lens_assets';
const PREFIX = 'library:';

function database() {
    const localforage = SillyTavern.libs?.localforage;
    if (!localforage) throw new Error('当前酒馆未提供 localforage');
    if (!database.instance) {
        database.instance = localforage.createInstance
            ? localforage.createInstance({ name: DB_NAME, storeName: 'libraries' })
            : localforage;
    }
    return database.instance;
}

export function getLibraryKey() {
    const context = SillyTavern.getContext();
    if (context.groupId) return `group:${context.groupId}`;
    const character = context.characters?.[context.characterId];
    const stable = character?.avatar || character?.data?.name || character?.name;
    return stable ? `character:${stable}` : 'unbound';
}

export async function loadLibrary() {
    const key = getLibraryKey();
    const library = await database().getItem(`${PREFIX}${key}`);
    return library ?? {
        version: 1,
        key,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: { worldBooks: [] },
        scenes: [],
        characterStates: [],
    };
}

export async function saveLibrary(library) {
    library.updatedAt = Date.now();
    await database().setItem(`${PREFIX}${getLibraryKey()}`, library);
    return library;
}

export async function fileToDataUrl(file) {
    if (!file?.type?.startsWith('image/')) throw new Error('请选择图片文件');
    if (file.size > 15 * 1024 * 1024) throw new Error('单张图片不能超过 15MB');
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
        reader.readAsDataURL(file);
    });
}

export function countUploaded(library) {
    return [...library.scenes, ...library.characterStates].filter(item => item.image).length;
}
