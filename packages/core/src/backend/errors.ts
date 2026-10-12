/**
 * Backend error codes (docs/DESIGN.md §10.1). The same enum is used by `backend-local` now and
 * by the Phase 2 API, so the UI handles local and remote failures the same way.
 */
export const errorCodes = [
	'VALIDATION_FAILED',
	'UNAUTHENTICATED',
	'FORBIDDEN',
	'NOT_FOUND',
	'CONFLICT',
	'ENTITLEMENT_REQUIRED',
	/** A payment didn't go through (simulated in the PoC: the dev panel's payment outcome). */
	'PAYMENT_DECLINED',
	'RATE_LIMITED',
	'UPLOAD_TOO_LARGE',
	'INGEST_FAILED',
	/** The device couldn't reach the backend (offline, DNS, timeout). Raised client-side. */
	'NETWORK_ERROR',
	/** The backend failed unexpectedly (HTTP 5xx). */
	'SERVER_ERROR'
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export class BackendError extends Error {
	constructor(
		readonly code: ErrorCode,
		message: string,
		readonly details?: unknown
	) {
		super(message);
		this.name = 'BackendError';
	}
}

export function isBackendError(error: unknown, code?: ErrorCode): error is BackendError {
	return error instanceof BackendError && (code === undefined || error.code === code);
}
