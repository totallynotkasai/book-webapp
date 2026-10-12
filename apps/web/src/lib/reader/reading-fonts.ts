/**
 * The reading fonts for the book frames (§11.3). Frames don't inherit the app's stylesheets, so the
 * self-hosted @font-face rules are fetched once and their URLs made absolute (the frames are blob
 * documents; relative URLs would resolve against the blob).
 */
import fontsCssUrl from '@book/tokens/fonts.css?url';

let css: Promise<string> | undefined;

export function readingFontFaces(): Promise<string> {
	css ??= (async () => {
		try {
			const base = new URL(fontsCssUrl, location.href);
			const text = await (await fetch(base)).text();
			return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_, _q, ref: string) => {
				return `url("${new URL(ref, base).href}")`;
			});
		} catch {
			// Without them the book shows in fallback fonts; nothing else breaks.
			return '';
		}
	})();
	return css;
}
