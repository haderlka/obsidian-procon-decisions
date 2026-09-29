import {
	App,
	Editor,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	TFile,
	setIcon,
} from "obsidian";
import {
	Decision,
	Entry,
	Mark,
	Side,
	Tally,
	VerdictKind,
	diffEntries,
	parse,
	serialize,
	tally,
	verdictOf,
} from "./model";

// ─── Settings ────────────────────────────────────────────────────────────────

const SYMBOLS = {
	star: { char: "★", label: "Stars ★" },
	heart: { char: "♥", label: "Hearts ♥" },
	dot: { char: "●", label: "Dots ●" },
	diamond: { char: "◆", label: "Diamonds ◆" },
	flame: { char: "🔥", label: "Flames 🔥" },
	bolt: { char: "⚡", label: "Bolts ⚡" },
} as const;
type SymbolKey = keyof typeof SYMBOLS;

const DESIGNS = {
	colored: "Colored",
	plain: "Plain",
} as const;
type DesignKey = keyof typeof DESIGNS;

interface ProConSettings {
	design: DesignKey;
	symbol: SymbolKey;
	maxWeight: number;
}

const DEFAULT_SETTINGS: ProConSettings = {
	design: "colored",
	symbol: "star",
	maxWeight: 5,
};

const TEMPLATE = [
	"```procon",
	"| Side | Argument          | Weight |",
	"| ---- | ----------------- | ------ |",
	"| pro  | A good reason     | 4      |",
	"| con  | A reason against  | 2      |",
	"```",
	"",
].join("\n");

// ─── Cross-render memory ─────────────────────────────────────────────────────
// Every edit rewrites the file, which makes Obsidian re-render the block from
// scratch. To animate *what changed*, we remember the last state per block.

interface Snapshot {
	entries: Entry[];
	tally: Tally;
	verdict: VerdictKind;
}
const memory = new Map<string, Snapshot>();
const focusHints = new Map<string, { side: Side }>();

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default class ProConPlugin extends Plugin {
	settings: ProConSettings = DEFAULT_SETTINGS;
	renderers = new Set<DecisionRenderer>();

	async onload() {
		await this.loadSettings();

		this.registerMarkdownCodeBlockProcessor("procon", (source, el, ctx) => {
			ctx.addChild(new DecisionRenderer(this, el, source, ctx));
		});

		this.addCommand({
			id: "insert-decision",
			name: "Insert pro/con decision",
			icon: "scale",
			editorCallback: (editor: Editor) => {
				const cursor = editor.getCursor();
				const prefix = cursor.ch > 0 ? "\n" : "";
				editor.replaceRange(prefix + TEMPLATE, cursor);
			},
		});

		this.addSettingTab(new ProConSettingTab(this.app, this));
	}

	onunload() {
		memory.clear();
		focusHints.clear();
	}

	async loadSettings() {
		const data = ((await this.loadData()) ?? {}) as Partial<ProConSettings>;
		const s: ProConSettings = { ...DEFAULT_SETTINGS, ...data };
		// Guard against stale or hand-edited values in data.json
		if (!(s.design in DESIGNS)) s.design = DEFAULT_SETTINGS.design;
		if (!(s.symbol in SYMBOLS)) s.symbol = DEFAULT_SETTINGS.symbol;
		if (typeof s.maxWeight !== "number" || s.maxWeight < 3 || s.maxWeight > 10) {
			s.maxWeight = DEFAULT_SETTINGS.maxWeight;
		}
		this.settings = s;
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.renderers.forEach((r) => r.render());
	}
}

// ─── Renderer ────────────────────────────────────────────────────────────────

class DecisionRenderer extends MarkdownRenderChild {
	private decision: Decision;
	private key = "";

	constructor(
		private plugin: ProConPlugin,
		containerEl: HTMLElement,
		private source: string,
		private ctx: MarkdownPostProcessorContext
	) {
		super(containerEl);
		this.decision = parse(source);
	}

	onload() {
		this.plugin.renderers.add(this);
		this.render();
	}

	onunload() {
		this.plugin.renderers.delete(this);
	}

	private get app(): App {
		return this.plugin.app;
	}

	private computeKey(): string {
		const info = this.ctx.getSectionInfo(this.containerEl);
		return `${this.ctx.sourcePath}::${info ? info.lineStart : this.decision.title}`;
	}

	render() {
		const { settings } = this.plugin;
		const d = this.decision;
		const el = this.containerEl;
		this.key = this.computeKey();
		const prev = memory.get(this.key);
		const editable = !!this.ctx.getSectionInfo(el);

		el.empty();
		el.addClass("procon-host");
		const root = el.createDiv({ cls: "procon" });
		root.dataset.symbol = settings.symbol;
		if (settings.design === "plain") root.addClass("is-plain");
		if (!editable) root.addClass("is-readonly");
		if (!prev) root.addClass("is-intro");
		this.isolateEvents(root);

		// Columns
		const marks = diffEntries(prev?.entries, d.entries);
		const cols = root.createDiv({ cls: "procon-columns" });
		const t = tally(d.entries, settings.maxWeight);
		const inputs: Partial<Record<Side, HTMLInputElement>> = {};
		for (const side of ["pro", "con"] as Side[]) {
			inputs[side] = this.renderColumn(cols, side, marks, t, editable, !prev);
		}

		// Verdict
		const verdict = verdictOf(t);
		this.renderVerdict(root, t, verdict, prev);

		memory.set(this.key, { entries: d.entries.map((e) => ({ ...e })), tally: t, verdict });

		const hint = focusHints.get(this.key);
		if (hint) {
			focusHints.delete(this.key);
			const input = inputs[hint.side];
			if (input) whenConnected(input, () => input.focus());
		}
	}

	// ── Columns & entries ──

	private renderColumn(
		cols: HTMLElement,
		side: Side,
		marks: Mark[],
		t: Tally,
		editable: boolean,
		intro: boolean
	): HTMLInputElement | undefined {
		const d = this.decision;
		const col = cols.createDiv({ cls: `procon-col procon-col-${side}` });

		const head = col.createDiv({ cls: "procon-col-head" });
		setIcon(head.createSpan({ cls: "procon-col-icon" }), side === "pro" ? "thumbs-up" : "thumbs-down");
		head.createSpan({ cls: "procon-col-label", text: side === "pro" ? "Pro" : "Con" });
		const count = d.entries.filter((e) => e.side === side).length;
		head.createSpan({ cls: "procon-col-count", text: `${count}` });
		const sum = head.createSpan({ cls: "procon-col-sum" });
		sum.createSpan({ text: "Σ " });
		const sumNum = sum.createSpan({ text: String(side === "pro" ? t.pro : t.con) });
		const prevSum = memory.get(this.key)?.tally[side];
		if (prevSum !== undefined) animateNumber(sumNum, prevSum, side === "pro" ? t.pro : t.con);

		const list = col.createDiv({ cls: "procon-list" });
		list.dataset.side = side;
		let n = 0;
		d.entries.forEach((e, i) => {
			if (e.side !== side) return;
			this.renderEntry(list, e, i, marks[i], editable, intro ? n++ : -1);
		});
		if (count === 0) {
			list.createDiv({
				cls: "procon-empty",
				text: side === "pro" ? "No arguments in favour yet" : "No arguments against yet",
			});
		}

		if (!editable) return undefined;
		const add = col.createDiv({ cls: "procon-add" });
		setIcon(add.createSpan({ cls: "procon-add-icon" }), "plus");
		const input = add.createEl("input", {
			type: "text",
			placeholder: side === "pro" ? "Add a pro…" : "Add a con…",
		});
		input.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") {
				ev.preventDefault();
				this.addEntry(side, input.value);
			} else if (ev.key === "Escape") {
				input.value = "";
				input.blur();
			}
		});
		return input;
	}

	private renderEntry(list: HTMLElement, e: Entry, index: number, mark: Mark, editable: boolean, introOrder: number) {
		const card = list.createDiv({ cls: `procon-item procon-item-${e.side}` });
		card.dataset.index = String(index);
		if (mark) card.addClass(`is-${mark.kind}`);
		if (introOrder >= 0) card.setCssProps({ "--pc-delay": `${80 + introOrder * 55}ms` });

		if (editable) {
			const grip = card.createDiv({ cls: "procon-grip", attr: { "aria-label": "Drag to move" } });
			setIcon(grip, "grip-vertical");
			grip.addEventListener("pointerdown", (ev) => this.startDrag(ev, grip, card, index));
		}

		const text = card.createDiv({ cls: "procon-text", text: e.text });
		text.dataset.placeholder = "Empty argument";
		this.makeEditable(text, e.text, editable, (v) => {
			if (!v) this.removeEntry(index, card);
			else this.updateEntry(index, { text: v });
		});

		this.renderWeight(card, e, index, mark, editable);

		if (editable) {
			const actions = card.createDiv({ cls: "procon-actions" });
			const flip = actions.createEl("button", {
				cls: "procon-btn clickable-icon",
				attr: { "aria-label": e.side === "pro" ? "Move to con" : "Move to pro" },
			});
			setIcon(flip, "arrow-left-right");
			flip.addEventListener("click", () =>
				this.updateEntry(index, { side: e.side === "pro" ? "con" : "pro" })
			);
			const del = actions.createEl("button", {
				cls: "procon-btn procon-btn-delete clickable-icon",
				attr: { "aria-label": "Remove" },
			});
			setIcon(del, "x");
			del.addEventListener("click", () => this.removeEntry(index, card));
		}
	}

	private renderWeight(card: HTMLElement, e: Entry, index: number, mark: Mark, editable: boolean) {
		const max = this.plugin.settings.maxWeight;
		const char = SYMBOLS[this.plugin.settings.symbol]?.char ?? "★";
		const weight = Math.min(e.weight, max);
		const prevWeight = mark?.prevWeight !== undefined ? Math.min(mark.prevWeight, max) : weight;

		const wrap = card.createDiv({
			cls: "procon-weight",
			attr: {
				role: "slider",
				"aria-label": "Weight",
				"aria-valuemin": "1",
				"aria-valuemax": String(max),
				"aria-valuenow": String(weight),
			},
		});
		if (editable) wrap.tabIndex = 0;

		const syms: HTMLElement[] = [];
		for (let i = 1; i <= max; i++) {
			const s = wrap.createSpan({ cls: "procon-sym", text: char });
			if (i <= weight) s.addClass("is-filled");
			if (i > prevWeight && i <= weight) {
				s.addClass("is-pop");
				s.setCssProps({ "--pc-delay": `${(i - prevWeight - 1) * 60}ms` });
			} else if (i <= prevWeight && i > weight) {
				s.addClass("is-drop");
			}
			syms.push(s);
			if (!editable) continue;
			s.addEventListener("mouseenter", () =>
				syms.forEach((x, j) => x.toggleClass("is-preview", j < i))
			);
			s.addEventListener("click", () => this.updateEntry(index, { weight: i }));
		}
		wrap.createSpan({ cls: "procon-weight-num", text: String(weight) });

		if (!editable) return;
		wrap.addEventListener("mouseleave", () => syms.forEach((x) => x.removeClass("is-preview")));
		wrap.addEventListener("keydown", (ev) => {
			let next = weight;
			if (ev.key === "ArrowRight" || ev.key === "ArrowUp") next = Math.min(max, weight + 1);
			else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") next = Math.max(1, weight - 1);
			else if (/^[1-9]$/.test(ev.key)) next = Math.min(max, Number(ev.key));
			else return;
			ev.preventDefault();
			if (next !== weight) this.updateEntry(index, { weight: next });
		});
	}

	// ── Verdict ──

	private renderVerdict(root: HTMLElement, t: Tally, verdict: VerdictKind, prev: Snapshot | undefined) {
		const box = root.createDiv({ cls: `procon-verdict is-${verdict}` });
		if (prev && prev.verdict !== verdict) box.addClass("is-flipped");

		const body = box.createDiv({ cls: "procon-verdict-body" });

		// Tug-of-war meter
		// The fill widths come from --pc-share (0–100) in CSS; changing it animates the bar.
		const meter = body.createDiv({ cls: "procon-meter" });
		meter.createDiv({ cls: "procon-meter-pro" });
		meter.createDiv({ cls: "procon-meter-con" });
		const share = (x: Tally) => (x.total ? (x.pro / x.total) * 100 : 50);
		const from = prev ? share(prev.tally) : 50;
		const to = share(t);
		meter.setCssProps({ "--pc-share": String(from) });
		whenConnected(meter, () => meter.setCssProps({ "--pc-share": String(to) }));

		const legend = body.createDiv({ cls: "procon-meter-legend" });
		const l = legend.createSpan({ cls: "procon-legend-pro" });
		const lNum = l.createSpan({ text: String(t.pro) });
		l.createSpan({ text: ` pro · ${Math.round(to)}%` });
		const r = legend.createSpan({ cls: "procon-legend-con" });
		r.createSpan({ text: `${Math.round(100 - to)}% · ` });
		const rNum = r.createSpan({ text: String(t.con) });
		r.createSpan({ text: " con" });
		animateNumber(lNum, prev ? prev.tally.pro : 0, t.pro);
		animateNumber(rNum, prev ? prev.tally.con : 0, t.con);
	}

	// ── Editing helpers ──

	private makeEditable(el: HTMLElement, original: string, editable: boolean, onCommit: (v: string) => void) {
		if (!editable) return;
		el.contentEditable = "plaintext-only";
		el.spellcheck = true;
		el.enterKeyHint = "done"; // Enter commits, so show "Done" on phone keyboards
		el.addEventListener("keydown", (ev) => {
			if (ev.key === "Enter") {
				ev.preventDefault();
				el.blur();
			} else if (ev.key === "Escape") {
				el.textContent = original;
				el.blur();
			}
		});
		el.addEventListener("blur", () => {
			const v = (el.textContent ?? "").replace(/\s+/g, " ").trim();
			if (v !== original) onCommit(v);
		});
	}

	/** Keep CodeMirror (Live Preview) from reacting to clicks and keys inside the widget. */
	private isolateEvents(root: HTMLElement) {
		const events = [
			"mousedown", "mouseup", "click", "dblclick", "pointerdown", "pointerup",
			"touchstart", "touchend", "contextmenu",
			"keydown", "keyup", "keypress", "beforeinput", "input",
			"paste", "cut", "copy",
		];
		for (const name of events) root.addEventListener(name, (ev) => ev.stopPropagation());
	}

	/**
	 * Pointer-based drag (works with mouse, pen and touch — HTML5 drag & drop
	 * does not work on phones). The card follows the pointer; on release it is
	 * moved to the column/position under the pointer.
	 */
	private startDrag(ev: PointerEvent, grip: HTMLElement, card: HTMLElement, index: number) {
		if (ev.button !== 0) return;
		ev.preventDefault();
		grip.setPointerCapture(ev.pointerId);
		const startX = ev.clientX;
		const startY = ev.clientY;
		let moved = false;
		let drop: { side: Side; before: number | null } | null = null;

		const onMove = (e: PointerEvent) => {
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (!moved && Math.hypot(dx, dy) < 5) return;
			moved = true;
			card.addClass("is-dragging");
			card.setCssProps({ "--pc-drag-x": `${dx}px`, "--pc-drag-y": `${dy}px` });
			drop = this.showDropTarget(e.clientX, e.clientY);
		};
		const onEnd = (e: PointerEvent) => {
			grip.removeEventListener("pointermove", onMove);
			grip.removeEventListener("pointerup", onEnd);
			grip.removeEventListener("pointercancel", onEnd);
			if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
			card.removeClass("is-dragging");
			card.setCssProps({ "--pc-drag-x": "", "--pc-drag-y": "" });
			this.clearDropIndicators();
			if (moved && drop && e.type === "pointerup") this.moveEntry(index, drop.side, drop.before);
		};
		grip.addEventListener("pointermove", onMove);
		grip.addEventListener("pointerup", onEnd);
		grip.addEventListener("pointercancel", onEnd);
	}

	/** Highlights where a dragged card would land and returns that position. */
	private showDropTarget(x: number, y: number): { side: Side; before: number | null } | null {
		this.clearDropIndicators();
		const lists = Array.from(this.containerEl.querySelectorAll<HTMLElement>(".procon-list"));
		for (const list of lists) {
			const col = list.closest(".procon-col") ?? list;
			const r = col.getBoundingClientRect();
			if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
			const cards = Array.from(list.querySelectorAll<HTMLElement>(".procon-item:not(.is-dragging)"));
			const target = cards.find((c) => {
				const cr = c.getBoundingClientRect();
				return y < cr.top + cr.height / 2;
			});
			if (target) target.addClass("is-drop-before");
			else list.addClass("is-drop-end");
			return {
				side: list.dataset.side as Side,
				before: target ? Number(target.dataset.index) : null,
			};
		}
		return null;
	}

	private clearDropIndicators() {
		this.containerEl.querySelectorAll(".is-drop-before").forEach((x) => x.removeClass("is-drop-before"));
		this.containerEl.querySelectorAll(".is-drop-end").forEach((x) => x.removeClass("is-drop-end"));
	}

	// ── Mutations ──

	private addEntry(side: Side, raw: string) {
		let text = raw.replace(/\s+/g, " ").trim();
		if (!text) return;
		const max = this.plugin.settings.maxWeight;
		let weight = Math.ceil(max / 2);
		// Quick weight: "Better salary !4"
		const m = text.match(/\s*!(\d+)$/);
		if (m) {
			weight = Math.min(max, Math.max(1, Number(m[1])));
			text = text.slice(0, m.index).trim();
		}
		const entries = this.decision.entries.slice();
		let last = -1;
		entries.forEach((e, i) => e.side === side && (last = i));
		entries.splice(last >= 0 ? last + 1 : entries.length, 0, { side, text, weight });
		void this.commit({ ...this.decision, entries }, { side });
	}

	private updateEntry(index: number, patch: Partial<Entry>) {
		const entries = this.decision.entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
		void this.commit({ ...this.decision, entries });
	}

	private removeEntry(index: number, card: HTMLElement) {
		card.addClass("is-removing");
		window.setTimeout(() => {
			const entries = this.decision.entries.filter((_, i) => i !== index);
			void this.commit({ ...this.decision, entries });
		}, 260);
	}

	private moveEntry(from: number, side: Side, before: number | null) {
		const entries = this.decision.entries.map((e) => ({ ...e }));
		const [item] = entries.splice(from, 1);
		item.side = side;
		let at: number;
		if (before !== null) {
			at = before > from ? before - 1 : before;
		} else {
			let last = -1;
			entries.forEach((e, i) => e.side === side && (last = i));
			at = last >= 0 ? last + 1 : entries.length;
		}
		entries.splice(at, 0, item);
		void this.commit({ ...this.decision, entries });
	}

	private async commit(next: Decision, focus?: { side: Side }) {
		const text = serialize(next);
		if (text === this.source.trim()) {
			this.decision = next;
			return;
		}
		if (focus) focusHints.set(this.key, focus);
		const ok = await writeBlock(this.app, this.ctx, this.containerEl, text);
		if (!ok) {
			focusHints.delete(this.key);
			new Notice("Couldn't find this decision in the file. Please edit it in source mode.");
		}
	}
}

// ─── File writing ────────────────────────────────────────────────────────────

function findSourceEditor(app: App, path: string): Editor | null {
	let found: Editor | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		const v = leaf.view;
		if (!found && v instanceof MarkdownView && v.file?.path === path && v.getMode() === "source") {
			found = v.editor;
		}
	});
	return found;
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*procon\b/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

async function writeBlock(app: App, ctx: MarkdownPostProcessorContext, el: HTMLElement, content: string) {
	const info = ctx.getSectionInfo(el);
	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!info || !(file instanceof TFile)) return false;
	const { lineStart, lineEnd } = info;

	const editor = findSourceEditor(app, file.path);
	if (editor) {
		if (!FENCE_OPEN.test(editor.getLine(lineStart)) || !FENCE_CLOSE.test(editor.getLine(lineEnd))) return false;
		editor.replaceRange(content + "\n", { line: lineStart + 1, ch: 0 }, { line: lineEnd, ch: 0 });
		return true;
	}

	let ok = false;
	await app.vault.process(file, (data) => {
		const eol = data.includes("\r\n") ? "\r\n" : "\n";
		const lines = data.split(/\r?\n/);
		if (!FENCE_OPEN.test(lines[lineStart] ?? "") || !FENCE_CLOSE.test(lines[lineEnd] ?? "")) return data;
		lines.splice(lineStart + 1, lineEnd - lineStart - 1, ...content.split("\n"));
		ok = true;
		return lines.join(eol);
	});
	return ok;
}

// ─── Small utilities ─────────────────────────────────────────────────────────

/** Runs `cb` one frame after `el` is in the DOM and laid out, so CSS transitions fire. */
function whenConnected(el: HTMLElement, cb: () => void, tries = 120) {
	if (el.isConnected) {
		el.getBoundingClientRect();
		window.requestAnimationFrame(() => window.requestAnimationFrame(cb));
	} else if (tries > 0) {
		window.requestAnimationFrame(() => whenConnected(el, cb, tries - 1));
	} else {
		cb();
	}
}

function animateNumber(el: HTMLElement, from: number, to: number, duration = 700) {
	if (from === to || el.closest(".is-plain")) {
		el.textContent = String(to);
		return;
	}
	el.textContent = String(from);
	whenConnected(el, () => {
		const start = performance.now();
		const step = (now: number) => {
			const p = Math.min(1, (now - start) / duration);
			const eased = 1 - Math.pow(1 - p, 3);
			el.textContent = String(Math.round(from + (to - from) * eased));
			if (p < 1) window.requestAnimationFrame(step);
		};
		window.requestAnimationFrame(step);
	});
}

// ─── Settings tab ────────────────────────────────────────────────────────────

const SETTING_TEXT = {
	design: {
		name: "Design",
		desc: "Colored uses colors and animations; plain is a quiet look with minimal color and no animations.",
	},
	symbol: { name: "Weight symbol", desc: "How argument weights are drawn." },
	maxWeight: {
		name: "Maximum weight",
		desc: "Number of symbols per argument. Higher weights in the file are capped to this.",
	},
};

class ProConSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ProConPlugin) {
		super(app, plugin);
	}

	/** Obsidian 1.13+: declarative settings, which also show up in the settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				...SETTING_TEXT.design,
				control: { type: "dropdown", key: "design", options: { ...DESIGNS } },
			},
			{
				...SETTING_TEXT.symbol,
				control: {
					type: "dropdown",
					key: "symbol",
					options: Object.fromEntries(Object.entries(SYMBOLS).map(([key, s]) => [key, s.label])),
				},
			},
			{
				...SETTING_TEXT.maxWeight,
				control: { type: "slider", key: "maxWeight", min: 3, max: 10, step: 1 },
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof ProConSettings];
	}

	async setControlValue(key: string, value: unknown) {
		this.plugin.settings = { ...this.plugin.settings, [key]: value };
		await this.plugin.saveSettings();
	}

	/** Obsidian before 1.13 renders the tab imperatively. Not called when getSettingDefinitions() is used. */
	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(SETTING_TEXT.design.name)
			.setDesc(SETTING_TEXT.design.desc)
			.addDropdown((dd) => {
				for (const [key, label] of Object.entries(DESIGNS)) dd.addOption(key, label);
				dd.setValue(this.plugin.settings.design).onChange(async (v) => {
					this.plugin.settings.design = v as DesignKey;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName(SETTING_TEXT.symbol.name)
			.setDesc(SETTING_TEXT.symbol.desc)
			.addDropdown((dd) => {
				for (const [key, s] of Object.entries(SYMBOLS)) dd.addOption(key, s.label);
				dd.setValue(this.plugin.settings.symbol).onChange(async (v) => {
					this.plugin.settings.symbol = v as SymbolKey;
					await this.plugin.saveSettings();
				});
			});

		// Shows the slider value inline, like the declarative slider does on 1.13+.
		let valueEl: HTMLElement | undefined;
		const maxWeight = new Setting(containerEl)
			.setName(SETTING_TEXT.maxWeight.name)
			.setDesc(SETTING_TEXT.maxWeight.desc)
			.addSlider((sl) =>
				sl
					.setLimits(3, 10, 1)
					.setValue(this.plugin.settings.maxWeight)
					.onChange(async (v) => {
						if (valueEl) valueEl.textContent = String(v);
						this.plugin.settings.maxWeight = v;
						await this.plugin.saveSettings();
					})
			);
		valueEl = maxWeight.controlEl.createSpan({ text: String(this.plugin.settings.maxWeight) });
	}
}
