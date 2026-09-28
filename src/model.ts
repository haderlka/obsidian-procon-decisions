export type Side = "pro" | "con";

export interface Entry {
	side: Side;
	text: string;
	weight: number;
}

export interface Decision {
	title: string;
	/** Heading level of the title, 1–6 (number of `#`). */
	level: number;
	entries: Entry[];
}

const PRO_WORDS = /^(pro|pros|\+|yes|for|👍)$/i;
const CON_WORDS = /^(con|cons|contra|-|−|no|against|👎)$/i;
const SEPARATOR_CELL = /^:?-{1,}:?$/;

export function parseSide(cell: string): Side | null {
	const c = cell.trim();
	if (PRO_WORDS.test(c)) return "pro";
	if (CON_WORDS.test(c)) return "con";
	return null;
}

/** Accepts "3", "★★★", "***", "🔥🔥" … — anything countable. */
export function parseWeight(cell: string | undefined): number {
	const c = (cell ?? "").trim();
	if (!c) return 1;
	const num = parseInt(c, 10);
	if (!isNaN(num)) return Math.max(1, num);
	// Only count symbol runs like "★★★" — never words.
	if (/[\p{L}\p{N}]/u.test(c)) return 1;
	const symbols = Array.from(c.replace(/[☆○◇♡\s️]/g, "")).length;
	return Math.max(1, symbols);
}

/** Splits a table row on unescaped pipes and drops the outer empty cells. */
export function splitRow(line: string): string[] {
	const cells: string[] = [];
	let current = "";
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === "\\" && line[i + 1] === "|") {
			current += "|";
			i++;
		} else if (ch === "|") {
			cells.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	cells.push(current);
	const trimmed = line.trim();
	if (trimmed.startsWith("|")) cells.shift();
	if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) cells.pop();
	return cells.map((c) => c.trim());
}

export function parse(source: string): Decision {
	let title = "";
	let level = 2;
	const entries: Entry[] = [];
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) continue;
		if (line.startsWith("|")) {
			const cells = splitRow(line);
			if (cells.length < 2) continue;
			if (cells.every((c) => c === "" || SEPARATOR_CELL.test(c))) continue;
			const side = parseSide(cells[0]);
			if (!side) continue; // header row or garbage
			entries.push({ side, text: cells[1] ?? "", weight: parseWeight(cells[2]) });
		} else if (!title) {
			const hashes = line.match(/^(#{1,6})\s*/);
			if (hashes) level = hashes[1].length;
			title = line.replace(/^#+\s*/, "").replace(/^title:\s*/i, "");
		}
	}
	return { title, level, entries };
}

const escapeCell = (s: string) => s.replace(/\|/g, "\\|");

export function serialize(d: Decision): string {
	const rows = [
		["Side", "Argument", "Weight"],
		...d.entries.map((e) => [e.side, escapeCell(e.text), String(e.weight)]),
	];
	const widths = [0, 1, 2].map((col) => Math.max(3, ...rows.map((r) => r[col].length)));
	const fmt = (r: string[]) => "| " + r.map((c, i) => c.padEnd(widths[i])).join(" | ") + " |";
	const lines: string[] = [];
	if (d.title.trim()) lines.push(`${"#".repeat(d.level)} ${d.title.trim()}`);
	lines.push(fmt(rows[0]));
	lines.push("| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |");
	for (const r of rows.slice(1)) lines.push(fmt(r));
	return lines.join("\n");
}

export interface Tally {
	pro: number;
	con: number;
	total: number;
	/** -1 (all con) … +1 (all pro) */
	balance: number;
}

export function tally(entries: Entry[], maxWeight: number): Tally {
	let pro = 0;
	let con = 0;
	for (const e of entries) {
		const w = Math.min(e.weight, maxWeight);
		if (e.side === "pro") pro += w;
		else con += w;
	}
	const total = pro + con;
	return { pro, con, total, balance: total ? (pro - con) / total : 0 };
}

export type VerdictKind = "empty" | "strong-pro" | "pro" | "tie" | "con" | "strong-con";

export function verdictOf(t: Tally): VerdictKind {
	if (t.total === 0) return "empty";
	if (t.balance >= 0.35) return "strong-pro";
	if (t.balance >= 0.1) return "pro";
	if (t.balance <= -0.35) return "strong-con";
	if (t.balance <= -0.1) return "con";
	return "tie";
}

export type Mark = { kind: "new" | "changed" | "moved"; prevWeight?: number } | null;

/** Works out which entries are new / re-weighted / moved compared to the previous render. */
export function diffEntries(prev: Entry[] | undefined, next: Entry[]): Mark[] {
	if (!prev) return next.map(() => null);
	const used = new Set<number>();
	const marks: (Mark | undefined)[] = next.map((e) => {
		const i = prev.findIndex((p, j) => !used.has(j) && p.side === e.side && p.text === e.text);
		if (i < 0) return undefined;
		used.add(i);
		return prev[i].weight !== e.weight ? { kind: "changed", prevWeight: prev[i].weight } : null;
	});
	return marks.map((m, idx) => {
		if (m !== undefined) return m;
		const e = next[idx];
		const j = prev.findIndex((p, k) => !used.has(k) && p.text === e.text && p.side !== e.side);
		if (j >= 0) {
			used.add(j);
			return { kind: "moved" };
		}
		return prev.length === next.length ? { kind: "changed" } : { kind: "new" };
	});
}
