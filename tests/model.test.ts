// Run with `npm test` (Node ≥ 22.18 runs TypeScript directly via type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffEntries, parse, parseWeight, serialize, tally, verdictOf } from "../src/model.ts";
import type { Entry } from "../src/model.ts";

test("parses sides, weights and an optional title", () => {
	const d = parse(
		[
			"## Move to Berlin?",
			"| Side | Argument | Weight |",
			"|:--|---|--:|",
			"| + | Better jobs | ★★★★ |",
			"| contra | Rent | 3 |",
			"| Pro | Friends | 🔥🔥 |",
			"| nonsense | ignored | 2 |",
		].join("\n")
	);
	assert.equal(d.title, "Move to Berlin?");
	assert.equal(d.level, 2);
	assert.deepEqual(d.entries, [
		{ side: "pro", text: "Better jobs", weight: 4 },
		{ side: "con", text: "Rent", weight: 3 },
		{ side: "pro", text: "Friends", weight: 2 },
	]);
});

test("words in the weight column never count as a weight", () => {
	assert.equal(parseWeight("lots"), 1);
	assert.equal(parseWeight(""), 1);
	assert.equal(parseWeight("0"), 1);
	assert.equal(parseWeight("7"), 7);
});

test("escaped pipes survive a round trip", () => {
	const src = String.raw`| Side | Argument | Weight |
|---|---|---|
| + | Better jobs \| salary | 4 |`;
	const d = parse(src);
	assert.equal(d.entries[0].text, "Better jobs | salary");
	assert.deepEqual(parse(serialize(d)), d);
});

test("serialize keeps the title and its heading level", () => {
	const d = parse("### Title\n| pro | A | 2 |");
	assert.match(serialize(d), /^### Title\n/);
});

test("serialize omits the title line when there is none", () => {
	const out = serialize({ title: "", level: 2, entries: [{ side: "con", text: "B", weight: 1 }] });
	assert.ok(out.startsWith("| Side"));
});

test("tally caps weights at the maximum and computes the balance", () => {
	const entries: Entry[] = [
		{ side: "pro", text: "a", weight: 9 },
		{ side: "con", text: "b", weight: 3 },
	];
	const t = tally(entries, 5);
	assert.deepEqual([t.pro, t.con, t.total], [5, 3, 8]);
	assert.equal(verdictOf(t), "pro");
	assert.equal(verdictOf(tally([], 5)), "empty");
});

test("diffEntries marks new, changed and moved entries", () => {
	const prev: Entry[] = [
		{ side: "pro", text: "a", weight: 3 },
		{ side: "con", text: "b", weight: 2 },
	];
	const next: Entry[] = [
		{ side: "pro", text: "a", weight: 5 },
		{ side: "pro", text: "b", weight: 2 },
		{ side: "con", text: "c", weight: 1 },
	];
	assert.deepEqual(diffEntries(prev, next), [
		{ kind: "changed", prevWeight: 3 },
		{ kind: "moved" },
		{ kind: "new" },
	]);
	assert.deepEqual(diffEntries(undefined, next), [null, null, null]);
});
