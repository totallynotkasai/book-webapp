import type { IngestFailureCode } from '@book/core';

/** An EPUB that can't be processed at all. The message is for the reader or author (§7.1). */
export class IngestError extends Error {
	constructor(
		readonly code: IngestFailureCode,
		message: string
	) {
		super(message);
		this.name = 'IngestError';
	}
}
