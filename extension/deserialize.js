/**
 * Rebuild the values that the stdout() library converted to send them as JSON,
 * as best we can, so they display naturally in this extension's console.
 *
 * @param {any} value
 * @returns {any}
 */
export function fromJSONSafe(
	value)
{
	if (Array.isArray(value)) {
		return value.map(fromJSONSafe);
	}

	if (!value || typeof value !== "object") {
		return value;
	}

	switch (value.__type) {
		case "undefined":
			return undefined;

		case "bigint":
			return BigInt(value.value);

		case "number":
			return Number(value.value);

		case "Date":
			return new Date(value.value);

		case "Map":
			return new Map(value.entries.map(([key, item]) => [fromJSONSafe(key), fromJSONSafe(item)]));

		case "Set":
			return new Set(value.values.map(fromJSONSafe));

		case "Error": {
			const { __type, name, message, stack, ...rest } = value;
			const error = new Error(message);

			Object.assign(error, { name, stack }, fromJSONSafe(rest));

			return error;
		}

		case "symbol":
		case "function":
		case "RegExp":
			return value.value;

		case "Circular":
			return "[Circular]";

		case "Truncated":
			return "[…]";

		case "More":
			return `…${value.count} more`;
	}

	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromJSONSafe(item)]));
}
