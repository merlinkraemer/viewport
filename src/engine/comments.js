const COMMENTS_ENDPOINT = '__viewport/comments';

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

export function createCommentsStore({ onChange }) {
  let data = {};
  let available = false;
  let error = null;

  async function load() {
    try {
      data = await request(COMMENTS_ENDPOINT, 'GET');
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

  import.meta.hot?.on('viewport:comments', load);
  window.addEventListener('focus', load);

  return {
    load,
    list,
    openCount: (key) => list(key).filter((comment) => !comment.resolved).length,
    isAvailable: () => available,
    error: () => error,
    add: (key, text) => write(COMMENTS_ENDPOINT, 'POST', { artboardId: key, text }),
    update: (key, id, patch) => write(COMMENTS_ENDPOINT, 'PATCH', { artboardId: key, id, ...patch }),
  };
}
