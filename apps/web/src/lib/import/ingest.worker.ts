/// <reference lib="webworker" />
/**
 * Runs text-pipeline off the main thread (DESIGN.md §5.4), for imports (P1-ING-02),
 * backend-local's catalogue Books (P1-APP-03) and Studio uploads (P1-STU-01), so the UI stays
 * responsive while a Book processes. A new version of a Book also gets WordId carry-forward and
 * Anchor migration here (P1-ING-03); migrating alone and reading Words are jobs too.
 */
import {
	IngestError,
	ingestEpub,
	migrateAnchors,
	migrateProgress,
	readRevisionWords,
	type IngestResult
} from '@book/text-pipeline';
import type { IngestMessage, MigrationResult, WorkerRequest, WorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

function revisionWordsOf(result: IngestResult) {
	const decoder = new TextDecoder();
	const files = new Map(result.files.map((f) => [f.path, f.data]));
	return readRevisionWords((path) => {
		const data = files.get(path);
		return data ? decoder.decode(data) : undefined;
	});
}

const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
	scope.postMessage(message, transfer);

async function ingest(message: IngestMessage) {
	const { id, bytes, bookId, firstWordId, newBookId, previous } = message;
	const before = previous ? readRevisionWords((path) => previous.files[path]) : undefined;
	const result = await ingestEpub(new Uint8Array(bytes), {
		bookId,
		firstWordId,
		previous: before,
		newBookId: newBookId ? () => newBookId : undefined,
		onProgress: (done, total) => post({ id, type: 'progress', done, total })
	});
	let migration: MigrationResult | undefined;
	if (previous && before && (previous.anchors.length || previous.progress.length)) {
		const after = revisionWordsOf(result);
		migration = {
			anchors: migrateAnchors(previous.anchors, before, after),
			progress: previous.progress.map((point) => migrateProgress(point, before, after))
		};
	}
	post(
		{ id, type: 'done', result, migration },
		result.files.map((f) => f.data.buffer as ArrayBuffer)
	);
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const message = event.data;
	const { id } = message;
	try {
		if (message.op === 'ingest') return await ingest(message);
		if (message.op === 'migrate') {
			const before = readRevisionWords((path) => message.before[path]);
			const after = readRevisionWords((path) => message.after[path]);
			return post({
				id,
				type: 'migrated',
				result: {
					anchors: migrateAnchors(message.anchors, before, after),
					progress: message.progress.map((point) => migrateProgress(point, before, after))
				}
			});
		}
		const words = readRevisionWords((path) => message.revision[path]);
		post({
			id,
			type: 'words',
			result: words.chapters.map((c) => ({
				chapterId: c.chapterId,
				wordIds: c.wordIds,
				texts: c.texts
			}))
		});
	} catch (error) {
		post({
			id,
			type: 'error',
			code: error instanceof IngestError ? error.code : null,
			message: error instanceof Error ? error.message : String(error)
		});
	}
};
