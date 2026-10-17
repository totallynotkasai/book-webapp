/**
 * Pictures prepared on the device before they're uploaded (plan §6 Phase 1.7 UX notes, §7.3):
 * decoded and drawn again, which drops EXIF and anything else embedded; saved as WebP at a few
 * widths (never wider than the original); with a colour to show while each loads. Browsers that
 * can't encode WebP (Safari) save JPEG instead, which drops the same things.
 *
 * Phase 3 does this on the server with sharp (`process-image`); the upload shape stays the same.
 */
import type { ImageUpload } from '@book/core';

/** §7.3: 640, 1280 and 2048 px on the long edge. */
const WIDTHS = [640, 1280, 2048];
const QUALITY = 0.8;
/** §10.2. */
const MAX_BYTES = 25 * 1024 * 1024;

export class ImageProblem extends Error {}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

async function draw(bitmap: ImageBitmap, width: number): Promise<Blob> {
	const height = Math.round((bitmap.height * width) / bitmap.width);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new ImageProblem('This device can’t prepare pictures.');
	context.drawImage(bitmap, 0, 0, width, height);
	const webp = await encode(canvas, 'image/webp');
	if (webp?.type === 'image/webp') return webp;
	const jpeg = await encode(canvas, 'image/jpeg');
	if (!jpeg) throw new ImageProblem('This picture couldn’t be prepared. Try another file.');
	return jpeg;
}

/** The picture's average colour, as a placeholder while it loads (§7.3 "dominant colour"). */
function dominant(bitmap: ImageBitmap): string {
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext('2d');
	if (!context) return '#808080';
	context.drawImage(bitmap, 0, 0, 1, 1);
	const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
	return `#${[r, g, b].map((c) => (c ?? 128).toString(16).padStart(2, '0')).join('')}`;
}

async function decode(file: Blob): Promise<ImageBitmap> {
	if (file.size > MAX_BYTES) throw new ImageProblem('Pictures can be up to 25 MB.');
	try {
		return await createImageBitmap(file);
	} catch {
		throw new ImageProblem('That file isn’t a picture this device can open (try JPEG or PNG).');
	}
}

/** An Illustration's image: variants by width, ascending, and its placeholder colour. */
export async function prepareIllustration(file: Blob): Promise<ImageUpload> {
	const bitmap = await decode(file);
	try {
		const widths = WIDTHS.filter((w) => w < bitmap.width);
		widths.push(Math.min(bitmap.width, WIDTHS.at(-1)!));
		const variants = [];
		for (const width of [...new Set(widths)].sort((a, b) => a - b)) {
			variants.push({ width, file: await draw(bitmap, width) });
		}
		return { width: bitmap.width, height: bitmap.height, dominant: dominant(bitmap), variants };
	} finally {
		bitmap.close();
	}
}

/** A glossary entry's picture (P1-STU-05): one variant, at most 640 px wide, for a small card. */
export async function prepareGlossaryPicture(file: Blob): Promise<ImageUpload> {
	const bitmap = await decode(file);
	try {
		const width = Math.min(bitmap.width, WIDTHS[0]!);
		return {
			width: bitmap.width,
			height: bitmap.height,
			dominant: dominant(bitmap),
			variants: [{ width, file: await draw(bitmap, width) }]
		};
	} finally {
		bitmap.close();
	}
}

/** A cover: one picture, at most 1200 px wide. */
export async function prepareCover(file: Blob): Promise<Blob> {
	const bitmap = await decode(file);
	try {
		return await draw(bitmap, Math.min(bitmap.width, 1200));
	} finally {
		bitmap.close();
	}
}
