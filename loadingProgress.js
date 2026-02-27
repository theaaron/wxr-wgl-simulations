
const tasks = {};
let progressEl = null;
let vrButtonEl = null;
let allLoadedCallback = null;

export function initLoadingProgress(vrButton, container) {
    vrButtonEl = vrButton;
    vrButtonEl.disabled = true;
    vrButtonEl.textContent = 'Loading...';

    progressEl = document.createElement('div');
    progressEl.id = 'loading-progress';
    progressEl.innerHTML =
        '<div class="progress-bar"><div class="progress-fill"></div></div>' +
        '<div class="progress-text">Initializing...</div>';
    container.insertBefore(progressEl, vrButton.nextSibling);
}

export function onAllLoaded(callback) {
    allLoadedCallback = callback;
}

export async function fetchWithProgress(name, url) {
    tasks[name] = { loaded: 0, total: 0, done: false };
    render();

    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    tasks[name].total = total;

    if (!response.body || !total) {
        const buffer = await response.arrayBuffer();
        tasks[name].loaded = buffer.byteLength;
        tasks[name].total = buffer.byteLength;
        tasks[name].done = true;
        render();
        checkComplete();
        return buffer;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        tasks[name].loaded = loaded;
        render();
    }

    const combined = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
    }

    tasks[name].done = true;
    render();
    checkComplete();
    return combined.buffer;
}

export function trackTask(name) {
    tasks[name] = { loaded: 0, total: 1, done: false };
    render();
}

export function completeTask(name) {
    if (!tasks[name]) tasks[name] = { loaded: 1, total: 1, done: false };
    tasks[name].done = true;
    tasks[name].loaded = tasks[name].total || 1;
    render();
    checkComplete();
}

function checkComplete() {
    for (const t of Object.values(tasks)) {
        if (!t.done) return;
    }

    if (progressEl) {
        const text = progressEl.querySelector('.progress-text');
        const fill = progressEl.querySelector('.progress-fill');
        text.textContent = 'Resources loaded';
        fill.style.width = '100%';
        setTimeout(() => { progressEl.style.opacity = '0'; }, 1200);
    }

    if (allLoadedCallback) allLoadedCallback();
}

function render() {
    if (!progressEl) return;

    let totalBytes = 0;
    let loadedBytes = 0;
    let allHaveTotal = true;
    let doneCount = 0;
    const taskNames = Object.keys(tasks);

    for (const t of Object.values(tasks)) {
        if (t.total > 0) {
            totalBytes += t.total;
            loadedBytes += t.loaded;
        } else {
            allHaveTotal = false;
        }
        if (t.done) doneCount++;
    }

    const fill = progressEl.querySelector('.progress-fill');
    const text = progressEl.querySelector('.progress-text');

    if (allHaveTotal && totalBytes > 0) {
        const pct = Math.min(100, Math.round((loadedBytes / totalBytes) * 100));
        fill.style.width = `${pct}%`;
        const mb = (loadedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
        text.textContent = `Loading resources... ${mb} / ${totalMb} MB (${pct}%)`;
    } else {
        const pct = taskNames.length > 0 ? Math.round((doneCount / taskNames.length) * 100) : 0;
        fill.style.width = `${pct}%`;
        text.textContent = `Loading... (${doneCount}/${taskNames.length} resources)`;
    }

    if (vrButtonEl) {
        vrButtonEl.textContent = doneCount === taskNames.length && taskNames.length > 0
            ? 'Enter VR'
            : 'Loading...';
    }
}
