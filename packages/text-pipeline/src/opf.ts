/**
 * Reading an EPUB's structure (DESIGN.md §7.1 step 1): container.xml → the package document (OPF)
 * → metadata, manifest, spine, cover, the table of contents from the EPUB 3 nav document or
 * the EPUB 2 NCX, and where the text starts from the nav's landmarks or the EPUB 2 guide.
 */
import { IngestError } from './errors';
import {
	attr,
	byLocalName,
	decodeText,
	findFirst,
	isElement,
	localName,
	normaliseSource,
	parseMarkup,
	parseXml,
	textContent,
	type Element
} from './dom';
import { dirname, resolveInArchive } from './paths';

export interface ManifestItem {
	id: string;
	/** Archive path. */
	path: string;
	mediaType: string;
	properties: string[];
}

export interface SpineItem {
	item: ManifestItem;
	linear: boolean;
}

export interface PackageInfo {
	opfPath: string;
	/** The OPF's folder: a Revision's files are named relative to it. */
	root: string;
	title: string;
	creator: string;
	lang: string;
	identifier: string | null;
	dir: 'ltr' | 'rtl';
	manifest: ManifestItem[];
	spine: SpineItem[];
	coverPath: string | null;
	navPath: string | null;
	ncxPath: string | null;
	/** EPUB 2 `<guide>` references that mark where the text starts (`type="text"`). */
	guide: RawLandmark[];
}

/** A TOC entry before it is resolved to a Word. */
export interface RawTocEntry {
	label: string;
	path: string;
	fragment: string | null;
	depth: number;
}

/** A landmark before it is resolved to a Word: `bodymatter` (EPUB 3 nav) or `text` (EPUB 2 guide). */
export interface RawLandmark {
	type: 'bodymatter' | 'text';
	path: string;
	fragment: string | null;
}

export type ReadFile = (path: string) => Uint8Array | undefined;

function readText(read: ReadFile, path: string): string | undefined {
	const bytes = read(path);
	return bytes ? normaliseSource(decodeText(bytes)) : undefined;
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

export function readPackage(read: ReadFile): PackageInfo {
	const container = readText(read, 'META-INF/container.xml');
	if (!container) {
		throw new IngestError(
			'not_an_epub',
			'This file is a ZIP archive but not an EPUB: it has no META-INF/container.xml.'
		);
	}
	const rootfile = byLocalName(parseXml(container), 'rootfile').find(
		(r) =>
			(attr(r, 'media-type') ?? 'application/oebps-package+xml') === 'application/oebps-package+xml'
	);
	const opfPath = rootfile && attr(rootfile, 'full-path');
	if (!opfPath) {
		throw new IngestError(
			'no_package_document',
			'The EPUB doesn’t say where its package document is (container.xml has no rootfile).'
		);
	}
	const opfText = readText(read, opfPath);
	if (!opfText) {
		throw new IngestError(
			'no_package_document',
			`The EPUB’s package document (${opfPath}) is missing.`
		);
	}
	const opf = parseXml(opfText);
	const pkg = byLocalName(opf, 'package')[0];
	const metadata = byLocalName(opf, 'metadata')[0];
	const manifestEl = byLocalName(opf, 'manifest')[0];
	const spineEl = byLocalName(opf, 'spine')[0];
	if (!pkg || !manifestEl || !spineEl) {
		throw new IngestError(
			'bad_package_document',
			'The EPUB’s package document has no manifest or spine, so its chapters can’t be found.'
		);
	}

	const dc = (name: string) =>
		metadata
			? byLocalName(metadata, name)
					.map((el) => clean(textContent(el)))
					.filter(Boolean)
			: [];
	const uniqueId = attr(pkg, 'unique-identifier');
	const identifiers = metadata ? byLocalName(metadata, 'identifier') : [];
	const identifierEl =
		identifiers.find((el) => uniqueId && attr(el, 'id') === uniqueId) ?? identifiers[0];
	const identifier = identifierEl ? clean(textContent(identifierEl)) || null : null;

	const manifest: ManifestItem[] = [];
	const byId = new Map<string, ManifestItem>();
	for (const el of byLocalName(manifestEl, 'item')) {
		const id = attr(el, 'id');
		const href = attr(el, 'href');
		if (!id || !href) continue;
		const target = resolveInArchive(opfPath, href);
		if (!target) continue;
		const item: ManifestItem = {
			id,
			path: target.path,
			mediaType: (attr(el, 'media-type') ?? '').toLowerCase(),
			properties: (attr(el, 'properties') ?? '').split(/\s+/).filter(Boolean)
		};
		manifest.push(item);
		byId.set(id, item);
	}

	const spine: SpineItem[] = [];
	for (const ref of byLocalName(spineEl, 'itemref')) {
		const item = byId.get(attr(ref, 'idref') ?? '');
		if (item) spine.push({ item, linear: attr(ref, 'linear') !== 'no' });
	}

	// Cover: EPUB 3 `cover-image`, else EPUB 2 <meta name="cover" content="item-id">.
	let cover = manifest.find((m) => m.properties.includes('cover-image'));
	if (!cover && metadata) {
		const meta = byLocalName(metadata, 'meta').find((m) => attr(m, 'name') === 'cover');
		cover = byId.get(attr(meta ?? ({ attribs: {} } as Element), 'content') ?? '');
	}
	const ncxId = attr(spineEl, 'toc');

	const guide: RawLandmark[] = [];
	const guideEl = byLocalName(opf, 'guide')[0];
	for (const ref of guideEl ? byLocalName(guideEl, 'reference') : []) {
		if ((attr(ref, 'type') ?? '').trim().toLowerCase() !== 'text') continue;
		const target = resolveInArchive(opfPath, attr(ref, 'href') ?? '');
		if (target) guide.push({ type: 'text', path: target.path, fragment: target.fragment });
	}

	return {
		opfPath,
		root: dirname(opfPath),
		title: dc('title')[0] ?? '',
		creator: dc('creator').join(' & '),
		lang: dc('language')[0] ?? 'en',
		identifier,
		dir: attr(spineEl, 'page-progression-direction') === 'rtl' ? 'rtl' : 'ltr',
		manifest,
		spine,
		coverPath: cover && cover.mediaType.startsWith('image/') ? cover.path : null,
		navPath: manifest.find((m) => m.properties.includes('nav'))?.path ?? null,
		ncxPath:
			(ncxId ? byId.get(ncxId)?.path : undefined) ??
			manifest.find((m) => m.mediaType === 'application/x-dtbncx+xml')?.path ??
			null,
		guide
	};
}

const epubTypes = (el: Element) =>
	(attr(el, 'epub:type') ?? attr(el, 'type') ?? '').toLowerCase().split(/\s+/);

/**
 * Where the EPUB says its text starts, in reading order: the EPUB 3 nav's `landmarks` links
 * marked `bodymatter`, then the EPUB 2 guide's `text` references.
 */
export function readLandmarks(read: ReadFile, pkg: PackageInfo): RawLandmark[] {
	const landmarks: RawLandmark[] = [];
	const text = pkg.navPath ? readText(read, pkg.navPath) : undefined;
	if (text) {
		const navs = byLocalName(parseMarkup(text), 'nav').filter((n) =>
			epubTypes(n).includes('landmarks')
		);
		for (const a of navs.flatMap((nav) => byLocalName(nav, 'a'))) {
			if (!epubTypes(a).includes('bodymatter')) continue;
			const target = resolveInArchive(pkg.navPath!, attr(a, 'href') ?? '');
			if (target)
				landmarks.push({ type: 'bodymatter', path: target.path, fragment: target.fragment });
		}
	}
	return [...landmarks, ...pkg.guide];
}

/** The table of contents: the EPUB 3 nav `toc`, else the NCX, else nothing. */
export function readToc(read: ReadFile, pkg: PackageInfo): RawTocEntry[] {
	if (pkg.navPath) {
		const text = readText(read, pkg.navPath);
		if (text) {
			const entries = navToc(text, pkg.navPath);
			if (entries.length) return entries;
		}
	}
	if (pkg.ncxPath) {
		const text = readText(read, pkg.ncxPath);
		if (text) return ncxToc(text, pkg.ncxPath);
	}
	return [];
}

function navToc(text: string, navPath: string): RawTocEntry[] {
	const doc = parseMarkup(text);
	const navs = byLocalName(doc, 'nav');
	const toc =
		navs.find((n) =>
			(attr(n, 'epub:type') ?? attr(n, 'type') ?? '').split(/\s+/).includes('toc')
		) ?? navs[0];
	if (!toc) return [];
	const list = findFirst(toc, (el) => localName(el) === 'ol' || localName(el) === 'ul');
	const entries: RawTocEntry[] = [];
	const walk = (ol: Element, depth: number) => {
		for (const li of ol.children) {
			if (!isElement(li) || localName(li) !== 'li') continue;
			const a = li.children.find(
				(c): c is Element => isElement(c) && (localName(c) === 'a' || localName(c) === 'span')
			);
			const target =
				a && localName(a) === 'a' ? resolveInArchive(navPath, attr(a, 'href') ?? '') : null;
			if (a && target) {
				entries.push({
					label: clean(textContent(a)),
					path: target.path,
					fragment: target.fragment,
					depth
				});
			}
			const nested = li.children.find(
				(c): c is Element => isElement(c) && (localName(c) === 'ol' || localName(c) === 'ul')
			);
			if (nested) walk(nested, a && target ? depth + 1 : depth);
		}
	};
	if (list) walk(list, 0);
	return entries;
}

function ncxToc(text: string, ncxPath: string): RawTocEntry[] {
	const doc = parseXml(text);
	const navMap = byLocalName(doc, 'navMap')[0] ?? byLocalName(doc, 'navmap')[0];
	if (!navMap) return [];
	const entries: RawTocEntry[] = [];
	const walk = (parent: Element, depth: number) => {
		for (const point of parent.children) {
			if (!isElement(point) || localName(point) !== 'navpoint') continue;
			const label = findFirst(point, (el) => localName(el) === 'text');
			const content = findFirst(point, (el) => localName(el) === 'content');
			const target = content ? resolveInArchive(ncxPath, attr(content, 'src') ?? '') : null;
			if (target) {
				entries.push({
					label: clean(label ? textContent(label) : ''),
					path: target.path,
					fragment: target.fragment,
					depth
				});
			}
			walk(point, depth + 1);
		}
	};
	walk(navMap, 0);
	return entries;
}

/** True when META-INF/encryption.xml encrypts anything but fonts (that's DRM). */
export function isEncrypted(read: ReadFile): boolean {
	const text = readText(read, 'META-INF/encryption.xml');
	if (!text) return false;
	const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];
	const methods = byLocalName(parseXml(text), 'EncryptionMethod').concat(
		byLocalName(parseXml(text), 'encryptionmethod')
	);
	return methods.some(
		(m) => !FONT_OBFUSCATION.includes(attr(m, 'Algorithm') ?? attr(m, 'algorithm') ?? '')
	);
}
