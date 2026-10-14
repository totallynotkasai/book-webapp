import { strToU8, zipSync } from 'fflate';

/**
 * A generated EPUB of `chapters` × `wordsPerChapter` Words (each chapter also has a two-Word
 * heading, "Chapter N"), for the §12.3 budgets: 30 × 5,000 is the 150,000-word import.
 */
export function bigEpub({
	chapters = 30,
	wordsPerChapter = 5_000,
	title = 'Big Test'
}: { chapters?: number; wordsPerChapter?: number; title?: string } = {}): Uint8Array {
	// 21 Words a paragraph.
	const sentence =
		'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do. ';
	const perParagraph = 21;
	const files: Record<string, Uint8Array> = {
		mimetype: strToU8('application/epub+zip'),
		'META-INF/container.xml': strToU8(
			'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
		)
	};
	const ids = Array.from({ length: chapters }, (_, i) => i);
	const paragraphs = Array.from(
		{ length: Math.round((wordsPerChapter - 2) / perParagraph) },
		() => `<p>${sentence}</p>`
	).join('');
	for (const i of ids) {
		files[`OEBPS/c${i}.xhtml`] = strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c${i}</title></head><body><h1>Chapter ${i + 1}</h1>${paragraphs}</body></html>`
		);
	}
	files['OEBPS/content.opf'] = strToU8(
		`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:test:${encodeURIComponent(title)}</dc:identifier><dc:title>${title}</dc:title><dc:language>en</dc:language></metadata><manifest>${ids
			.map((i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`)
			.join(
				''
			)}</manifest><spine>${ids.map((i) => `<itemref idref="c${i}"/>`).join('')}</spine></package>`
	);
	return zipSync(files);
}
