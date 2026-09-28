// Minimal Obsidian API shim for visual testing in a plain browser.
declare const lucide: any;

const P = Element.prototype as any;
function apply(el: any, o: any = {}) {
	if (typeof o === "string") o = { cls: o };
	if (o.cls) (Array.isArray(o.cls) ? o.cls : o.cls.split(" ")).forEach((c: string) => c && el.classList.add(c));
	if (o.text !== undefined) el.textContent = o.text;
	if (o.attr) for (const k in o.attr) el.setAttribute(k, String(o.attr[k]));
	if (o.type) el.type = o.type;
	if (o.placeholder) el.placeholder = o.placeholder;
	return el;
}
P.createEl = function (tag: string, o?: any) { return this.appendChild(apply(document.createElement(tag), o)); };
P.createDiv = function (o?: any) { return this.createEl("div", o); };
P.createSpan = function (o?: any) { return this.createEl("span", o); };
P.createSvg = function (tag: string, o?: any) {
	return this.appendChild(apply(document.createElementNS("http://www.w3.org/2000/svg", tag), o));
};
P.setCssProps = function (p: Record<string, string>) { for (const k in p) this.style.setProperty(k, p[k]); };
P.empty = function () { this.innerHTML = ""; };
P.addClass = function (...c: string[]) { this.classList.add(...c); };
P.removeClass = function (...c: string[]) { this.classList.remove(...c); };
P.toggleClass = function (c: string, v: boolean) { this.classList.toggle(c, v); };

export function setIcon(el: HTMLElement, name: string) {
	el.innerHTML = "";
	const pascal = name.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
	const node = lucide.icons[pascal];
	if (node) el.appendChild(lucide.createElement(node));
}

export class TFile { path = "note.md"; }
export class MarkdownView {}
export class Notice { constructor(m: string) { console.warn(m); } }
export class Component { onload() {} onunload() {} }
export class MarkdownRenderChild extends Component { constructor(public containerEl: HTMLElement) { super(); } }
export class PluginSettingTab { constructor(public app: any, public plugin: any) {} }
export class Setting {}
export class Plugin {
	processors: Record<string, Function> = {};
	constructor(public app: any) {}
	registerMarkdownCodeBlockProcessor(lang: string, fn: Function) { this.processors[lang] = fn; }
	addCommand() {}
	addSettingTab() {}
	async loadData() { return (window as any).__settings ?? {}; }
	async saveData() {}
}
