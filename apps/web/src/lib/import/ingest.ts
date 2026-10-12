/**
 * The main-thread side of the ingest worker. One worker is shared and stays alive while there is
 * work, so imports and catalogue Books don't pay its start-up twice.
 */
import type { IngestFailureCode } from '@book/core';
import type { IngestResult } from '@book/text-pipeline';
import type {
	MigrationResult,
	PreviousRevisionRequest,
	WorkerRequest,
	WorkerResponse
} from './protocol';

/** An import failed for a reason the reader can act on (the message says what to do). */
export class ImportFailure extends Error {
	constructor(
		readonly code: IngestFailureCode | null,
		message: string
	) {
		super(message);
		this.name = 'ImportFailure';
	}
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<
	number,
	{
		resolve: (r: IngestOutput) => void;
		reject: (e: Error) => void;
		onProgress?: (done: number, total: number) => void;
	}
>();

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL('./ingest.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
			const message = event.data;
			const job = pending.get(message.id);
			if (!job) return;
			if (message.type === 'progress') return job.onProgress?.(message.done, message.total);
			pending.delete(message.id);
			if (message.type === 'done') job.resolve({ ...message.result, migration: message.migration });
			else job.reject(new ImportFailure(message.code, message.message));
		};
		worker.onerror = (event) => {
			for (const job of pending.values())
				job.reject(new Error(event.message || 'The import worker stopped.'));
			pending.clear();
			worker?.terminate();
			worker = undefined;
		};
	}
	return worker;
}

export interface IngestRequest {
	bookId?: string;
	firstWordId?: number;
	newBookId?: string;
	/** A new version of a Book already here: carry WordIds forward and migrate its Anchors. */
	previous?: PreviousRevisionRequest;
	onProgress?: (done: number, total: number) => void;
}

/** What the worker returns: the processed Revision, and migrated Anchors for a new version. */
export type IngestOutput = IngestResult & { migration?: MigrationResult };

/** Processes an EPUB in the worker. The bytes are copied, so the caller can keep its buffer. */
export function ingestInWorker(
	bytes: Uint8Array,
	request: IngestRequest = {}
): Promise<IngestOutput> {
	const id = nextId++;
	const copy = bytes.slice().buffer;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject, onProgress: request.onProgress });
		const message: WorkerRequest = {
			id,
			bytes: copy,
			bookId: request.bookId,
			firstWordId: request.firstWordId,
			newBookId: request.newBookId,
			previous: request.previous
		};
		getWorker().postMessage(message, [copy]);
	});
}
