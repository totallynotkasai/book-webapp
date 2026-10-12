import { describe, expect, it } from 'vitest';
import { relativeHref, resolveInArchive } from './paths';

describe('archive paths', () => {
	it('resolves relative hrefs, fragments and percent-encoding', () => {
		expect(resolveInArchive('OEBPS/text/ch1.xhtml', '../images/a%20b.png')).toEqual({
			path: 'OEBPS/images/a b.png',
			fragment: null
		});
		expect(resolveInArchive('OEBPS/text/ch1.xhtml', 'ch2.xhtml#note-3')).toEqual({
			path: 'OEBPS/text/ch2.xhtml',
			fragment: 'note-3'
		});
	});

	it('refuses anything outside the EPUB', () => {
		expect(resolveInArchive('a.xhtml', 'https://example.com/x.png')).toBeNull();
		expect(resolveInArchive('a.xhtml', '//cdn.example.com/x.css')).toBeNull();
		expect(resolveInArchive('a.xhtml', 'javascript:alert(1)')).toBeNull();
		expect(resolveInArchive('a.xhtml', 'data:image/png;base64,AAAA')).toBeNull();
	});

	it('makes relative hrefs between stored files', () => {
		expect(relativeHref('content/text/ch1.xhtml', 'res/images/a b.png')).toBe(
			'../../res/images/a%20b.png'
		);
		expect(relativeHref('content/ch1.xhtml', 'content/ch2.xhtml')).toBe('ch2.xhtml');
		expect(relativeHref('res/css/book.css', 'res/fonts/f.woff2')).toBe('../fonts/f.woff2');
	});
});
