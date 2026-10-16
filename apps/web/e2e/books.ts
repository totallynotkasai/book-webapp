import { strToU8, zipSync } from 'fflate';

const CONTAINER =
	'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';

/**
 * An EPUB that opens on front matter (a title page, a licence and a contents page) before two
 * chapters, and names no landmark or guide: a reader should start at "Chapter 1" (P1-RDR-09).
 */
export function frontMatterEpub(): Uint8Array {
	const paragraph = `<p>${'The lamps were lit along the quay as the tide came in. '.repeat(20)}</p>`;
	const files: Record<string, string> = {
		'title.xhtml': '<h1>The Quay</h1><p>A test book</p>',
		'licence.xhtml':
			'<h2>Licence</h2><p>This ebook is for the use of anyone anywhere at no cost and with almost no restrictions whatsoever.</p>',
		'contents.xhtml':
			'<h2>Contents</h2><p><a href="chapter-1.xhtml">Chapter 1. Low Tide</a></p><p><a href="chapter-2.xhtml">Chapter 2. High Tide</a></p>',
		'chapter-1.xhtml': `<h2>Chapter 1. Low Tide</h2>${paragraph.repeat(3)}`,
		'chapter-2.xhtml': `<h2>Chapter 2. High Tide</h2>${paragraph.repeat(3)}`
	};
	const toc: [string, string][] = [
		['title.xhtml', 'The Quay'],
		['licence.xhtml', 'Licence'],
		['contents.xhtml', 'Contents'],
		['chapter-1.xhtml', 'Chapter 1. Low Tide'],
		['chapter-2.xhtml', 'Chapter 2. High Tide']
	];
	const names = Object.keys(files);
	return zipSync({
		mimetype: strToU8('application/epub+zip'),
		'META-INF/container.xml': strToU8(CONTAINER),
		'OEBPS/content.opf': strToU8(
			`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:test:the-quay</dc:identifier><dc:title>The Quay</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${names
				.map((n, i) => `<item id="c${i}" href="${n}" media-type="application/xhtml+xml"/>`)
				.join('')}</manifest><spine>${names
				.map((_, i) => `<itemref idref="c${i}"/>`)
				.join('')}</spine></package>`
		),
		'OEBPS/nav.xhtml': strToU8(
			`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${toc
				.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`)
				.join('')}</ol></nav></body></html>`
		),
		...Object.fromEntries(
			Object.entries(files).map(([name, body]) => [
				`OEBPS/${name}`,
				strToU8(
					`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${name}</title></head><body>${body}</body></html>`
				)
			])
		)
	});
}

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
