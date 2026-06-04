# Viewport Package + Skill Todo

## Public Repo Prep

- [x] Remove obsolete Tauri files and dependencies.
- [x] Add a public-safe `.gitignore`.
- [x] Replace README with a concise package/install note.
- [x] Scan tracked and untracked project files for likely secrets.
- [x] Run headless checks.
- [x] Commit, create public GitHub repo, and push.

### Review

- Removed Tauri files/dependencies.
- README is the concise package/install version.
- Secret scan found only benign token/design wording; no env/key files.
- Checks: `node --check bin/viewport.js`, `npm run build`, `npm pack --dry-run`, scaffold render smoke.

## Plan

- [ ] s1: Persist and restore camera `{ x, y, scale }` with the existing storage namespace.
- [ ] s2: Add surgical HMR so changed artboard modules refresh their cards without a full reload.
- [ ] s3: Expose the engine package entry and add a `viewport` CLI that boots Vite.
- [ ] s4: Serve project-owned `viewport/` content from an external working directory.
- [ ] s5: Add `viewport init` scaffold with blank design-system, example artboard, and dev script.
- [ ] s6: Add authoring `SKILL.md` for primitive -> module -> composite composition.
- [ ] Verification: Build, run local CLI, run scaffold in a throwaway project, and browser-check the canvas.

## Review

- Pending.
