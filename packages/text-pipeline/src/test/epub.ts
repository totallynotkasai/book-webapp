import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** Builds a minimal EPUB 3 in memory for tests. `chapters` are XHTML bodies or full documents. */
export function makeEpub(options: {
	title?: string;
	identifier?: string | null;
	chapters: Record<string, string>;
	extra?: Record<string, string | Uint8Array>;
	nav?: string | null;
	opfManifest?: string;
	encryption?: string;
}): Uint8Array {
	const ids = Object.keys(options.chapters);
	const doc = (body: string) =>
		body.trimStart().startsWith('<?xml') || body.includes('<html')
			? body
			: `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;
	const nav =
		options.nav === undefined
			? `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${ids
					.map((id, i) => `<li><a href="${id}">Chapter ${i + 1}</a></li>`)
					.join('')}</ol></nav></body></html>`
			: options.nav;
	const identifier =
		options.identifier === null
			? ''
			: `<dc:identifier id="uid">${options.identifier ?? 'urn:test:book'}</dc:identifier>`;
	const files: Record<string, Uint8Array> = {
		mimetype: strToU8('application/epub+zip'),
		'META-INF/container.xml': strToU8(
			'<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
		),
		'OEBPS/content.opf': strToU8(
			`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${identifier}<dc:title>${options.title ?? 'Test Book'}</dc:title><dc:language>en</dc:language><dc:creator>A. Tester</dc:creator></metadata><manifest>${
				nav === null
					? ''
					: '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
			}${ids
				.map((id, i) => `<item id="c${i}" href="${id}" media-type="application/xhtml+xml"/>`)
				.join('')}${options.opfManifest ?? ''}</manifest><spine>${ids
				.map((_, i) => `<itemref idref="c${i}"/>`)
				.join('')}</spine></package>`
		)
	};
	if (nav !== null) files['OEBPS/nav.xhtml'] = strToU8(nav);
	for (const [id, body] of Object.entries(options.chapters))
		files[`OEBPS/${id}`] = strToU8(doc(body));
	for (const [path, data] of Object.entries(options.extra ?? {})) {
		files[path] = typeof data === 'string' ? strToU8(data) : data;
	}
	if (options.encryption) files['META-INF/encryption.xml'] = strToU8(options.encryption);
	return zipSync(files);
}

/** Rewrites files inside an EPUB (an "edited copy" for re-import tests); mimetype stays first. */
export function editEpub(
	bytes: Uint8Array,
	edits: Record<string, (text: string) => string | null>
): Uint8Array {
	const files = unzipSync(bytes);
	const out: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
		mimetype: [files.mimetype ?? strToU8('application/epub+zip'), { level: 0 }]
	};
	for (const [path, data] of Object.entries(files)) {
		if (path === 'mimetype') continue;
		const edit = edits[path];
		if (!edit) {
			out[path] = data;
			continue;
		}
		const next = edit(strFromU8(data));
		if (next !== null) out[path] = strToU8(next);
	}
	return zipSync(out);
}
