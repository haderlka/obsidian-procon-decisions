// Regenerates the README screenshots in docs/ with `npm run screenshots`.
//
// Renders the real plugin code (src/main.ts) on a note-like page, with a tiny
// stand-in for the Obsidian API (obsidian-shim.ts), and captures it with headless
// Chrome or Edge. Set CHROME_PATH if the browser isn't found automatically.
// Needs internet access for the Lucide icons (loaded from jsDelivr).
import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const build = join(here, ".build");
const out = join(root, "docs");

const SHOTS = [
	{ name: "colored-light", size: [840, 560], query: "theme=light" },
	{ name: "colored-dark", size: [840, 540], query: "theme=dark&set=laptop" },
	{ name: "plain-light", size: [840, 560], query: "theme=light&design=plain&symbol=dot" },
	{ name: "mobile", size: [520, 1010], query: "theme=light&mobile=1", touch: true },
];

function findBrowser() {
	const candidates = [
		process.env.CHROME_PATH,
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
	];
	const found = candidates.find((p) => p && existsSync(p));
	if (!found) throw new Error("No Chrome/Edge found — set CHROME_PATH.");
	return found;
}

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
mkdirSync(out, { recursive: true });

await esbuild.build({
	entryPoints: [join(here, "entry.ts")],
	bundle: true,
	format: "iife",
	outfile: join(build, "bundle.js"),
	alias: { obsidian: join(here, "obsidian-shim.ts") },
	logLevel: "warning",
});
copyFileSync(join(here, "page.html"), join(build, "page.html"));
copyFileSync(join(root, "styles.css"), join(build, "styles.css"));

const browser = findBrowser();
const page = pathToFileURL(join(build, "page.html")).href;

for (const shot of SHOTS) {
	const args = [
		"--headless=new",
		"--disable-gpu",
		"--hide-scrollbars",
		"--force-device-scale-factor=2",
		`--window-size=${shot.size.join(",")}`,
		"--timeout=2500",
		`--user-data-dir=${join(build, "profile")}`,
		`--screenshot=${join(out, shot.name + ".png")}`,
	];
	// Make CSS (hover: none) match, so the touch layout is shown
	if (shot.touch) {
		args.push("--blink-settings=primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2");
	}
	args.push(`${page}?${shot.query}`);
	execFileSync(browser, args, { stdio: "ignore" });
	console.log(`docs/${shot.name}.png`);
}

rmSync(build, { recursive: true, force: true });
