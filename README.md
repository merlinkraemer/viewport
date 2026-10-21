<img width="526" height="410" alt="image" src="https://github.com/user-attachments/assets/754e8b06-4080-4bd2-980e-2b51f00d285d" />

# Viewport

Viewport is a tiny npm dev tool for prototyping UI on an infinite canvas.

It visualizes a simple modular UI philosophy:

```txt
primitives → modules → composites
```

Think Figma, but the mockups are already code.

Viewport is agent-first: not an editor, just the render engine. Projects own their artboards and design system; Viewport renders them as draggable DOM cards with persisted layout, camera state, and HMR. The agent builds mockups, the user judges them on the canvas and hands back feedback by artboard id.

## Quickstart

The npm name `viewport` belongs to another package, so install from GitHub or a local checkout:

```bash
npm install -D github:merlinkraemer/viewport   # or: npm install -D /path/to/viewport
npx viewport init
npx viewport
```

`init` creates `viewport/`, `viewport.config.js`, the agent skill at `.claude/skills/viewport/SKILL.md`, a `viewport` script in `package.json`, and a `viewport/dist/` line in `.gitignore`. It stops without changes if `viewport/`, `viewport.config.js` or the skill file already exists.

## Agent skill

`init` installs the authoring skill at `.claude/skills/viewport/SKILL.md`, where Claude Code picks it up with no extra step. Other agents can be pointed at the same file. It covers the artboard shape, ids, design rounds (current state + 3 options, a Decisions artboard, only the current round on the canvas), locked pieces in `design-system/`, and how to verify a build.

## Project structure

```txt
viewport/
  artboards/        *.artboard.js, folders allowed
  design-system/    tokens, primitives, modules, composites
viewport.config.js
.claude/skills/viewport/SKILL.md
```

## Artboard

```js
import { Button } from '#design-system/button.js';

export const meta = { title: 'Button', layer: 'primitive', group: 'Controls' };

export default function render() {
  return Button({ children: 'Save' });
}
```

Every artboard exports `meta` and a default `render()` that returns one DOM element. `#design-system` resolves to `viewport/design-system/`.

| `meta` field | meaning |
|---|---|
| `title` | card title |
| `layer` | one of the configured layers (`primitive`, `module`, `composite`) |
| `page` | page the card lives on; defaults to the top-level folder under `artboards/` |
| `group` | sidebar group inside the page; defaults to the artboard's folder |
| `order` | optional number; reading order in the group, and the group's place on the page (lowest first) |
| `id` | optional id override; defaults to the file path |

## Feedback by id

Every card shows its id under the title. Click the title or the id to copy it; shift-click several cards to copy a list (Esc clears the selection). Dragging the title still moves the card. The user pastes ids into the chat, and the agent finds the file from the id:

```txt
checkout/option-b  →  viewport/artboards/checkout/option-b.artboard.js
```

An id set with `meta.id` is found with `grep -rn "id: '<id>'" viewport/artboards`. The copy button in the sidebar copies the same id; shift-click there adds name and file.

## Comments

Each card header has a comment button with a count of open comments. It opens a small thread: add a comment (⌘/Ctrl+Enter), edit one, resolve or reopen it. The sidebar's comment button opens the same thread.

Comments live in `viewport/comments.json`, a file the agent reads and edits, keyed by artboard id:

```json
{
  "checkout/option-b": [
    { "id": "c-mvho97zf-64c076", "text": "Tighter rows", "at": "2026-10-21T05:28:48.555Z", "resolved": false },
    { "id": "c-mvhoa1b2-a1b2c3", "text": "Done: rows at 8px", "at": "2026-10-21T06:02:10.000Z", "resolved": false, "by": "agent" }
  ]
}
```

Both `npx viewport` and `npx viewport preview` serve `GET`/`POST`/`PATCH` on `__viewport/comments`, so a review build on a phone saves comments too. Each write rereads the file, so edits an agent made in between survive, and replaces it atomically. A file with broken JSON is never overwritten; the server answers 409 until it is fixed. Another static server shows comments read-only. In dev, an agent's edit to the file shows up live. Comments are not part of the build hash. Notes from older versions, kept in the browser, move into the file on the first load with a server.

## Pages

A page is one focus area of the project, such as `checkout` or `settings`. Each top-level folder under `artboards/` is a page; `meta.page` puts a card on another page. Cards at the root of `artboards/` land on "Other".

The sidebar is one tree: page → group → artboard, every node collapsed until opened. Click a page name to select it and expand it; the chevron only folds. Selecting a page mounts only that page's cards: the others are removed from the DOM, so their animations and listeners stop and a large project stays fast. Clicking an artboard on another page selects that page first. Expanded nodes are saved with the rest of the UI state. The page is the first segment of the URL hash (`#checkout`), so a link opens and expands that page; anything after it (`#checkout/option-b?step=2`) is left to the artboards. Each page keeps its own camera. With a single page its groups are the top level and every card is mounted.

## Groups

Inside a page, the tree lists its groups when there is more than one: `meta.group`, else the folder under `artboards/`, else the classic Primitives / Artboards split. Pages and groups show their artboard count. Click a group name to show only that group on the canvas and zoom to it; click it again or "show all" to return. Click an artboard to zoom to it. The chevron folds a group.

## Layout

Each page lays itself out for review. Groups stack top to bottom, each in one band headed by its title and card count. Inside a group the order is `meta.order`, then file order, and every card shows its number (1, 2, 3 …). The cards run as one left-to-right row, top-aligned with even gaps, that wraps at 2400 px. A group whose widest card is 1200 px or wider, or more than three times its narrowest, runs as a single column instead. Cards relayout as they measure, so nothing overlaps. A card you drag keeps its spot; the others flow around it.

## Review build

```bash
npx viewport build                    # static build in viewport/dist/ (--out <dir> to change)
npx viewport preview --host 0.0.0.0   # serve it on port 4182, e.g. over a tailnet or to a phone
```

The build uses relative asset paths, so any static file server works. No dev server is needed to look at it.

The sidebar footer shows the build stamp: `build abc1234+ · 10-20 16:42 · 9f3c1a2b` (git sha, `+` for uncommitted changes, build time, content hash). `viewport/dist/build.json` holds the same data:

```json
{ "sha": "abc1234", "dirty": true, "builtAt": "2026-10-20T16:42:00.000Z", "hash": "9f3c1a2b" }
```

The hash covers `viewport/`, the config and the Viewport engine, so it changes whenever the content does. To prove which build is served, compare hashes; HTTP 200 alone proves nothing:

```bash
curl -s http://host:4182/build.json
```

## Workflow

```txt
primitive  → Button
module     → Toolbar
composite  → EditorShell
```

Edit a primitive and every artboard using it updates live while the canvas keeps pan, zoom, and card positions.

## Authoring

Use tokens and CSS variables. Reuse primitives inside modules and composites; a picked piece moves into `design-system/` and is imported, never copied. Keep project content inside `viewport/`.

A project can add `viewport.vite.js` exporting `{ plugins: [...] }` (for example the Svelte plugin) to teach Viewport new file types. It stays separate from `viewport.config.js`, which runs in the browser.

<img width="2880" height="1770" alt="image" src="https://github.com/user-attachments/assets/444f66a0-77f1-469c-93cb-4f4176ee607c" />
