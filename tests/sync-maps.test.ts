import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSyncMap } from '@book/core';
import { ingestEpub, readRevisionWords } from '@book/text-pipeline';
import { describe, expect, it } from 'vitest';

// The demo Audio Track (P1-LAY-03) is committed, aligned to the catalogue Alice by tools/align.
// If text-pipeline ever gives that EPUB different WordIds or a different Revision, these fail,
// and `npm run narration` makes the Sync Maps again (from the committed transcripts).

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const syncDir = join(root, 'apps/web/static/demo/sync/alice');

interface TrackFile {
	id: string;
	bookId: string;
	revisionId: string;
	chapters: { chapterId: string; syncMap: string; durationMs: number; coverage: number }[];
}

describe('the demo narration Sync Maps match the catalogue Alice (P1-LAY-03)', async () => {
	const result = await ingestEpub(
		new Uint8Array(readFileSync(join(root, 'apps/web/static/books/alice.epub'))),
		{
			bookId: 'book-alice'
		}
	);
	const files = new Map(result.files.map((f) => [f.path, new TextDecoder().decode(f.data)]));
	const revision = readRevisionWords((path) => files.get(path));
	const track = JSON.parse(readFileSync(join(syncDir, 'track.json'), 'utf8')) as TrackFile;

	it('the track is on the current Revision and covers chapters 1 to 3', () => {
		expect(track.revisionId).toBe(result.revisionId);
		expect(track.bookId).toBe('book-alice');
		expect(track.chapters).toHaveLength(3);
	});

	for (const entry of track.chapters) {
		it(`${entry.syncMap}: every Word of its Chapter, once, with coverage of at least 0.95`, () => {
			const map = parseSyncMap(JSON.parse(readFileSync(join(syncDir, entry.syncMap), 'utf8')));
			const chapter = revision.chapters.find((c) => c.chapterId === map.chapterId)!;
			expect(chapter, map.chapterId).toBeDefined();
			expect(map.revisionId).toBe(result.revisionId);
			expect(map.trackId).toBe(track.id);
			expect(map.coverage).toBeGreaterThanOrEqual(0.95);
			expect(map.coverage).toBe(entry.coverage);
			expect(new Set(map.words.map((w) => w[0]))).toEqual(new Set(chapter.wordIds));
			expect(map.words.at(-1)![2]).toBeLessThanOrEqual(map.durationMs);
		});
	}
});
