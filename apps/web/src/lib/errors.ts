/**
 * The one map from Backend error codes to UI copy (IMPLEMENTATION-PLAN.md §4.6 rule 4), so local
 * and Phase 2 failures read the same. Copy follows DESIGN.md §11.6: say what happened and how to
 * fix it, without apologising.
 */
import { isBackendError, StoreError, type ErrorCode } from '@book/core';

export interface ErrorCopy {
	/** A short line for snackbars and headings. */
	title: string;
	/** What to do about it. */
	message: string;
	/** Whether trying again might help, so screens show "Try again". */
	retry: boolean;
}

export const errorCopy: Record<ErrorCode, ErrorCopy> = {
	VALIDATION_FAILED: {
		title: 'That didn’t look right',
		message: 'Check what you entered and try again.',
		retry: false
	},
	UNAUTHENTICATED: {
		title: 'You’re signed out',
		message: 'Sign in to continue.',
		retry: false
	},
	FORBIDDEN: {
		title: 'Your account can’t do that',
		message: 'This needs a different kind of account.',
		retry: false
	},
	NOT_FOUND: {
		title: 'That isn’t here',
		message: 'It may have been moved or removed.',
		retry: false
	},
	CONFLICT: {
		title: 'That changed while you were working',
		message: 'Refresh to see the latest version, then try again.',
		retry: true
	},
	ENTITLEMENT_REQUIRED: {
		title: 'This isn’t in your library yet',
		message: 'Get it from the store to read it.',
		retry: false
	},
	PAYMENT_DECLINED: {
		title: 'The payment didn’t go through',
		message: 'Nothing was charged. Try again, or use another way to pay.',
		retry: true
	},
	RATE_LIMITED: {
		title: 'Too many requests at once',
		message: 'Wait a minute, then try again.',
		retry: true
	},
	UPLOAD_TOO_LARGE: {
		title: 'That file is too large',
		message: 'EPUBs can be up to 100 MB, images 25 MB and audio files 1 GB.',
		retry: false
	},
	INGEST_FAILED: {
		title: 'That EPUB couldn’t be read',
		message: 'The details say what was wrong with it.',
		retry: false
	},
	NETWORK_ERROR: {
		title: 'You’re offline',
		message: 'Check your connection and try again. Books you imported still work.',
		retry: true
	},
	SERVER_ERROR: {
		title: 'Something went wrong on the server',
		message: 'Try again in a moment.',
		retry: true
	}
};

export interface DescribedError extends ErrorCopy {
	code: ErrorCode | 'UNKNOWN';
	/** True when the device can't reach the backend, so screens show their offline state. */
	offline: boolean;
}

/** Turns anything thrown into copy for the UI. Unknown errors read as a retryable problem. */
export function describeError(error: unknown): DescribedError {
	if (isBackendError(error)) {
		return { ...errorCopy[error.code], code: error.code, offline: error.code === 'NETWORK_ERROR' };
	}
	if (error instanceof StoreError) {
		return { ...errorCopy.NOT_FOUND, code: 'NOT_FOUND', offline: false };
	}
	return {
		title: 'Something went wrong',
		message: 'Try again. If it keeps happening, reload the app.',
		retry: true,
		code: 'UNKNOWN',
		offline: false
	};
}
