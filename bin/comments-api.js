import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const COMMENTS_ROUTE = '/__viewport/comments';
export const REVIEWED_ROUTE = '/__viewport/reviewed';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 10000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJsonObject(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
  if (!raw.trim()) return {};
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new HttpError(409, `${path.basename(filePath)} is not valid JSON, fix it first: ${err.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(409, `${path.basename(filePath)} must hold an object keyed by artboard id`);
  }
  return data;
}

async function writeJsonObject(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'Request body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

function requireArtboardId(body) {
  if (typeof body.artboardId !== 'string' || !body.artboardId.trim()) {
    throw new HttpError(400, 'artboardId is required');
  }
  return body.artboardId;
}

function requireText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new HttpError(400, 'text is required');
  if (text.length > MAX_TEXT_LENGTH) throw new HttpError(400, `text is longer than ${MAX_TEXT_LENGTH} characters`);
  return text;
}

function createCommentId() {
  return `c-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

function addComment(data, body) {
  const artboardId = requireArtboardId(body);
  const comment = { id: createCommentId(), text: requireText(body.text), at: new Date().toISOString(), resolved: false };
  data[artboardId] = [...(Array.isArray(data[artboardId]) ? data[artboardId] : []), comment];
  return comment;
}

function updateComment(data, body) {
  const artboardId = requireArtboardId(body);
  const comment = (Array.isArray(data[artboardId]) ? data[artboardId] : []).find((entry) => entry?.id === body.id);
  if (!comment) throw new HttpError(404, `No comment ${body.id} on ${artboardId}`);
  if (body.text !== undefined) comment.text = requireText(body.text);
  if (body.resolved !== undefined) comment.resolved = Boolean(body.resolved);
  return comment;
}

function markReviewed(data, body) {
  const keys = Array.isArray(body.keys) ? body.keys.filter((key) => typeof key === 'string' && key.trim()) : [];
  if (!keys.length) throw new HttpError(400, 'keys must be a non-empty array of artboard or variation ids');
  const mark = { at: new Date().toISOString(), done: body.done !== false };
  keys.forEach((key) => {
    data[key] = mark;
  });
  return mark;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function reviewedPathFor(commentsPath) {
  return path.join(path.dirname(commentsPath), 'reviewed.json');
}

export function createCommentsMiddleware(commentsPath) {
  const reviewedPath = reviewedPathFor(commentsPath);
  let queue = Promise.resolve();
  const serialized = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  async function handleComments(req, res) {
    if (req.method === 'GET') {
      sendJson(res, 200, await readJsonObject(commentsPath));
      return;
    }
    if (req.method !== 'POST' && req.method !== 'PATCH') throw new HttpError(405, 'Use GET, POST or PATCH');
    const body = await readBody(req);
    const comment = await serialized(async () => {
      const data = await readJsonObject(commentsPath);
      const changed = req.method === 'POST' ? addComment(data, body) : updateComment(data, body);
      await writeJsonObject(commentsPath, data);
      return changed;
    });
    sendJson(res, req.method === 'POST' ? 201 : 200, comment);
  }

  async function handleReviewed(req, res) {
    if (req.method === 'GET') {
      sendJson(res, 200, await readJsonObject(reviewedPath));
      return;
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Use GET or POST');
    const body = await readBody(req);
    const mark = await serialized(async () => {
      const data = await readJsonObject(reviewedPath);
      const changed = markReviewed(data, body);
      await writeJsonObject(reviewedPath, data);
      return changed;
    });
    sendJson(res, 200, mark);
  }

  return async (req, res, next) => {
    const route = (req.url || '').split('?')[0];
    const handler = route.endsWith(COMMENTS_ROUTE) ? handleComments : route.endsWith(REVIEWED_ROUTE) ? handleReviewed : null;
    if (!handler) {
      next();
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
  };
}
