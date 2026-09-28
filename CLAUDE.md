# CLAUDE.md

@AGENTS.md

## Claude-specific notes

- **Shell on Windows:** in Bash heredocs and `node -e` strings, backslashes and regex escapes get mangled. For multi-step file rewrites, write a small `.js` script to the scratchpad and run it with `node`, or use the Edit tool.
- **Before finishing a change:** `npm run lint && npm test && npm run build`. Also tell the user which files to copy into `<vault>/.obsidian/plugins/procon-decisions/`: `styles.css` only for CSS changes, `main.js` + `styles.css` for code changes.
- **Visual checks:** use the shim-based browser harness described in AGENTS.md, and check the Colored and Plain designs plus a ~375px-wide mobile viewport. Browser-pane screenshots can be scaled relative to the CSS viewport. For precise clicks, read coordinates from `getBoundingClientRect()` and confirm with an event log instead of trusting the screenshot.
- **The user iterates on the look in small steps** ("remove X", "no Y"). Make exactly the requested change, remove the now-dead code and CSS along with it, and add the decision to the "Design decisions" list in AGENTS.md so it doesn't come back.
