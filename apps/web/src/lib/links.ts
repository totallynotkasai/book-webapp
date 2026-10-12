import { resolve } from '$app/paths';

/**
 * The reader's URL for a Book. Imported Books take their ID from dc:identifier (§6.3), which is
 * often a URL ("http://www.gutenberg.org/…"), and `resolve` doesn't encode params, so the ID is
 * encoded here; the route gets it back decoded.
 */
export function readerHref(bookId: string): string {
	return resolve('/read/[bookId]', { bookId: encodeURIComponent(bookId) });
}
