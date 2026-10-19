const SubstitutionPattern = /%([sdifoOcj%])/g;
	// a separate non-global regex for testing, since test() on a global one is
	// stateful
const HasSubstitutionPattern = /%[sdifoOcj]/;

function formatKey(
	key)
{
	return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * Render a value produced by toJSONSafe() in the extension roughly the way the
 * devtools console would show it, as a single compact string.
 *
 * @param {any} value
 * @param {boolean} [topLevel]  Top-level strings are shown without quotes.
 * @returns {string}
 */
export function formatValue(
	value,
	topLevel = false)
{
	if (typeof value === "string") {
		return topLevel ? value : JSON.stringify(value);
	}

	if (value === null || typeof value !== "object") {
		return String(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => formatValue(item)).join(", ")}]`;
	}

	switch (value.__type) {
		case "undefined":
			return "undefined";

		case "bigint":
			return `${value.value}n`;

		case "number":
		case "symbol":
		case "function":
		case "RegExp":
		case "Date":
			return value.value;

		case "Error": {
			const { __type, name, message, stack, ...rest } = value;
				// V8 stacks already start with "Name: message"
			const text = stack || `${name}: ${message}`;
			const extra = Object.keys(rest).length ? ` ${formatValue(rest)}` : "";

			return text + extra;
		}

		case "Map":
			return `Map(${value.size}) {${value.entries
				.map(([key, item]) => `${formatValue(key)} => ${formatValue(item)}`).join(", ")}}`;

		case "Set":
			return `Set(${value.size}) {${value.values.map((item) => formatValue(item)).join(", ")}}`;

		case "Circular":
			return "[Circular]";

		case "Truncated":
			return "[…]";

		case "More":
			return `…${value.count} more`;

		case undefined:
			break;

		default:
			if ("byteLength" in value) {
				return `${value.__type}(${value.byteLength})`;
			}
	}

	const entries = Object.entries(value)
		.map(([key, item]) => `${formatKey(key)}: ${formatValue(item)}`);

	return `{${entries.join(", ")}}`;
}

/**
 * Format the arguments of a console call as one line of text, applying
 * printf-style substitutions in the first argument like the console does.
 *
 * @param {any[]} args
 * @returns {string}
 */
export function formatArgs(
	args)
{
	if (!args.length) {
		return "";
	}

	let [first, ...rest] = args;
	const parts = [];

	if (typeof first === "string" && rest.length && HasSubstitutionPattern.test(first)) {
		first = first.replace(SubstitutionPattern, (match, type) => {
			if (type === "%") {
				return "%";
			}

			if (!rest.length) {
				return match;
			}

			const arg = rest.shift();

			switch (type) {
				case "c":
						// CSS styling doesn't mean anything here
					return "";

				case "d":
				case "i":
					return typeof arg === "number" ? String(Math.trunc(arg)) : "NaN";

				case "f":
					return typeof arg === "number" ? String(arg) : "NaN";

				case "s":
					return formatValue(arg, true);

				default:
					return formatValue(arg);
			}
		});
	}

	parts.push(formatValue(first, true), ...rest.map((arg) => formatValue(arg, true)));

	return parts.join(" ");
}
