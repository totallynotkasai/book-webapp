/**
 * Builds the demo Illustration Packs (P1-LAY-06, DESIGN.md §8.2): `resolve-anchors` and `images`
 * in one run, from the hand-checked sources in `fixtures/layers/*.source.json` into
 * `apps/web/static/demo/layers/<pack>/`, where `backend-local` serves them.
 *
 * - Each Illustration's quote must appear exactly once in the Book's text, or the build fails.
 *   The Anchor covers the quoted Words, on the Revision readers open (same EPUB, same Book ID,
 *   same text-pipeline as `backend-local`).
 * - Every Illustration must have alt text.
 * - Images become WebP at 640, 1280 and 2048 px wide (never upscaled), with a dominant colour
 *   for placeholders.
 *
 *   npm run layers
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ILLUSTRATION_PACK_FILE_VERSION,
	illustrationPackFileSchema,
	type IllustrationPackFile
} from '@book/core';
import { normaliseToken, tokenise } from '@book/text-pipeline';
import sharp from 'sharp';
import { loadBook, ROOT } from './book';

const WIDTHS = [640, 1280, 2048];
const QUALITY = 78;

interface SourceIllustration {
	id: string;
	file: string;
	quote: string;
	alt: string;
	caption?: string | null;
	credit?: string;
	placement: 'panel' | 'inline' | 'full_page';
	span: 'single' | 'double';
	spoilerSafe: boolean;
}

interface PackSource {
	id: string;
	bookId: string;
	epub: string;
	creatorId: string;
	name: string;
	description: string;
	isOfficial: boolean;
	aiUse: 'none' | 'assisted' | 'generated';
	credit: string;
	images: string;
	illustrations: SourceIllustration[];
}

const tokensOf = (text: string) =>
	tokenise(text).map((t) => normaliseToken(text.slice(t.start, t.end)));

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

async function buildPack(source: PackSource) {
	const book = await loadBook(source.epub, source.bookId);
	const problems: string[] = [];
	const out = join(ROOT, 'apps/web/static/demo/layers', source.id);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });

	const illustrations: IllustrationPackFile['illustrations'] = [];
	for (const ill of source.illustrations) {
		if (!ill.alt?.trim()) problems.push(`${ill.id}: no alt text`);
		const q = tokensOf(ill.quote);
		const hits: number[] = [];
		for (let s = 0; s + q.length <= book.index.wordCount; s++) {
			let k = 0;
			while (k < q.length && book.index.tokens[s + k] === q[k]) k++;
			if (k === q.length) hits.push(s);
		}
		if (hits.length !== 1) {
			problems.push(`${ill.id}: quote found ${hits.length} times: “${ill.quote}”`);
			continue;
		}
		const anchor = book.index.rangeAnchor(hits[0]!, hits[0]! + q.length - 1);

		const image = sharp(join(ROOT, source.images, ill.file)).flatten({ background: '#ffffff' });
		const { width = 0, height = 0 } = await image.metadata();
		const { dominant } = await image.stats();
		const widths = [...new Set(WIDTHS.map((w) => Math.min(w, width)))].sort((a, b) => a - b);
		const variants = [];
		for (const w of widths) {
			const path = `${ill.id}-${w}.webp`;
			await image
				.clone()
				.resize({ width: w, withoutEnlargement: true })
				.webp({ quality: QUALITY, effort: 6 })
				.toFile(join(out, path));
			variants.push({ width: w, path });
		}
		illustrations.push({
			id: ill.id,
			anchor,
			placement: ill.placement,
			span: ill.span,
			alt: ill.alt,
			...(ill.caption ? { caption: ill.caption } : {}),
			...(ill.credit ? { credit: ill.credit } : {}),
			spoilerSafe: ill.spoilerSafe,
			image: {
				width,
				height,
				dominant: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
				variants
			}
		});
	}
	if (problems.length) {
		throw new Error(`${source.id} can't be built:\n  ${problems.join('\n  ')}`);
	}
	const pack: IllustrationPackFile = illustrationPackFileSchema.parse({
		version: ILLUSTRATION_PACK_FILE_VERSION,
		id: source.id,
		bookId: source.bookId,
		revisionId: book.manifest.revisionId,
		creatorId: source.creatorId,
		name: source.name,
		description: source.description,
		isOfficial: source.isOfficial,
		aiUse: source.aiUse,
		credit: source.credit,
		illustrations: illustrations.sort((a, b) => a.anchor.startOrdinal - b.anchor.startOrdinal)
	});
	writeFileSync(join(out, 'pack.json'), `${JSON.stringify(pack, null, '\t')}\n`);
	const bytes = readdirSync(out).reduce((n, f) => n + readFileSync(join(out, f)).byteLength, 0);
	console.log(
		`${source.id}: ${illustrations.length} Illustrations, ${(bytes / 1048576).toFixed(1)} MB`
	);
}

const dir = join(ROOT, 'fixtures/layers');
for (const file of readdirSync(dir)
	.filter((f) => f.endsWith('.source.json'))
	.sort()) {
	await buildPack(JSON.parse(readFileSync(join(dir, file), 'utf8')) as PackSource);
}
