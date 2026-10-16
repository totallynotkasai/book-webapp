/**
 * `ingestEpub`: one EPUB in, one processed Revision out (DESIGN.md §7.1). Pure and deterministic:
 * the same bytes and options always give byte-identical files, in Chromium, WebKit and Node.
 * Runs in a Web Worker for imports and for backend-local's catalogue, and in the Phase 2 worker.
 */
import {
	MANIFEST_VERSION,
	TOKENISER_VERSION,
	WORD_INDEX_VERSION,
	ingestWarningCodes,
	revisionPaths,
	type ChapterRecord,
	type IngestReport,
	type IngestWarning,
	type IngestWarningCode,
	type Landmark,
	type ResourceRecord,
	type RevisionManifest,
	type TocEntry,
	type WordIndex
} from '@book/core';
import { unzipSync } from 'fflate';
import { assignWordIds } from './carry';
import { blockHash, markChapter, sha256Hex, type MarkedChapter } from './chapter';
import { sanitiseStylesheet } from './css';
import {
	decodeText,
	isElement,
	localName,
	normaliseSource,
	parseMarkup,
	serialize,
	SVG_NS,
	XLINK_NS
} from './dom';
import { IngestError } from './errors';
import { isEncrypted, readLandmarks, readPackage, readToc, type ManifestItem } from './opf';
import { relativeHref, relativeTo, resolveInArchive } from './paths';
import type { RevisionWords } from './revision';
import { sanitiseDocument, sanitiseSvg } from './sanitise';

export interface IngestOptions {
	/** The Book's ID. Defaults to the EPUB's dc:identifier, then `newBookId()`. */
	bookId?: string;
	/** Makes an ID for an EPUB without dc:identifier (e.g. a UUIDv7, §6.3). */
	newBookId?: () => string;
	/** The first WordId to assign: 1 for a new Book, the Book's counter for a later Revision. */
	firstWordId?: number;
	/**
	 * The Book's current Revision, when this EPUB is a new version of it: unchanged Words keep
	 * their WordIds and new ones continue from its counter (§6.2).
	 */
	previous?: RevisionWords;
	/** Upload limit (§10.2): 100 MB. */
	maxBytes?: number;
	/** Called after each Chapter: done / total. */
	onProgress?: (done: number, total: number) => void;
}

export interface IngestedFile {
	path: string;
	mediaType: string;
	data: Uint8Array;
}

export interface IngestResult {
	bookId: string;
	revisionId: string;
	manifest: RevisionManifest;
	report: IngestReport;
	/** Every file of the Revision (§6.7 layout), sorted by path. */
	files: IngestedFile[];
}

export const MAX_EPUB_BYTES = 100 * 1024 * 1024;

const XHTML_TYPES = new Set(['application/xhtml+xml', 'text/html', 'application/xml']);
const FONT_TYPES = /^(font\/|application\/(font-|x-font-|vnd\.ms-opentype|x-truetype))/;
const encoder = new TextEncoder();

/** Image types from content, not the extension (§10.2). */
function sniffImage(bytes: Uint8Array): string | null {
	const b = bytes;
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
	if (
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45
	)
		return 'image/webp';
	const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart();
	if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head))
		return 'image/svg+xml';
	return null;
}

const WARNING_TEXT: Record<IngestWarningCode, [IngestWarning['severity'], (n: number) => string]> =
	{
		script_removed: [
			'info',
			(n) => `Removed ${n} ${plural(n, 'script')}. Books can’t run code in this reader.`
		],
		unsafe_element_removed: [
			'info',
			(n) =>
				`Removed ${n} interactive or embedded ${plural(n, 'element')}, such as forms or frames.`
		],
		unsafe_attribute_removed: [
			'info',
			(n) =>
				`Removed ${n} unsafe ${plural(n, 'attribute')}, such as event handlers or script links.`
		],
		external_resource_removed: [
			'warning',
			(n) =>
				`Removed ${n} ${plural(n, 'reference')} to files outside the book, such as online images or web fonts.`
		],
		css_removed: [
			'info',
			(n) => `Removed ${n} style ${plural(n, 'rule')} this reader doesn’t use.`
		],
		missing_resource: [
			'warning',
			(n) =>
				`${n} ${plural(n, 'image or style file', 'images or style files')} the book refers to ${n === 1 ? 'is' : 'are'} missing from it.`
		],
		missing_alt: [
			'warning',
			(n) =>
				`${n} ${plural(n, 'image has', 'images have')} no alt text, so screen readers can’t describe ${n === 1 ? 'it' : 'them'}.`
		],
		malformed_xhtml: [
			'warning',
			(n) =>
				`${n} ${plural(n, 'chapter wasn’t', 'chapters weren’t')} valid XHTML and had to be repaired.`
		],
		unsupported_media_removed: [
			'warning',
			(n) =>
				`Removed ${n} audio or video ${plural(n, 'element')}. Narration comes from Narration add-ons instead.`
		],
		no_toc: ['info', () => 'The book has no table of contents, so one was made from its chapters.']
	};

function plural(n: number, one: string, many = `${one}s`): string {
	return n === 1 ? one : many;
}

export async function ingestEpub(
	bytes: Uint8Array,
	options: IngestOptions = {}
): Promise<IngestResult> {
	if (bytes.byteLength > (options.maxBytes ?? MAX_EPUB_BYTES)) {
		throw new IngestError(
			'too_large',
			'This EPUB is larger than 100 MB, the most this reader can import.'
		);
	}
	let archive: Record<string, Uint8Array>;
	try {
		archive = unzipSync(bytes);
	} catch {
		throw new IngestError(
			'not_a_zip',
			'This file isn’t an EPUB: it can’t be opened as a ZIP archive. It may be damaged or a different kind of file.'
		);
	}
	const entries = new Map<string, Uint8Array>();
	for (const [name, data] of Object.entries(archive)) {
		if (!name.endsWith('/')) entries.set(name.replace(/\\/g, '/').replace(/^\.\//, ''), data);
	}
	const read = (path: string) => entries.get(path);
	if (isEncrypted(read)) {
		throw new IngestError(
			'encrypted',
			'This EPUB is protected by DRM, so it can’t be imported. Only DRM-free EPUBs can be read here.'
		);
	}

	const pkg = readPackage(read);
	const revisionId = await sha256Hex(bytes);
	const bookId = options.bookId ?? pkg.identifier ?? options.newBookId?.();
	if (!bookId) throw new Error('ingestEpub needs a bookId for an EPUB without dc:identifier.');
	const rel = (path: string) => relativeTo(pkg.root, path);

	// Warnings, counted per code, remembering the Chapters they came from.
	const warnings = new Map<IngestWarningCode, { count: number; chapters: Set<string> }>();
	let currentChapter: string | null = null;
	const warn = (code: IngestWarningCode, count = 1) => {
		const entry = warnings.get(code) ?? { count: 0, chapters: new Set<string>() };
		entry.count += count;
		if (currentChapter) entry.chapters.add(currentChapter);
		warnings.set(code, entry);
	};

	const files: IngestedFile[] = [];
	const addFile = (path: string, mediaType: string, data: Uint8Array | string) =>
		files.push({ path, mediaType, data: typeof data === 'string' ? encoder.encode(data) : data });

	// ---- Chapters to process: spine items that are XHTML ----
	const spine = pkg.spine.filter((s) => XHTML_TYPES.has(s.item.mediaType) && read(s.item.path));
	const chapterPaths = new Set(spine.map((s) => s.item.path));

	// ---- Resources: images, stylesheets and fonts (sanitised; types sniffed from content) ----
	const resources: ResourceRecord[] = [];
	const resourcePaths = new Set<string>();
	const resourceItems = pkg.manifest.filter(
		(m) =>
			!chapterPaths.has(m.path) &&
			(m.mediaType.startsWith('image/') ||
				m.mediaType === 'text/css' ||
				FONT_TYPES.test(m.mediaType))
	);
	// Stylesheets are rewritten relative to their own location, so collect every path first.
	const included = new Map<string, { item: ManifestItem; mediaType: string; data: Uint8Array }>();
	for (const item of resourceItems) {
		const data = read(item.path);
		if (!data) continue;
		let mediaType = item.mediaType;
		if (mediaType.startsWith('image/')) {
			const sniffed = sniffImage(data);
			if (!sniffed) continue;
			mediaType = sniffed;
		}
		included.set(item.path, { item, mediaType, data });
		resourcePaths.add(item.path);
	}
	for (const [path, { mediaType, data }] of [...included].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0
	)) {
		const out = revisionPaths.resource(rel(path));
		let stored: Uint8Array | string = data;
		if (mediaType === 'text/css') {
			const result = sanitiseStylesheet(normaliseSource(decodeText(data)), {
				resolveUrl: (url) => {
					const target = resolveInArchive(path, url);
					return target && resourcePaths.has(target.path)
						? relativeHref(out, revisionPaths.resource(rel(target.path)))
						: null;
				}
			});
			if (result.removed) warn('css_removed', result.removed);
			stored = result.css;
		} else if (mediaType === 'image/svg+xml') {
			stored = sanitiseSvgFile(
				data,
				path,
				(target) =>
					resourcePaths.has(target) ? relativeHref(out, revisionPaths.resource(rel(target))) : null,
				warn
			);
		}
		const encoded = typeof stored === 'string' ? encoder.encode(stored) : stored;
		addFile(out, mediaType, encoded);
		resources.push({ path: rel(path), mediaType, bytes: encoded.byteLength });
	}

	// ---- The table of contents, before Chapters (it gives them their titles) ----
	const rawToc = readToc(read, pkg);

	// ---- Chapters: sanitise and tokenise each, then give their Words IDs (carried forward) ----
	const drafts: {
		chapterId: string;
		spineIndex: number;
		linear: boolean;
		path: string;
		marked: MarkedChapter;
	}[] = [];
	for (const [spineIndex, { item, linear }] of spine.entries()) {
		const chapterId = rel(item.path);
		currentChapter = chapterId;
		const contentPath = revisionPaths.chapter(chapterId);
		const doc = parseMarkup(normaliseSource(decodeText(read(item.path)!)));
		const { html, body } = sanitiseDocument(doc, {
			path: item.path,
			resourceHref: (target) =>
				resourcePaths.has(target)
					? relativeHref(contentPath, revisionPaths.resource(rel(target)))
					: null,
			documentHref: (target, fragment) =>
				chapterPaths.has(target)
					? relativeHref(contentPath, revisionPaths.chapter(rel(target))) +
						(fragment ? `#${encodeURIComponent(fragment)}` : '')
					: null,
			warn
		});
		const marked = markChapter(body, 1);
		drafts.push({ chapterId, spineIndex, linear, path: item.path, marked });
		addFile(
			contentPath,
			'application/xhtml+xml',
			`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n${serialize(html)}\n`
		);
		options.onProgress?.(spineIndex + 1, spine.length);
	}
	currentChapter = null;

	const assigned = assignWordIds(
		drafts.map((d) => ({ chapterId: d.chapterId, texts: d.marked.wordTexts })),
		options.previous,
		options.firstWordId ?? 1
	);
	const nextWordId = assigned.nextWordId;
	const chapters: ChapterRecord[] = [];
	const idMaps = new Map<string, Map<string, number>>();
	let ordinal = 0;
	for (const [d, { chapterId, spineIndex, linear, path, marked }] of drafts.entries()) {
		const ids = assigned.ids[d]!;
		marked.words = marked.words.map(([, b, start, end], i) => [ids[i]!, b, start, end]);
		const blocks = await Promise.all(
			marked.blockTexts.map(async (text, b) => ({
				b,
				len: text.length,
				sha: await blockHash(text)
			}))
		);
		const wordIndex: WordIndex = {
			version: WORD_INDEX_VERSION,
			revisionId,
			chapterId,
			firstOrdinal: ordinal,
			blocks,
			words: marked.words
		};
		const count = marked.words.length;
		const tocTitle =
			rawToc.find((t) => t.path === path && !t.fragment)?.label ??
			rawToc.find((t) => t.path === path)?.label;
		chapters.push({
			chapterId,
			href: chapterId,
			spineIndex,
			linear,
			title: tocTitle || marked.heading || '',
			wordCount: count,
			firstWordId: count ? marked.words[0]![0] : null,
			lastWordId: count ? marked.words[count - 1]![0] : null,
			firstOrdinal: ordinal,
			lastOrdinal: ordinal + count - 1
		});
		idMaps.set(path, marked.idWordIndex);
		ordinal += count;
		addFile(revisionPaths.wordIndex(chapterId), 'application/json', JSON.stringify(wordIndex));
	}
	if (ordinal === 0) {
		throw new IngestError(
			'no_readable_chapters',
			'This EPUB has no readable text: its chapters are empty or aren’t XHTML.'
		);
	}

	// ---- TOC entries and landmarks resolved to the first Word at or after their target ----
	const resolve = (path: string, fragment: string | null) => {
		const chapter = chapters.find((c) => c.chapterId === rel(path));
		if (!chapter) return null;
		let offset = 0;
		if (fragment) offset = idMaps.get(path)?.get(fragment) ?? 0;
		const last = Math.max(chapter.firstOrdinal, chapter.lastOrdinal);
		return { chapter, ordinal: Math.min(chapter.firstOrdinal + offset, last) };
	};
	let toc: TocEntry[] = [];
	for (const entry of rawToc) {
		const target = resolve(entry.path, entry.fragment);
		if (!target) continue;
		toc.push({
			label: entry.label || target.chapter.title,
			chapterId: target.chapter.chapterId,
			fragment: entry.fragment,
			ordinal: target.ordinal,
			depth: entry.depth
		});
	}
	const landmarks: Landmark[] = [];
	for (const landmark of readLandmarks(read, pkg)) {
		const target = resolve(landmark.path, landmark.fragment);
		if (!target) continue;
		landmarks.push({
			type: landmark.type,
			chapterId: target.chapter.chapterId,
			fragment: landmark.fragment,
			ordinal: target.ordinal
		});
	}
	if (toc.length === 0) {
		warn('no_toc');
		toc = chapters
			.filter((c) => c.linear && c.wordCount > 0)
			.map((c, i) => ({
				label: c.title || `Section ${i + 1}`,
				chapterId: c.chapterId,
				fragment: null,
				ordinal: c.firstOrdinal,
				depth: 0
			}));
	}
	// Chapters without any title take the label of the TOC entry that points into them.
	for (const chapter of chapters) {
		if (!chapter.title)
			chapter.title = toc.find((t) => t.chapterId === chapter.chapterId)?.label ?? '';
	}

	const manifest: RevisionManifest = {
		version: MANIFEST_VERSION,
		bookId,
		revisionId,
		tokeniserVersion: TOKENISER_VERSION,
		title: pkg.title || chapters.find((c) => c.title)?.title || 'Untitled',
		creator: pkg.creator,
		lang: pkg.lang,
		dir: pkg.dir,
		identifier: pkg.identifier,
		chapters,
		toc,
		// Only when there are any, so Revisions of EPUBs without them are unchanged byte for byte.
		...(landmarks.length ? { landmarks } : {}),
		resources,
		coverPath: pkg.coverPath && resourcePaths.has(pkg.coverPath) ? rel(pkg.coverPath) : null,
		wordCount: ordinal,
		nextWordId,
		...(options.previous
			? { previousRevisionId: options.previous.revisionId, deletedWordIds: assigned.deleted }
			: {})
	};
	addFile(revisionPaths.manifest, 'application/json', JSON.stringify(manifest));

	const report: IngestReport = {
		title: manifest.title,
		chapterCount: chapters.filter((c) => c.wordCount > 0).length,
		wordCount: ordinal,
		imageCount: resources.filter((r) => r.mediaType.startsWith('image/')).length,
		warnings: ingestWarningCodes
			.filter((code) => warnings.has(code))
			.map((code) => {
				const { count, chapters: ids } = warnings.get(code)!;
				const [severity, text] = WARNING_TEXT[code];
				return { code, severity, message: text(count), count, chapterIds: [...ids].sort() };
			})
	};

	files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	return { bookId, revisionId, manifest, report, files };
}

/** An SVG image file, sanitised like inline SVG. */
function sanitiseSvgFile(
	data: Uint8Array,
	path: string,
	resourceHref: (archivePath: string) => string | null,
	warn: (code: IngestWarningCode, count?: number) => void
): string {
	const doc = parseMarkup(normaliseSource(decodeText(data)));
	const svg = doc.children.find((c) => isElement(c) && localName(c) === 'svg');
	if (!svg || !isElement(svg)) return `<svg xmlns="${SVG_NS}"/>`;
	sanitiseSvg(
		svg,
		{ path, resourceHref, documentHref: () => null, warn },
		{
			resolveUrl: (url) => {
				const target = resolveInArchive(path, url);
				return target ? resourceHref(target.path) : null;
			}
		}
	);
	svg.attribs.xmlns = SVG_NS;
	svg.attribs['xmlns:xlink'] = XLINK_NS;
	return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(svg)}\n`;
}
