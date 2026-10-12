/// <reference lib="webworker" />
/**
 * Runs text-pipeline off the main thread (DESIGN.md §5.4), for imports (P1-ING-02) and for
 * backend-local's catalogue Books (P1-APP-03), so the UI stays responsive while a Book processes.
 */
import { IngestError, ingestEpub } from '@book/text-pipeline';
import type { WorkerRequest, WorkerResponse } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const { id, bytes, bookId, firstWordId, newBookId } = event.data;
	const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
		scope.postMessage(message, transfer);
	try {
		const result = await ingestEpub(new Uint8Array(bytes), {
			bookId,
			firstWordId,
			newBookId: newBookId ? () => newBookId : undefined,
			onProgress: (done, total) => post({ id, type: 'progress', done, total })
		});
		post(
			{ id, type: 'done', result },
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
