/**
 * The main-thread side of the ingest worker. One worker is shared and stays alive while there is
 * work, so imports, catalogue Books and Studio uploads don't pay its start-up twice.
 */
import type { Anchor, IngestFailureCode, PointAnchor } from '@book/core';
import type { IngestResult } from '@book/text-pipeline';
import type {
	ChapterWordTexts,
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
		// The same name text-pipeline's own error has, so backend-local can tell it apart.
		this.name = 'IngestError';
	}
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<
	number,
	{
		resolve: (r: never) => void;
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
			if (message.type === 'error') {
				job.reject(new ImportFailure(message.code, message.message));
			} else if (message.type === 'done') {
				job.resolve({ ...message.result, migration: message.migration } as never);
			} else {
				job.resolve(message.result as never);
			}
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

function run<T>(
	message: WorkerRequest,
	transfer: Transferable[] = [],
	onProgress?: (done: number, total: number) => void
): Promise<T> {
	// Each job shows as `pipeline:<op>` in the browser's performance tools; the P1-QA-01
	// performance spec reads them too.
	const start = performance.now();
	const measure = () => performance.measure(`pipeline:${message.op}`, { start });
	return new Promise<T>((resolve, reject) => {
		pending.set(message.id, {
			resolve: ((result: never) => {
				measure();
				resolve(result);
			}) as (r: never) => void,
			reject: (error) => {
				measure();
				reject(error);
			},
			onProgress
		});
		getWorker().postMessage(message, transfer);
	});
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

/** Starts the worker before its first job, so its code loads while the caller fetches a file. */
export function warmImportWorker(): void {
	getWorker();
}

/** Processes an EPUB in the worker. The bytes are copied, so the caller can keep its buffer. */
export function ingestInWorker(
	bytes: Uint8Array,
	request: IngestRequest = {}
): Promise<IngestOutput> {
	const copy = bytes.slice().buffer;
	return run(
		{
			op: 'ingest',
			id: nextId++,
			bytes: copy,
			bookId: request.bookId,
			firstWordId: request.firstWordId,
			newBookId: request.newBookId,
			previous: request.previous
		},
		[copy],
		request.onProgress
	);
}

/** Moves Anchors between two Revisions, given each one's text files (§6.2). */
export function migrateInWorker(input: {
	before: Record<string, string>;
	after: Record<string, string>;
	anchors: Anchor[];
	progress: PointAnchor[];
}): Promise<MigrationResult> {
	return run({ op: 'migrate', id: nextId++, ...input });
}

/** Each Chapter's Words, IDs and text, from a Revision's text files. */
export function wordsInWorker(revision: Record<string, string>): Promise<ChapterWordTexts[]> {
	return run({ op: 'words', id: nextId++, revision });
}
