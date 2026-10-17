import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignChapter } from '@book/alignment';
import { parseSyncMap } from '@book/core';
import { ingestEpub, readRevisionWords } from '@book/text-pipeline';
import { describe, expect, it } from 'vitest';

// P1-STU-07 acceptance: `tools/align` for any Book. The status-window fixture was read aloud for
// this by a Windows voice (fixtures/scripts/speak-status-window.mjs) and aligned with
// `npm run narration -- --epub … --audio … --chapter …`; its whisper.cpp transcripts and Sync
// Maps are committed in fixtures/sync/status-window/, so this needs neither the voice nor whisper.
// The Studio importing the result is in backend-local's tests.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'fixtures/sync/status-window');
const json = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;

interface Transcript {
	durationMs: number;
	words: [string, number, number, number, number, number][];
}

describe('tools/align on the status-window fixture (P1-STU-07)', async () => {
	const result = await ingestEpub(
		new Uint8Array(readFileSync(join(root, 'fixtures/epub/status-window.epub'))),
		{ bookId: 'tools-align' }
	);
	const files = new Map(result.files.map((f) => [f.path, new TextDecoder().decode(f.data)]));
	const revision = readRevisionWords((path) => files.get(path));
	const chapters = result.manifest.chapters.filter((c) => c.linear && c.wordCount > 0);

	for (const n of [1, 2]) {
		const chapter = revision.chapters.find((c) => c.chapterId === chapters[n - 1]!.chapterId)!;

		it(`Chapter ${n}: aligning its recording gives coverage of at least 0.95`, () => {
			const transcript = json(`ch0${n}.base.en.transcript.json`) as Transcript;
			const alignment = alignChapter(
				chapter.wordIds.map((wordId, i) => ({ wordId, text: chapter.texts[i]! })),
				transcript.words.map(([text, startMs, endMs, , , confidence]) => ({
					text,
					startMs,
					endMs,
					confidence: confidence / 1000
				})),
				{ durationMs: transcript.durationMs }
			);
			expect(alignment.coverage).toBeGreaterThanOrEqual(0.95);
		});

		it(`Chapter ${n}: the Sync Map it wrote is for this file and Chapter, every Word once`, () => {
			const map = parseSyncMap(json(`ch0${n}.sync.json`));
			expect(map.revisionId).toBe(result.revisionId);
			expect(map.chapterId).toBe(chapter.chapterId);
			expect(map.words.map((w) => w[0]).sort((a, b) => a - b)).toEqual(chapter.wordIds);
			expect(map.coverage).toBeGreaterThanOrEqual(0.95);
		});
	}
});
