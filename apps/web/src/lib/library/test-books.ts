/**
 * Dev panel test books. An "edited copy" of an EPUB has one paragraph changed (and, for Alice,
 * one deleted), made on the fly. Same dc:identifier, different bytes: importing it is a new
 * Revision of the Book (P1-ING-03); uploading it in the Studio publishes a new version
 * (P1-STU-01). The demo serial's next version adds a seventh Chapter (P1-STU-06).
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

interface Edit {
	/** Chapter files it applies to. */
	file: RegExp;
	from: RegExp | string;
	to: string;
}

/**
 * Applies every edit to its file, or throws if one doesn't match: the test would mean nothing.
 * `added` files (path → text) are new ones, such as a Chapter.
 */
export function editEpub(
	bytes: Uint8Array,
	edits: readonly Edit[],
	added: Readonly<Record<string, string>> = {}
): Uint8Array {
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
	for (const [path, text] of Object.entries(added)) {
		if (out[path]) throw new Error(`This EPUB already has ${path}.`);
		out[path] = strToU8(text);
	}
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

/** The status-window fixture under another title: a different file, so a different Book. */
export function retitledStatusWindow(bytes: Uint8Array, title: string): Uint8Array {
	return editEpub(bytes, [
		{
			file: /.opf$/,
			from: '<dc:title>Status Window Test Fixture</dc:title>',
			to: `<dc:title>${title}</dc:title>`
		}
	]);
}

/**
 * The demo serial's next version (P1-STU-06): the seeded Ledger with `chapter` (the XHTML of
 * fixtures/src/lamplighters-ledger-next/chapter-7.xhtml) added as its seventh Chapter.
 */
export function serialWithNextChapter(bytes: Uint8Array, chapter: string): Uint8Array {
	const opf = /\.opf$/;
	return editEpub(
		bytes,
		[
			{
				file: opf,
				from: /(<item id="chapter-6"[^>]*\/>)/,
				to: '$1\n\t\t<item id="chapter-7" href="text/chapter-7.xhtml" media-type="application/xhtml+xml"/>'
			},
			{
				file: opf,
				from: '<itemref idref="chapter-6"/>',
				to: '<itemref idref="chapter-6"/>\n\t\t<itemref idref="chapter-7"/>'
			},
			{
				file: opf,
				from: 'Chapters 1 to 6; to be continued.',
				to: 'Chapters 1 to 7; to be continued.'
			},
			{
				file: /nav\.xhtml$/,
				from: /(<li><a href="text\/chapter-6\.xhtml">[^<]*<\/a><\/li>)/,
				to: '$1\n\t\t\t<li><a href="text/chapter-7.xhtml">7. The Night Round</a></li>'
			}
		],
		{ 'OEBPS/text/chapter-7.xhtml': chapter }
	);
}
