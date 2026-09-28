import "./obsidian-shim";
import { TFile } from "./obsidian-shim";
import ProConPlugin from "../../src/main";

const q = new URLSearchParams(location.search);
document.body.classList.add(q.get("theme") === "dark" ? "theme-dark" : "theme-light");
if (q.get("mobile")) document.body.classList.add("is-mobile");
(window as any).__settings = {
	design: q.get("design") ?? "colored",
	symbol: q.get("symbol") ?? "star",
};

const rows =
	q.get("set") === "laptop"
		? [
				"| pro | Twice as fast for builds | 5 |",
				"| pro | Much better battery life | 4 |",
				"| con | Expensive | 4 |",
				"| con | Old one still works fine | 2 |",
				"| con | Need new adapters | 1 |",
		  ]
		: [
				"| pro | Much better job market for developers | 5 |",
				"| pro | Friends already live there | 3 |",
				"| pro | Culture, nightlife, museums | 2 |",
				"| con | Rent is getting expensive | 4 |",
				"| con | Far away from family | 3 |",
		  ];

let doc = ["```procon", "| Side | Argument | Weight |", "| --- | --- | --- |", ...rows, "```"].join("\n");

const app: any = {
	vault: {
		getAbstractFileByPath: () => new TFile(),
		process: async (_f: any, fn: (s: string) => string) => {
			doc = fn(doc);
			setTimeout(render, 30);
			return doc;
		},
	},
	workspace: { iterateAllLeaves: () => {} },
};
const plugin = new ProConPlugin(app, {} as any);

function render() {
	const lines = doc.split("\n");
	const host = document.getElementById("host")!;
	host.innerHTML = "";
	const el = host.appendChild(document.createElement("div"));
	el.className = "block-language-procon";
	plugin.processors["procon"](lines.slice(1, -1).join("\n"), el, {
		sourcePath: "note.md",
		getSectionInfo: () => ({ lineStart: 0, lineEnd: lines.length - 1, text: doc }),
		addChild: (c: any) => c.onload(),
	});
	// Optionally show the hover controls on one card, as if the mouse were over it
	const hover = q.get("hover");
	if (hover !== null) document.querySelectorAll(".procon-item")[Number(hover)]?.classList.add("force-hover");
}

// Render twice: the second pass has no "previous state" differences, so it shows the
// final values immediately (headless screenshots are taken before animations finish).
plugin.onload().then(() => {
	render();
	plugin.renderers.forEach((r: any) => r.render());
	const hover = q.get("hover");
	if (hover !== null) document.querySelectorAll(".procon-item")[Number(hover)]?.classList.add("force-hover");
});
