---
name: viewport
description: Design and review UI mockups as live code on the Viewport canvas (the project's viewport/ folder). Use when building screens or components to show the user, preparing design options for them to pick, or acting on artboard ids they paste.
---

# Viewport

Viewport renders `viewport/artboards/**/*.artboard.js` as cards on an infinite canvas, one page at a time. The user judges mockups there, switches pages and groups in the sidebar, and gives feedback by copying a card's id. This is guidance, not a framework: bend it to the project.

- `npx viewport`: dev server with HMR, for you while you work.
- `npx viewport build`: static review build in `viewport/dist/` with `build.json`.
- `npx viewport preview --host 0.0.0.0`: serves that build to a phone or over a tailnet. Any static file server works too.

## Files

```txt
viewport/
  artboards/          one file per card; top-level folders are pages, subfolders are groups
  design-system/      tokens.css, primitives, modules, composites; index.js exports el()
viewport.config.js    layers, storage namespace
```

## Artboard

```js
import { Button } from '#design-system/button.js';

export const meta = { title: 'Checkout: option B', layer: 'composite', group: 'Checkout round 2' };

export default function render() {
  return Button({ children: 'Pay' });
}
```

- `render()` returns one DOM element.
- `meta.layer` is one of the configured layers (`primitive`, `module`, `composite` by default).
- **One page per focus area.** Each top-level folder under `artboards/` is a page (`artboards/checkout/…` is the page `checkout`); `meta.page` overrides it. Only the selected page is mounted, so pages keep a big project fast; never put every area on one page. Link the user to a page with its hash: `http://<host>:<port>/#checkout`.
- `meta.group` puts the card in a sidebar group inside its page. Without it, the folder under `artboards/` is the group. Use groups to separate what the user should look at now from everything else; the user clicks a group name to see only that group.
- `meta.id` overrides the id. Avoid it unless a file must move without breaking its id.
- `#design-system/...` resolves to `viewport/design-system/` from any folder depth.

## Ids and feedback

Every card shows its id; clicking the card title or the id copies it, shift-click copies several. The id is the file path under `viewport/artboards/` without `.artboard.js`:

`checkout/option-b` → `viewport/artboards/checkout/option-b.artboard.js`

If no file matches, the id came from `meta.id`: `grep -rn "id: 'checkout-b'" viewport/artboards`. Feedback such as "checkout/option-b: tighter rows" refers to exactly that file. Name files so ids read well (`option-a`, not `v3-final`).

## Comments

The user comments on cards in the canvas; the comments land in `viewport/comments.json`, keyed by artboard id: `{ id, text, at, resolved }`. Read it at the start of each iteration.

- Open comments (`resolved: false`) are feedback on that card's file (the id maps to the file as above).
- After acting on one, set `resolved: true`. To answer, append `{ "id": "<unique>", "text": "...", "at": "<ISO time>", "resolved": false, "by": "agent" }` to the same list, for example when you need a decision or want to say what changed.
- Edit the file as JSON and keep it valid; the servers refuse to write over a broken file. Never delete the user's comments.

## Layers

Build bottom up: primitive (Button) → module (Toolbar) → composite (EditorShell). Modules and composites import and call primitives; they never re-create their markup. Change a primitive and every card using it updates.

## A design round

1. **Research first.** Before designing, look at how established products solve the same problem and say what you borrow. If a direction is not working, change the approach; do not keep iterating on it.
2. **One area per round.** Show the current state plus 3 distinct options (different ideas, not three tweaks of one). The user picks, then the next round starts.
3. **A Decisions artboard per round.** It lists each open question, your recommendation with a one-line reason, and the option ids (`checkout/option-a` …).
4. **Only the current round on each page.** The round lives on its area's page. When a round is decided, delete its option files from `viewport/` (git keeps them), and keep only the current state and locked pieces on that page. No archive folders.
5. **Judge in context.** Show options inside the real surrounding layout (the actual screen with its neighbours), not on isolated sheets. Example: a mixer channel option shown inside the full mixer, not alone.
6. **Low-fi first.** For workflow and layout questions use grey boxes and labels. Add visual detail once the direction is set.
7. **Record picks** in a project doc (for example `docs/ui-picks.md`): date, question, picked id, why.

## Locked pieces

- A picked piece is **locked** by moving it into `viewport/design-system/`. That is the only meaning of "locked".
- Every later mockup imports it from there and uses it exactly. Never copy it into an artboard or a second file.
- A needed variation becomes a prop on the locked piece, not a fork.
- Before writing markup, check `design-system/` for an existing piece.

## Style

- Colours, spacing, radii, type and motion live as tokens in one place (`design-system/tokens.css`). No literals in components.
- Not everything is rounded; corners depend on what sits next to them. A round pill draws attention, so use it only where the importance justifies it.

## Verify before you hand off

- Check headless: take screenshots and assert that nothing overlaps or clips (text overflow, elements outside their container). Look at the screenshots before claiming anything.
- Build, then prove what is served. HTTP 200 is not proof; the hash is:

```bash
npx viewport build
curl -s "$URL/build.json" | grep -q "\"hash\": \"$(node -p "require('./viewport/dist/build.json').hash")\"" && echo live
```

- The sidebar footer shows the same stamp (`build abc1234+ · 10-20 16:42 · 9f3c1a2b`; `+` means uncommitted changes). Quote it and the option ids when you report.

The user, not you, makes the visual judgement.
