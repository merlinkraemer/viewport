#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, normalizePath } from 'vite';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_URL = '/@viewport/entry.js';
const VIRTUAL_ENTRY_ID = '\0viewport-host-entry';

function usage() {
  return `viewport

Usage:
  viewport [--port 5182] [--host 127.0.0.1] [--no-open]
  viewport init
`;
}

function parseArgs(argv) {
  const args = { command: 'dev', open: true, host: undefined, port: 5182 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === 'init') args.command = 'init';
    else if (arg === '--no-open') args.open = false;
    else if (arg === '--host') args.host = argv[++i];
    else if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '-h' || arg === '--help') args.command = 'help';
    else throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
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

function createVirtualEntry(content) {
  const artboards = listArtboards(content.artboardsDir);
  if (!artboards.length) {
    throw new Error(`No *.artboard.js files found in ${content.artboardsDir}`);
  }
  if (!exists(content.designSystemIndex)) {
    throw new Error(`Missing design-system entry: ${content.designSystemIndex}`);
  }

  const hotDeps = artboards.map((filePath) => `'${rootImportPath(content.projectRoot, filePath)}'`).join(', ');
  const configCode = content.configImport
    ? `import projectConfig from '${content.configImport}';\nconst config = projectConfig || {};`
    : `const config = ${JSON.stringify(content.fallbackConfig, null, 2)};`;

  return `
import '${content.designSystemImport}';
import { createViewport } from '${fsImport(path.join(packageRoot, 'src', 'engine', 'index.js'))}';
${configCode}

let modules = { ...import.meta.glob('${content.artboardGlob}', { eager: true }) };
const modulePaths = [${hotDeps}];

function artboardId(path) {
  return path
    .replace('${content.artboardImportPrefix}', '')
    .replace(/\\.artboard\\.js$/, '');
}

function createRegistry(sourceModules) {
  return Object.entries(sourceModules).map(([path, mod]) => {
    const id = artboardId(path);
    return {
      id,
      sourceTitle: mod.meta?.title ?? id,
      layer: mod.meta?.layer ?? 'primitive',
      render: mod.default,
    };
  });
}

const app = createViewport({
  mount: document.getElementById('viewport'),
  registry: createRegistry(modules),
  storageNamespace: config.storageNamespace ?? 'viewport',
  defaultProjectName: config.defaultProjectName ?? 'Default',
  layers: config.layers ?? [
    { key: 'primitive', label: 'Primitives' },
    { key: 'module', label: 'Modules' },
    { key: 'composite', label: 'Composites' },
  ],
});
window.__viewportApp = app;

if (import.meta.hot) {
  import.meta.hot.accept([${hotDeps}], (updatedModules) => {
    const changedIds = [];
    updatedModules.forEach((mod, index) => {
      if (!mod) return;
      const path = modulePaths[index];
      modules[path] = mod;
      changedIds.push(artboardId(path));
    });
    app.updateRegistry(createRegistry(modules), { changedIds });
  });
}
`;
}

function viewportVitePlugin(content) {
  return {
    name: 'viewport-host',
    resolveId(id) {
      if (id === ENTRY_URL) return VIRTUAL_ENTRY_ID;
      return null;
    },
    load(id) {
      if (id === VIRTUAL_ENTRY_ID) return createVirtualEntry(content);
      return null;
    },
    configureServer(server) {
      server.watcher.add(content.viewportDir);
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '/';
        if (req.method !== 'GET' || (url !== '/' && !url.startsWith('/?'))) {
          next();
          return;
        }
        const html = await server.transformIndexHtml(url, `<!doctype html>
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
</html>`);
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

async function runDev(args) {
  const cwd = process.cwd();
  const content = resolveContentRoot(cwd);
  const server = await createServer({
    root: content.projectRoot,
    configFile: false,
    appType: 'custom',
    plugins: [viewportVitePlugin(content)],
    resolve: {
      alias: {
        '#design-system': path.dirname(content.designSystemIndex),
      },
    },
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

function runInit() {
  const cwd = process.cwd();
  const viewportDir = path.join(cwd, 'viewport');
  const configPath = path.join(cwd, 'viewport.config.js');
  if (exists(viewportDir)) throw new Error(`Refusing to overwrite existing ${viewportDir}`);
  if (exists(configPath)) throw new Error(`Refusing to overwrite existing ${configPath}`);

  copyDir(path.join(packageRoot, 'templates', 'viewport'), viewportDir);
  fs.copyFileSync(path.join(packageRoot, 'templates', 'viewport.config.js'), configPath);
  updatePackageJson(cwd);
  console.log('Created viewport/ scaffold and added package.json script "viewport".');
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
  await runDev(args);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
