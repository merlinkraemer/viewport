import fs from 'node:fs';
import path from 'node:path';
import { addComment, readJsonObject, updateComment, writeJsonObject } from './comments-api.js';

const AGENT = 'agent';
export const COMMENTS_READ_STATE = '.comments-read.json';

export function commentsUsage() {
  return `viewport comments

Usage:
  viewport comments                           print comments not seen yet, then mark them read
  viewport comments --peek                    print them without marking them read
  viewport comments --all                     print every comment (does not change read state)
  viewport comments reply <board> <text...>   answer on a board or variation key (written as by "agent")
  viewport comments resolve <board> <id>      mark one comment resolved
`;
}

export function parseCommentsArgs(rest) {
  const [first] = rest;
  if (first === 'reply' || first === 'resolve') {
    const [, board, ...tail] = rest;
    if (!board || !tail.length) throw new Error(commentsUsage());
    return { action: first, board, tail };
  }
  const flags = { peek: false, all: false };
  for (const arg of rest) {
    if (arg === '--peek') flags.peek = true;
    else if (arg === '--all') flags.all = true;
    else throw new Error(`Unknown comments argument: ${arg}\n\n${commentsUsage()}`);
  }
  return { action: 'list', ...flags };
}

function readStatePath(viewportDir) {
  return path.join(viewportDir, COMMENTS_READ_STATE);
}

function readSeen(viewportDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(readStatePath(viewportDir), 'utf8'));
    return new Set(Array.isArray(parsed.seen) ? parsed.seen : []);
  } catch (err) {
    if (err.code === 'ENOENT') return new Set();
    throw new Error(`${COMMENTS_READ_STATE} is unreadable, delete it to start over: ${err.message}`);
  }
}

function ensureGitignored(projectRoot, viewportDir) {
  const line = `${path.relative(projectRoot, viewportDir).split(path.sep).join('/')}/${COMMENTS_READ_STATE}`;
  const ignorePath = path.join(projectRoot, '.gitignore');
  const current = fs.existsSync(ignorePath) ? fs.readFileSync(ignorePath, 'utf8') : '';
  if (current.split('\n').some((entry) => entry.trim() === line)) return;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(ignorePath, `${current}${separator}${line}\n`);
}

function writeSeen(content, seen) {
  fs.mkdirSync(content.viewportDir, { recursive: true });
  fs.writeFileSync(readStatePath(content.viewportDir), `${JSON.stringify({ seen: [...seen].sort() }, null, 2)}\n`);
  ensureGitignored(content.projectRoot, content.viewportDir);
}

function authorOf(comment) {
  return comment.by || 'user';
}

function formatComment(comment, { isNew }) {
  const marks = [isNew ? 'NEW' : '   ', comment.resolved ? 'resolved' : null].filter(Boolean).join(' ');
  const [first, ...more] = String(comment.text).split('\n');
  const head = `  ${marks.padEnd(12)} ${comment.at}  ${authorOf(comment)}  [${comment.id}]  ${first}`;
  return [head, ...more.map((line) => `${' '.repeat(16)}${line}`)].join('\n');
}

function isUnseen(comment, seen) {
  return comment?.id && !seen.has(comment.id) && authorOf(comment) !== AGENT;
}

export function renderThreads(data, seen, { all }) {
  const blocks = [];
  const shown = [];
  for (const [board, list] of Object.entries(data)) {
    if (!Array.isArray(list)) continue;
    const fresh = list.filter((comment) => isUnseen(comment, seen));
    if (!all && !fresh.length) continue;
    const thread = [...list].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const freshIds = new Set(fresh.map((comment) => comment.id));
    blocks.push([`${board}  (${list.length} in thread, ${fresh.length} new)`, ...thread.map((comment) => formatComment(comment, { isNew: freshIds.has(comment.id) }))].join('\n'));
    shown.push(...fresh.map((comment) => comment.id));
  }
  return { text: blocks.join('\n\n'), shown };
}

export async function runComments(content, rest) {
  const request = parseCommentsArgs(rest);
  const file = path.join(content.viewportDir, 'comments.json');
  if (request.action === 'reply') {
    const data = await readJsonObject(file);
    const comment = addComment(data, { artboardId: request.board, text: request.tail.join(' '), by: AGENT });
    await writeJsonObject(file, data);
    console.log(`Replied on ${request.board} [${comment.id}]`);
    return;
  }
  if (request.action === 'resolve') {
    const data = await readJsonObject(file);
    updateComment(data, { artboardId: request.board, id: request.tail[0], resolved: true });
    await writeJsonObject(file, data);
    console.log(`Resolved ${request.tail[0]} on ${request.board}`);
    return;
  }
  const data = await readJsonObject(file);
  const seen = readSeen(content.viewportDir);
  const { text, shown } = renderThreads(data, seen, request);
  if (text) console.log(text);
  if (request.peek || request.all || !shown.length) return;
  shown.forEach((id) => seen.add(id));
  writeSeen(content, seen);
}
