/**
 * Dev panel test books (plan §6, Phase 1.3 Try-it): an "edited copy" of an Alice EPUB, made on
 * the fly, with one paragraph changed and one deleted in Chapter I. Same dc:identifier, different
 * bytes, so importing it is a new Revision of the Book (P1-ING-03).
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

/** Line breaks in the source vary by edition, so any whitespace between the Words. */
const CHANGED_FROM = /was beginning to get\s+very\s+tired/;
const CHANGED_TO = 'was getting very tired';
/** The paragraph that starts "There was nothing so very remarkable in that". */
const DELETED = /<p[^>]*>\s*There was nothing so[\s\S]*?<\/p>/;

export function editedAlice(bytes: Uint8Array): Uint8Array {
	const files = unzipSync(bytes);
	let edited = false;
	const out: Zippable = {
		// EPUB OCF: "mimetype" first and stored, not compressed.
		mimetype: [files.mimetype ?? strToU8('application/epub+zip'), { level: 0 }]
	};
	for (const [path, data] of Object.entries(files)) {
		if (path === 'mimetype') continue;
		if (/\.x?html?$/i.test(path)) {
			const text = strFromU8(data);
			if (CHANGED_FROM.test(text) && DELETED.test(text)) {
				out[path] = strToU8(text.replace(CHANGED_FROM, CHANGED_TO).replace(DELETED, ''));
				edited = true;
				continue;
			}
		}
		out[path] = data;
	}
	if (!edited) throw new Error('This EPUB doesn’t have the Alice paragraphs the edit expects.');
	return zipSync(out);
}
