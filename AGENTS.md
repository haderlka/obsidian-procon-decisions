# AGENTS.md

Guidance for AI coding agents (and humans) working on **Pro-Con Decisions**, an Obsidian community plugin.

- Repo: https://github.com/haderlka/obsidian-procon-decisions (author `haderlka`, default branch `main`)
- Donations: `fundingUrl` in `manifest.json` → https://buymeacoffee.com/haderlka. Keep links out of the manifest `description`; the review wants a plain one-line description.
- README images and links are **absolute** GitHub URLs, so they also work in Obsidian's plugin browser, which renders the README outside GitHub. Images come from `raw.githubusercontent.com/.../main/docs/`.
- **Host every README image in `docs/`.** The Obsidian community site (community.obsidian.md) silently dropped the Buy Me a Coffee button while it was loaded from `cdn.buymeacoffee.com`. Images from `raw.githubusercontent.com` render fine, in Markdown and HTML `<img>` alike. `docs/buymeacoffee.png` is the official button scaled to 42px height.

## What it does

A `procon` fenced code block contains a Markdown table of weighted pro/con arguments. The plugin renders the block as interactive cards (two columns plus a result bar). All editing happens in the rendered view and is written back into the table.

````markdown
```procon
| Side | Argument    | Weight |
| ---- | ----------- | ------ |
| pro  | Good reason | 4      |
| con  | Bad reason  | 2      |
```
````

## Commands

| Command | Purpose |
| ------- | ------- |
| `npm ci` | Install dependencies |
| `npm run dev` | esbuild watch → `main.js` |
| `npm run build` | `tsc` type-check + production bundle |
| `npm run lint` | ESLint with `eslint-plugin-obsidianmd`, the rules the official review uses. **Must be clean before a release.** |
| `npm test` | `node:test` unit tests in `tests/`. Node ≥ 22.18 runs `.ts` directly, so tests import `../src/model.ts` with the extension. |
| `npm run screenshots` | Regenerates the README images in `docs/` (see "Testing UI changes without Obsidian"). Run it after any visual change. |

Run `lint`, `test` and `build` after every change.

**Git is the user's job.** Agents must not run git commands that change the repository: no `commit`, `push`, `tag`, `merge`, `rebase`, `reset`, `checkout`/`switch`, `stash`, `add` and so on. This also rules out `npm version`, which commits and tags. Read-only commands (`status`, `diff`, `log`, `show`, `ls-remote`) are fine. When a change is ready, tell the user which commands to run.

## Layout

```
src/model.ts     Pure logic, no Obsidian imports: parse, serialize, tally, verdictOf, diffEntries
src/main.ts      Plugin, DecisionRenderer (MarkdownRenderChild), writeBlock, settings tab
styles.css       All styling. Colored design first, the "Plain" overrides at the end
tests/           Unit tests for model.ts
tools/screenshots/  Screenshot tool: Obsidian API shim + note-like page + headless-browser script
docs/            README screenshots (generated, committed)
manifest.json    id "procon-decisions". Keep version in sync via `npm version`
versions.json    plugin version → minAppVersion
.github/workflows  ci.yml (lint/test/build), release.yml (tag → attested draft release)
```

Keep `model.ts` free of Obsidian and DOM dependencies so it stays unit-testable.

## Architecture and non-obvious decisions

- **Data format.** A code block (not a bare table) was chosen because it's the only reliable way to render custom, interactive UI in *both* Live Preview and Reading view via `registerMarkdownCodeBlockProcessor`. The content is still a plain Markdown table.
- **Parsing is lenient.** Side accepts `pro/+/yes/for` and `con/contra/-/no/against`. Weight accepts numbers or runs of symbols (`★★★`). Words in the weight column must *not* count as symbols; that was an actual bug. Rows with unknown sides (such as the header) are skipped.
- **Title line.** An optional `#…` or `title:` line is parsed and preserved on write, including its heading level, but **not rendered**. The user explicitly didn't want a heading in the card.
- **Writing back** (`writeBlock` in `main.ts`):
  - `ctx.getSectionInfo(el)` gives the fence lines. Always verify that `lineStart` matches the opening ```` ```procon ```` fence and `lineEnd` a closing fence before writing. Otherwise abort and show a notice.
  - If a MarkdownView in *source/Live Preview* mode has the file open, use `editor.replaceRange`, which keeps undo history and cursor. Otherwise use `vault.process` and preserve the file's line endings (`\r\n` vs `\n`).
  - If `getSectionInfo` returns null (for example inside an embed), the block renders **read-only** (`is-readonly`).
- **Re-render model.** Every write makes Obsidian destroy and re-create the block. So:
  - Animations of *what changed* use a module-level `memory` map (key: `sourcePath::lineStart`) holding the previous entries and tally. `diffEntries` classifies each entry as `new`/`changed`/`moved`.
  - Focus after adding an entry is restored through `focusHints`, so the user can keep typing.
  - Transitions (bar width, count-up numbers) start from the previous values. `whenConnected()` waits until the element is in the DOM before changing values, because the processor runs before the element is attached and a transition would not fire.
  - Removal animates *before* writing (`is-removing`, then commit after 260 ms).
- **Live Preview event isolation.** `isolateEvents()` stops propagation of mouse, pointer, touch, key and input events at the card root. Without this, CodeMirror moves the cursor into the block and swaps the widget for raw source. Don't remove events from that list without testing in Live Preview.
- **Dragging uses Pointer Events, not HTML5 drag-and-drop.** HTML5 DnD does not work on touch devices. The grip has `touch-action: none` so a finger drags instead of scrolling. The card follows the pointer via CSS variables `--pc-drag-x/y`.
- **No inline styles.** The review (and `obsidianmd/no-static-styles-assignment`) wants CSS classes. Dynamic values go through `el.setCssProps({"--pc-…": value})` and CSS reads the variables (`--pc-share` for the bar, `--pc-delay` for staggered animations).
- **Popout windows.** Use `window.requestAnimationFrame` / `window.setTimeout`, not the bare globals (lint rule `prefer-window-timers`).
- **Settings** are validated on load (unknown `design`/`symbol`, or out-of-range `maxWeight`, fall back to defaults). `saveSettings()` re-renders every live block through the `renderers` set, so no reload is needed.
- **Settings tab has two paths.** `getSettingDefinitions()` (Obsidian 1.13+, shows up in settings search) and `display()` as the fallback for older versions, which is never called when definitions are returned. Both share `SETTING_TEXT`, so keep them in sync. `setControlValue` goes through `saveSettings()` so blocks re-render. The `obsidian` dev dependency is 1.13.x for these types. That's fine with `minAppVersion` 1.4.0 as long as the code only *implements* new APIs and never *calls* them. `setDynamicTooltip` is deprecated and `no-deprecated` may not be disabled, so the fallback slider shows its value in a span.

## Design decisions requested by the user (don't reintroduce)

- **No** balance-scale graphic, **no** icon or heading at the top of the card.
- Result area = **only** the green/red bar plus the legend line (`10 pro · 59%` … `41% · 7 con`). No verdict text, no icon, no 50% marker line in the bar.
- **No** drop shadow under the whole card.
- Wording is **"con"**, never "contra" ("pros and cons" is the English idiom), in UI, docs and manifest. `contra` stays only as an accepted parser alias.
- **No** animation when a new entry is added (Colored design). Other animations stay: intro fade, change flash, star pop, move slide, delete fade, bar/number transitions.
- Two designs selectable in settings: **Colored** (default) and **Plain** (minimal color, *no* animations or transitions at all; the bar keeps muted green/red so it stays readable).
- Must work on phones: controls always visible on `(hover: none)`, finger-sized targets, and on narrow containers (`@container (max-width: 480px)`) the text sits on its own line above stars and buttons.

## CSS conventions

- Every class is prefixed with `procon-`, and state classes use `is-…`. The root `.procon` is a size container (`container-type: inline-size`), so layout reacts to the pane width rather than the window.
- Only Obsidian theme variables are used (`--background-*`, `--text-*`, `--color-green(-rgb)`, …), so light/dark themes work automatically.
- Hover-only effects belong inside `@media (hover: hover)`. On touch, `:hover` sticks after a tap.
- The Plain design is a block of `.procon.is-plain …` overrides at the end of `styles.css`.
- **No `!important`** (review warning). All `animation`/`transition` declarations live in the "Motion" block, gated by `@media (prefers-reduced-motion: no-preference)` and `.procon:not(.is-plain)`. Plain and reduced motion therefore need no overrides. Never put motion into base rules.
- The dragged card moves via the individual `translate` property, not `transform`, so animations and hover transforms can't override it.

## Obsidian review checklist

- `npm run lint` clean. The review also checks things the local lint doesn't, such as `!important` in `styles.css`.
- No `innerHTML`/`outerHTML`, no network requests, no Node/Electron APIs (`isDesktopOnly: false`).
- `manifest.json` name: Basic Latin only, no punctuation except `-`, `+` and `()`, no "Obsidian" and no "Plugin". A `/` ("Pro/Con") was rejected by the directory, which is why the name is **Pro-Con Decisions**.
- Command id/name must not contain the plugin id/name. No default hotkeys.
- UI text in sentence case.
- `manifest.json` description: short, ends with a period, doesn't start with "This plugin".
- Releases: tag == manifest version, no `v` prefix (`.npmrc` sets `tag-version-prefix=""`). Assets: `main.js`, `manifest.json`, `styles.css`. `release.yml` signs them with `actions/attest@v4` (build-provenance attestations, which the review recommends). This needs the `id-token`, `attestations` and `artifact-metadata` permissions.
- `main.js` is build output and is git-ignored.

## Testing UI changes without Obsidian

`tools/screenshots/` contains a working setup you can reuse:

- `obsidian-shim.ts` stands in for the `obsidian` module (esbuild alias). It covers the `createDiv`/`createEl`/`createSpan`/`createSvg`/`empty`/`addClass`/`toggleClass`/`setCssProps` prototype helpers, `setIcon` via the Lucide UMD build, and minimal `Plugin`/`MarkdownRenderChild`/`TFile`/`MarkdownView`/`Notice` classes. Extend it when `main.ts` starts using new Obsidian APIs.
- `entry.ts` fakes `ctx.getSectionInfo` and `app.vault.process` and re-renders after each write. Query params: `theme=light|dark`, `design=colored|plain`, `symbol=…`, `set=laptop`, `mobile=1`, `hover=<card index>`.
- `page.html` is a note-like page with Obsidian's default light/dark theme variables.
- `shoot.mjs` bundles everything and captures `docs/*.png` with headless Chrome/Edge at 2× scale.

Lessons learned:
- Headless screenshots are taken right after load, before animations finish. The entry therefore renders **twice** (the second render has no diff to animate) and the page disables animations.
- Headless Chrome/Edge won't make the window narrower than about 500px. The mobile shot uses a 375px "phone frame" inside a wider window.
- `--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2` makes `(hover: none)` match, so the touch layout is shown.
- For interactive checks in a browser pane, serve the page over http (file:// pages may be static snapshots) and add a viewport meta tag, or mobile emulation will lie.

Final verification must still happen in real Obsidian (Live Preview, Reading view, mobile).
