/// <reference lib="webworker" />
/**
 * Runs text-pipeline off the main thread (DESIGN.md §5.4), for imports (P1-ING-02) and for
 * backend-local's catalogue Books (P1-APP-03), so the UI stays responsive while a Book processes.
 * A new version of a Book also gets WordId carry-forward and Anchor migration here (P1-ING-03).
 */
import {
	IngestError,
	ingestEpub,
	migrateAnchors,
	migrateProgress,
	readRevisionWords,
	type IngestResult
} from '@book/text-pipeline';
import type { MigrationResult, WorkerRequest, WorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

function revisionWordsOf(result: IngestResult) {
	const decoder = new TextDecoder();
	const files = new Map(result.files.map((f) => [f.path, f.data]));
	return readRevisionWords((path) => {
		const data = files.get(path);
		return data ? decoder.decode(data) : undefined;
	});
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const { id, bytes, bookId, firstWordId, newBookId, previous } = event.data;
	const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
		scope.postMessage(message, transfer);
	try {
		const before = previous ? readRevisionWords((path) => previous.files[path]) : undefined;
		const result = await ingestEpub(new Uint8Array(bytes), {
			bookId,
			firstWordId,
			previous: before,
			newBookId: newBookId ? () => newBookId : undefined,
			onProgress: (done, total) => post({ id, type: 'progress', done, total })
		});
		let migration: MigrationResult | undefined;
		if (previous && before) {
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
	} catch (error) {
		post({
			id,
			type: 'error',
			code: error instanceof IngestError ? error.code : null,
			message: error instanceof Error ? error.message : String(error)
		});
	}
};
