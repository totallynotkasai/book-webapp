import type { IngestFailureCode } from '@book/core';
import type { IngestResult } from '@book/text-pipeline';

export interface WorkerRequest {
	id: number;
	bytes: ArrayBuffer;
	bookId?: string;
	firstWordId?: number;
	/** Used when the EPUB has no dc:identifier. */
	newBookId?: string;
}

export type WorkerResponse =
	| { id: number; type: 'progress'; done: number; total: number }
	| { id: number; type: 'done'; result: IngestResult }
	| { id: number; type: 'error'; code: IngestFailureCode | null; message: string };
