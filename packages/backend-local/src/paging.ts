import { BackendError, DEFAULT_PAGE_SIZE, type Page, type PageRequest } from '@book/core';

// Cursors are opaque to callers. Locally they encode an offset; the API may use anything.
function encode(offset: number): string {
	return btoa(`o:${offset}`);
}

function decode(cursor: string): number {
	let decoded: string;
	try {
		decoded = atob(cursor);
	} catch {
		throw new BackendError('VALIDATION_FAILED', 'That page cursor is not valid.');
	}
	const match = /^o:(\d+)$/.exec(decoded);
	if (!match) throw new BackendError('VALIDATION_FAILED', 'That page cursor is not valid.');
	return Number(match[1]);
}

export function paginate<T>(items: readonly T[], request: PageRequest = {}): Page<T> {
	const start = request.cursor ? decode(request.cursor) : 0;
	const limit = request.limit ?? DEFAULT_PAGE_SIZE;
	const end = start + limit;
	return {
		items: items.slice(start, end),
		nextCursor: end < items.length ? encode(end) : null
	};
}
