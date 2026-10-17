/**
 * Pictures uploaded to the Studio (§7.3, §10.2): their type comes from their content, never the
 * extension, and they can be up to 25 MB.
 */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** The device re-encodes to WebP, but checks don't trust it. */
export function sniffImage(b: Uint8Array): string | null {
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
	const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	return null;
}

export const extensionOf = (type: string) =>
	({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[type] ?? 'bin';
