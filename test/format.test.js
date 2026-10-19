import { test } from "node:test";
import assert from "node:assert/strict";
import { toJSONSafe } from "../lib/stdout.js";
import { fromJSONSafe } from "../extension/deserialize.js";
import { formatArgs } from "../mcp/format.js";

const format = (...args) => formatArgs(JSON.parse(JSON.stringify(args.map((arg) => toJSONSafe(arg)))));

test("formats primitives and plain values like the console", () => {
	assert.equal(format("hello", 42, true, null, undefined), "hello 42 true null undefined");
	assert.equal(format({ a: 1, "b-c": "x" }, [1, "two"]), '{a: 1, "b-c": "x"} [1, "two"]');
	assert.equal(format(10n, NaN, -Infinity), "10n NaN -Infinity");
});

test("applies printf-style substitutions", () => {
	assert.equal(format("%s has %d items (%c50%%)", "cart", 3.7, "color: red"), "cart has 3 items (50%)");
	assert.equal(format("%o", { a: [1] }), "{a: [1]}");
	assert.equal(format("100%", "extra"), "100% extra");
	assert.equal(format("%s %s", "only one"), "only one %s");
});

test("formats special objects", () => {
	const map = new Map([["k", new Set([1])]]);

	assert.equal(format(map), 'Map(1) {"k" => Set(1) {1}}');
	assert.equal(format(new Date(0)), "1970-01-01T00:00:00.000Z");
	assert.equal(format(/a+/g), "/a+/g");
	assert.equal(format(new Uint8Array(4)), "Uint8Array(4)");
});

test("handles cycles without marking shared references as circular", () => {
	const shared = { x: 1 };
	const value = { a: shared, b: shared };

	value.self = value;
	assert.equal(format(value), "{a: {x: 1}, b: {x: 1}, self: [Circular]}");
});

test("formats errors with their stack and extra fields", () => {
	const error = new TypeError("bad thing");

	error.code = 42;

	const text = format("failed:", { cause: error });

	assert.match(text, /^failed: \{cause: TypeError: bad thing\n {4}at /);
	assert.match(text, / \{code: 42\}\}$/);
		// older versions of the library send errors without a stack
	assert.equal(formatArgs([{ __type: "Error", name: "Error", message: "boom" }]), "Error: boom");
});

test("truncates long strings, big arrays and deep nesting", () => {
	assert.match(format("x".repeat(10010)), /… \[10 more chars\]$/);
	assert.match(format(Array.from({ length: 502 }, () => 0)), /, …2 more\]$/);

	let deep = {};

	for (let i = 0; i < 10; i++) {
		deep = { deep };
	}

	assert.match(format(deep), /\[…\]/);
});

test("rebuilds values for display in the stdout extension's console", () => {
	const error = new RangeError("too far");
	const value = fromJSONSafe(JSON.parse(JSON.stringify(toJSONSafe({
		error,
		map: new Map([[1, new Set(["a"])]]),
		date: new Date(0),
		missing: undefined,
		big: 5n,
	}))));

	assert.ok(value.error instanceof Error);
	assert.equal(value.error.name, "RangeError");
	assert.equal(value.error.stack, error.stack);
	assert.deepEqual(value.map, new Map([[1, new Set(["a"])]]));
	assert.deepEqual(value.date, new Date(0));
	assert.ok("missing" in value && value.missing === undefined);
	assert.equal(value.big, 5n);
});
