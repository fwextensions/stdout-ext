const DBName = "stdout";
const DBVersion = 1;
const LogStore = "logs";
const MetaStore = "meta";
	// keep roughly this many of the most recent entries
const MaxEntries = 10000;

let dbPromise = null;

function promisify(
	request)
{
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function transactionDone(
	transaction)
{
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = transaction.onabort = () => reject(transaction.error);
	});
}

function openDB()
{
	if (!dbPromise) {
		const request = indexedDB.open(DBName, DBVersion);

		request.onupgradeneeded = () => {
			request.result.createObjectStore(LogStore, { keyPath: "seq", autoIncrement: true });
			request.result.createObjectStore(MetaStore)
					// identify this copy of the buffer, so the MCP server can tell when
					// the sequence numbers have started over
				.put(crypto.randomUUID(), "bufferId");
		};

		dbPromise = promisify(request);
		dbPromise.catch(() => dbPromise = null);
	}

	return dbPromise;
}

/**
 * Store a log entry and drop the oldest ones beyond the size limit.
 *
 * @param {object} entry
 * @returns {Promise<number>} The entry's sequence number.
 */
export async function addEntry(
	entry)
{
	const db = await openDB();
	const transaction = db.transaction(LogStore, "readwrite");
	const store = transaction.objectStore(LogStore);
	const seq = await promisify(store.add(entry));

	if (seq > MaxEntries) {
		store.delete(IDBKeyRange.upperBound(seq - MaxEntries));
	}

	await transactionDone(transaction);

	return seq;
}

/**
 * @param {number} afterSeq  Return entries with a greater sequence number.
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
export async function getEntriesAfter(
	afterSeq,
	limit)
{
	const db = await openDB();

	return promisify(db.transaction(LogStore).objectStore(LogStore)
		.getAll(IDBKeyRange.lowerBound(afterSeq, true), limit));
}

/**
 * @returns {Promise<string>}
 */
export async function getBufferId()
{
	const db = await openDB();

	return promisify(db.transaction(MetaStore).objectStore(MetaStore).get("bufferId"));
}
