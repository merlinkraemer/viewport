const COMMENTS_ENDPOINT = '__viewport/comments';
const REVIEWED_ENDPOINT = '__viewport/reviewed';

async function request(endpoint, method, body) {
  const res = await fetch(endpoint, {
    method,
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json() : null;
  if (!res.ok) throw new Error(payload?.error || `Comments request failed (HTTP ${res.status})`);
  if (!payload || typeof payload !== 'object') throw new Error('No comments server here (static build)');
  return payload;
}

function latest(times) {
  return times.filter(Boolean).sort().at(-1) ?? null;
}

export function createCommentsStore({ onChange }) {
  let data = {};
  let marks = {};
  let available = false;
  let error = null;

  async function load() {
    try {
      [data, marks] = await Promise.all([request(COMMENTS_ENDPOINT, 'GET'), request(REVIEWED_ENDPOINT, 'GET')]);
      available = true;
      error = null;
    } catch (err) {
      available = false;
      error = err.message;
    }
    onChange();
  }

  async function write(endpoint, method, body) {
    try {
      await request(endpoint, method, body);
    } finally {
      await load();
    }
  }

  function list(key) {
    return Array.isArray(data[key]) ? data[key] : [];
  }

  function isReviewed(key) {
    const mark = marks[key];
    const comments = list(key);
    const mine = latest([mark?.done ? mark.at : null, ...comments.filter((c) => !c.by).map((c) => c.at)]);
    const since = latest([mark && !mark.done ? mark.at : null, ...comments.filter((c) => c.by).map((c) => c.at)]);
    return Boolean(mine) && (!since || mine > since);
  }

  function hasReviewData(artboardId) {
    const variantPrefix = `${artboardId}#`;
    return [...Object.keys(marks), ...Object.keys(data)].some((key) => key === artboardId || key.startsWith(variantPrefix));
  }

  import.meta.hot?.on('viewport:comments', load);
  window.addEventListener('focus', load);

  return {
    load,
    list,
    openCount: (key) => list(key).filter((comment) => !comment.resolved).length,
    isReviewed,
    hasReviewData,
    isAvailable: () => available,
    error: () => error,
    add: (key, text) => write(COMMENTS_ENDPOINT, 'POST', { artboardId: key, text }),
    update: (key, id, patch) => write(COMMENTS_ENDPOINT, 'PATCH', { artboardId: key, id, ...patch }),
    setReviewed: (keys, done) => write(REVIEWED_ENDPOINT, 'POST', { keys, done }),
  };
}
