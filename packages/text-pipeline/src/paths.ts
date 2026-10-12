/** Paths inside an EPUB: POSIX, relative to the archive root, percent-decoded. */

const BASE = 'https://epub.invalid/';

/** Resolves `href` against the file at `from`. Returns null for anything outside the EPUB. */
export function resolveInArchive(
	from: string,
	href: string
): { path: string; fragment: string | null } | null {
	if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
	let url: URL;
	try {
		url = new URL(href, BASE + encodePath(from));
	} catch {
		return null;
	}
	if (url.origin !== new URL(BASE).origin) return null;
	let path: string;
	try {
		path = decodeURIComponent(url.pathname.slice(1));
	} catch {
		path = url.pathname.slice(1);
	}
	const fragment = url.hash ? decodeURIComponent(url.hash.slice(1)) : null;
	return { path, fragment };
}

export function dirname(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash >= 0 ? path.slice(0, slash + 1) : '';
}

/** Percent-encodes each segment, keeping `/`, for use in an href. */
export function encodePath(path: string): string {
	return path
		.split('/')
		.map((segment) => encodeURIComponent(segment).replace(/%40/g, '@'))
		.join('/');
}

/** The relative href from the file at `from` to the file at `to` (both archive-relative). */
export function relativeHref(from: string, to: string): string {
	const fromParts = from.split('/').slice(0, -1);
	const toParts = to.split('/');
	let common = 0;
	while (
		common < fromParts.length &&
		common < toParts.length - 1 &&
		fromParts[common] === toParts[common]
	) {
		common++;
	}
	const up = fromParts.length - common;
	return encodePath([...Array<string>(up).fill('..'), ...toParts.slice(common)].join('/'));
}

/** Paths relative to the OPF folder, which is how a Revision's files are named (§6.7). */
export function relativeTo(root: string, path: string): string {
	return root && path.startsWith(root) ? path.slice(root.length) : path;
}
