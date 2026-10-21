const ENDPOINT = '__viewport/comments';

async function request(method, body) {
  const res = await fetch(ENDPOINT, {
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
      data = await request('GET');
      available = true;
      error = null;
    } catch (err) {
      available = false;
      error = err.message;
    }
    onChange();
  }

  async function write(method, body) {
    try {
      await request(method, body);
    } finally {
      await load();
    }
  }

  function list(artboardId) {
    return Array.isArray(data[artboardId]) ? data[artboardId] : [];
  }

  import.meta.hot?.on('viewport:comments', load);
  window.addEventListener('focus', load);

  return {
    load,
    list,
    openCount: (artboardId) => list(artboardId).filter((comment) => !comment.resolved).length,
    isAvailable: () => available,
    error: () => error,
    add: (artboardId, text) => write('POST', { artboardId, text }),
    update: (artboardId, id, patch) => write('PATCH', { artboardId, id, ...patch }),
  };
}
