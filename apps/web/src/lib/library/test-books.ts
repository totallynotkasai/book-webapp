/**
 * Dev panel test books. An "edited copy" of an EPUB has one paragraph changed (and, for Alice,
 * one deleted), made on the fly. Same dc:identifier, different bytes: importing it is a new
 * Revision of the Book (P1-ING-03); uploading it in the Studio publishes a new version
 * (P1-STU-01).
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

interface Edit {
	/** Chapter files it applies to. */
	file: RegExp;
	from: RegExp | string;
	to: string;
}

/** Applies every edit to its Chapter, or throws if one doesn't match: the test would mean nothing. */
export function editEpub(bytes: Uint8Array, edits: readonly Edit[]): Uint8Array {
	const files = unzipSync(bytes);
	const done = new Set<Edit>();
	const out: Zippable = {
		// EPUB OCF: "mimetype" first and stored, not compressed.
		mimetype: [files.mimetype ?? strToU8('application/epub+zip'), { level: 0 }]
	};
	for (const [path, data] of Object.entries(files)) {
		if (path === 'mimetype') continue;
		let text: string | null = null;
		for (const edit of edits) {
			if (!edit.file.test(path)) continue;
			text ??= strFromU8(data);
			const next: string = text.replace(edit.from, edit.to);
			if (next !== text) done.add(edit);
			text = next;
		}
		out[path] = text === null ? data : strToU8(text);
	}
	if (done.size !== edits.length)
		throw new Error('This EPUB doesn’t have the text the edit expects.');
	return zipSync(out);
}

/** Line breaks in the source vary by edition, so any whitespace between the Words. */
const ALICE_HTML = /\.x?html?$/i;

/** Alice, Chapter I: one paragraph changed, the one starting "There was nothing so…" deleted. */
export function editedAlice(bytes: Uint8Array): Uint8Array {
	return editEpub(bytes, [
		{ file: ALICE_HTML, from: /was beginning to get\s+very\s+tired/, to: 'was getting very tired' },
		{ file: ALICE_HTML, from: /<p[^>]*>\s*There was nothing so[\s\S]*?<\/p>/, to: '' }
	]);
}

/** The status-window fixture, Chapter 1: one sentence changed. */
export function editedStatusWindow(bytes: Uint8Array): Uint8Array {
	return editEpub(bytes, [
		{
			file: /chapter-1\.xhtml$/,
			from: 'She blinked. The colour stayed.',
			to: 'She blinked twice.'
		}
	]);
}

/** The demo serial, Chapter 2: one paragraph changed. */
export function editedSerial(bytes: Uint8Array): Uint8Array {
	return editEpub(bytes, [
		{
			file: /chapter-2\.xhtml$/,
			from: 'smelled of lamp oil, peppermint and old paper',
			to: 'smelled of lamp oil and old paper'
		}
	]);
}
