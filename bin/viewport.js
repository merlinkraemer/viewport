#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, createServer, normalizePath, preview } from 'vite';
import { createCommentsMiddleware } from './comments-api.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_URL = '/@viewport/entry.js';
const VIRTUAL_ENTRY_ID = '\0viewport-host-entry';

function usage() {
  return `viewport

Usage:
  viewport [--port 5182] [--host 127.0.0.1] [--no-open]   dev server with HMR
  viewport init                                          scaffold viewport/ in this project
  viewport build [--out viewport/dist]                   static review build + build.json
  viewport preview [--port 4182] [--host 0.0.0.0]        serve the review build
`;
}

function parseArgs(argv) {
  const args = { command: 'dev', open: true, host: undefined, port: undefined, out: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (['init', 'build', 'preview'].includes(arg)) args.command = arg;
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--no-open') args.open = false;
    else if (arg === '--host') args.host = argv[++i];
    else if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '-h' || arg === '--help') args.command = 'help';
    else throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
  args.port ??= args.command === 'preview' ? 4182 : 5182;
  if (!Number.isFinite(args.port)) throw new Error('--port must be a number');
  return args;
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function listArtboards(dir) {
  if (!exists(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.artboard.js')) out.push(fullPath);
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

function fsImport(filePath) {
  return `/@fs/${normalizePath(path.resolve(filePath))}`;
}

function resolveContentRoot(cwd) {
  const projectViewport = path.join(cwd, 'viewport');
  if (exists(projectViewport)) {
    return {
      mode: 'project',
      projectRoot: cwd,
      viewportDir: projectViewport,
      artboardsDir: path.join(projectViewport, 'artboards'),
      designSystemIndex: path.join(projectViewport, 'design-system', 'index.js'),
      configPath: path.join(cwd, 'viewport.config.js'),
      artboardImportPrefix: '/viewport/artboards/',
      artboardGlob: '/viewport/artboards/**/*.artboard.js',
      designSystemImport: '/viewport/design-system/index.js',
      distDir: path.join(projectViewport, 'dist'),
      configImport: exists(path.join(cwd, 'viewport.config.js')) ? '/viewport.config.js' : null,
      fallbackConfig: {},
    };
  }

  const repoArtboards = path.join(packageRoot, 'src', 'artboards');
  if (cwd === packageRoot && exists(repoArtboards)) {
    return {
      mode: 'repo',
      projectRoot: packageRoot,
      viewportDir: path.join(packageRoot, 'src'),
      artboardsDir: repoArtboards,
      designSystemIndex: path.join(packageRoot, 'src', 'design-system', 'index.js'),
      configPath: null,
      artboardImportPrefix: '/src/artboards/',
      artboardGlob: '/src/artboards/**/*.artboard.js',
      designSystemImport: '/src/design-system/index.js',
      distDir: path.join(packageRoot, 'dist'),
      configImport: null,
      fallbackConfig: {
        storageNamespace: 'viewport',
        defaultProjectName: 'fourfour',
        layers: [
          { key: 'primitive', label: 'Primitives' },
          { key: 'module', label: 'Modules' },
          { key: 'composite', label: 'Composites' },
        ],
      },
    };
  }

  throw new Error(`No viewport/ folder found in ${cwd}. Run "viewport init" first.`);
}

function rootImportPath(root, filePath) {
  return `/${normalizePath(path.relative(root, filePath))}`;
}

function createVirtualEntry(content, buildInfo) {
  const artboards = listArtboards(content.artboardsDir);
  if (!exists(content.designSystemIndex)) {
    throw new Error(`Missing design-system entry: ${content.designSystemIndex}`);
  }

  const hotDeps = artboards.map((filePath) => `'${rootImportPath(content.projectRoot, filePath)}'`).join(', ');
  const hotAcceptCode = artboards.length ? `
if (import.meta.hot) {
  import.meta.hot.accept([${hotDeps}], (updatedModules) => {
    const changedIds = [];
    updatedModules.forEach((mod, index) => {
      if (!mod) return;
      const path = modulePaths[index];
      modules[path] = mod;
      changedIds.push(registryEntry(path, mod).id);
    });
    app.updateRegistry(createRegistry(modules), { changedIds });
  });
}
` : '';
  const configCode = content.configImport
    ? `import projectConfig from '${content.configImport}';\nconst config = projectConfig || {};`
    : `const config = ${JSON.stringify(content.fallbackConfig, null, 2)};`;

  return `
import '${content.designSystemImport}';
import { createViewport } from '${fsImport(path.join(packageRoot, 'src', 'engine', 'index.js'))}';
${configCode}

let modules = { ...import.meta.glob('${content.artboardGlob}', { eager: true }) };
const modulePaths = [${hotDeps}];

function registryEntry(path, mod) {
  const file = path.replace('${content.artboardImportPrefix}', '');
  const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : null;
  const id = mod.meta?.id ?? file.replace(/\\.artboard\\.js$/, '');
  return {
    id,
    file,
    page: mod.meta?.page ?? (file.includes('/') ? file.slice(0, file.indexOf('/')) : null),
    group: mod.meta?.group ?? folder,
    order: mod.meta?.order,
    question: mod.meta?.question,
    sourceTitle: mod.meta?.title ?? id,
    layer: mod.meta?.layer ?? 'primitive',
    render: mod.default,
  };
}

function createRegistry(sourceModules) {
  return Object.entries(sourceModules).map(([path, mod]) => registryEntry(path, mod));
}

const app = createViewport({
  mount: document.getElementById('viewport'),
  registry: createRegistry(modules),
  build: ${JSON.stringify(buildInfo)},
  storageNamespace: config.storageNamespace ?? 'viewport',
  defaultProjectName: config.defaultProjectName ?? 'Default',
  layers: config.layers ?? [
    { key: 'primitive', label: 'Primitives' },
    { key: 'module', label: 'Modules' },
    { key: 'composite', label: 'Composites' },
  ],
});
window.__viewportApp = app;
${hotAcceptCode}
`;
}

function hostHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Viewport</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="viewport"></div>
    <script type="module" src="${ENTRY_URL}"></script>
  </body>
</html>`;
}

function viewportVitePlugin(content, { buildInfo = null, htmlEntry = null } = {}) {
  return {
    name: 'viewport-host',
    resolveId(id) {
      if (id === ENTRY_URL) return VIRTUAL_ENTRY_ID;
      if (htmlEntry && id === htmlEntry) return htmlEntry;
      return null;
    },
    load(id) {
      if (id === VIRTUAL_ENTRY_ID) return createVirtualEntry(content, buildInfo);
      if (htmlEntry && id === htmlEntry) return hostHtml();
      return null;
    },
    configureServer(server) {
      server.watcher.add(content.viewportDir);
      server.middlewares.use(createCommentsMiddleware(commentsPath(content)));
      server.watcher.on('change', (filePath) => {
        if (path.resolve(filePath) === commentsPath(content)) server.ws.send({ type: 'custom', event: 'viewport:comments' });
      });
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '/';
        if (req.method !== 'GET' || (url !== '/' && !url.startsWith('/?'))) {
          next();
          return;
        }
        const html = await server.transformIndexHtml(url, hostHtml());
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      });
      server.watcher.on('add', (filePath) => {
        if (filePath.endsWith('.artboard.js')) server.ws.send({ type: 'full-reload' });
      });
      server.watcher.on('unlink', (filePath) => {
        if (filePath.endsWith('.artboard.js')) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

function commentsPath(content) {
  return path.join(content.viewportDir, 'comments.json');
}

function commentsPreviewPlugin(content) {
  return {
    name: 'viewport-comments',
    configurePreviewServer(server) {
      server.middlewares.use(createCommentsMiddleware(commentsPath(content)));
    },
  };
}

async function loadProjectVitePlugins(cwd) {
  const vitePath = path.join(cwd, 'viewport.vite.js');
  if (!exists(vitePath)) return [];
  const mod = await import(pathToFileURL(vitePath).href);
  const cfg = mod.default ?? mod;
  return Array.isArray(cfg.plugins) ? cfg.plugins : [];
}

function designSystemAlias(content) {
  return { '#design-system': path.dirname(content.designSystemIndex) };
}

async function runDev(args) {
  const cwd = process.cwd();
  const content = resolveContentRoot(cwd);
  const extraPlugins = await loadProjectVitePlugins(cwd);
  const server = await createServer({
    root: content.projectRoot,
    configFile: false,
    appType: 'custom',
    plugins: [viewportVitePlugin(content), ...extraPlugins],
    resolve: { alias: designSystemAlias(content) },
    server: {
      host: args.host,
      port: args.port,
      open: args.open,
      fs: {
        allow: [packageRoot, content.projectRoot],
      },
    },
  });
  await server.listen();
  server.printUrls();
}

function git(cwd, gitArgs) {
  try {
    return execFileSync('git', gitArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function listFiles(dir, skipDirs) {
  if (!exists(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.includes(fullPath) && entry.name !== 'node_modules') out.push(...listFiles(fullPath, skipDirs));
    } else if (entry.isFile()) out.push(fullPath);
  }
  return out;
}

function contentHash(content, outDir) {
  const files = [
    ...listFiles(content.viewportDir, [outDir]).filter((file) => file !== commentsPath(content)),
    ...listFiles(path.join(packageRoot, 'src', 'engine'), []),
    ...[content.configPath, path.join(content.projectRoot, 'viewport.vite.js')].filter((file) => file && exists(file)),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(content.projectRoot, file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 8);
}

function hashedInputPaths(content) {
  const root = content.projectRoot;
  return [
    content.viewportDir,
    path.join(packageRoot, 'src', 'engine'),
    content.configPath,
    path.join(root, 'viewport.vite.js'),
  ]
    .filter(Boolean)
    .map((file) => normalizePath(path.relative(root, file)))
    .filter((rel) => !rel.startsWith('..'));
}

function createBuildInfo(content, outDir) {
  const root = content.projectRoot;
  const relOut = normalizePath(path.relative(root, outDir));
  const relComments = normalizePath(path.relative(root, commentsPath(content)));
  const status = git(root, ['status', '--porcelain', '--', ...hashedInputPaths(content), `:(exclude)${relOut}`, `:(exclude)${relComments}`]);
  return {
    sha: git(root, ['rev-parse', '--short', 'HEAD']),
    dirty: status === null ? null : status.length > 0,
    builtAt: new Date().toISOString(),
    hash: contentHash(content, outDir),
  };
}

async function runBuild(args) {
  const cwd = process.cwd();
  const content = resolveContentRoot(cwd);
  const outDir = args.out ? path.resolve(cwd, args.out) : content.distDir;
  const buildInfo = createBuildInfo(content, outDir);
  const htmlEntry = path.join(content.projectRoot, 'index.html');
  const extraPlugins = await loadProjectVitePlugins(cwd);
  await build({
    root: content.projectRoot,
    configFile: false,
    base: './',
    logLevel: 'warn',
    plugins: [viewportVitePlugin(content, { buildInfo, htmlEntry }), ...extraPlugins],
    resolve: { alias: designSystemAlias(content) },
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: { input: htmlEntry },
    },
  });
  fs.writeFileSync(path.join(outDir, 'build.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);
  const sha = `${buildInfo.sha ?? 'no-git'}${buildInfo.dirty ? '+' : ''}`;
  console.log(`Built ${path.relative(cwd, outDir) || '.'}  build ${sha}  hash ${buildInfo.hash}`);
}

async function runPreview(args) {
  const cwd = process.cwd();
  const content = resolveContentRoot(cwd);
  const outDir = args.out ? path.resolve(cwd, args.out) : content.distDir;
  if (!exists(path.join(outDir, 'build.json'))) {
    throw new Error(`No review build in ${outDir}. Run "viewport build" first.`);
  }
  const server = await preview({
    root: content.projectRoot,
    configFile: false,
    build: { outDir },
    plugins: [commentsPreviewPlugin(content)],
    preview: { host: args.host, port: args.port, open: args.open, strictPort: true },
  });
  server.printUrls();
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  }
}

function updatePackageJson(cwd) {
  const packagePath = path.join(cwd, 'package.json');
  const pkg = exists(packagePath)
    ? JSON.parse(fs.readFileSync(packagePath, 'utf8'))
    : { private: true, scripts: {} };
  pkg.scripts = pkg.scripts || {};
  if (!pkg.scripts.viewport) pkg.scripts.viewport = 'viewport';
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function ignoreReviewBuild(cwd) {
  const ignorePath = path.join(cwd, '.gitignore');
  const line = 'viewport/dist/';
  const current = exists(ignorePath) ? fs.readFileSync(ignorePath, 'utf8') : '';
  if (current.split('\n').some((entry) => entry.trim() === line)) return;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(ignorePath, `${current}${separator}${line}\n`);
}

function runInit() {
  const cwd = process.cwd();
  const viewportDir = path.join(cwd, 'viewport');
  const configPath = path.join(cwd, 'viewport.config.js');
  const skillPath = path.join(cwd, '.claude', 'skills', 'viewport', 'SKILL.md');
  for (const target of [viewportDir, configPath, skillPath]) {
    if (exists(target)) throw new Error(`Refusing to overwrite existing ${target}`);
  }

  copyDir(path.join(packageRoot, 'templates', 'viewport'), viewportDir);
  fs.copyFileSync(path.join(packageRoot, 'templates', 'viewport.config.js'), configPath);
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.copyFileSync(path.join(packageRoot, 'templates', 'skills', 'viewport', 'SKILL.md'), skillPath);
  updatePackageJson(cwd);
  ignoreReviewBuild(cwd);
  console.log(`Created viewport/ scaffold, viewport.config.js, agent skill .claude/skills/viewport/SKILL.md,
package.json script "viewport" and .gitignore entry viewport/dist/.

Next: npx viewport`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') {
    console.log(usage());
    return;
  }
  if (args.command === 'init') {
    runInit();
    return;
  }
  if (args.command === 'build') {
    await runBuild(args);
    return;
  }
  if (args.command === 'preview') {
    await runPreview(args);
    return;
  }
  await runDev(args);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
