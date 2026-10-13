import { BackendError, errorCodes, StoreError } from '@book/core';
import { describe, expect, it } from 'vitest';
import { describeError, errorCopy } from './errors';

describe('error copy (P1-APP-02)', () => {
	it.each(errorCodes)('%s has a title and a way forward', (code) => {
		const copy = errorCopy[code];
		expect(copy.title.length).toBeGreaterThan(3);
		expect(copy.message).toMatch(/\.$/);
		// DESIGN.md §11.6: explain without apologising.
		expect(`${copy.title} ${copy.message}`).not.toMatch(/sorry|apolog|oops/i);
	});

	it('describes Backend errors by code and flags offline', () => {
		expect(describeError(new BackendError('NETWORK_ERROR', 'x'))).toMatchObject({
			code: 'NETWORK_ERROR',
			offline: true,
			retry: true
		});
		expect(describeError(new BackendError('FORBIDDEN', 'x'))).toMatchObject({
			code: 'FORBIDDEN',
			offline: false,
			retry: false
		});
	});

	it('treats store and unknown errors sensibly', () => {
		expect(describeError(new StoreError('NOT_FOUND', 'gone')).code).toBe('NOT_FOUND');
		expect(describeError(new TypeError('x'))).toMatchObject({ code: 'UNKNOWN', retry: true });
		// A validation message says exactly what to fix, so it is shown; others keep the copy.
		expect(describeError(new BackendError('VALIDATION_FAILED', 'Add alt text.'))).toMatchObject({
			title: errorCopy.VALIDATION_FAILED.title,
			message: 'Add alt text.'
		});
		expect(describeError(new BackendError('SERVER_ERROR', 'stack trace')).message).toBe(
			errorCopy.SERVER_ERROR.message
		);
		expect(describeError('a string').code).toBe('UNKNOWN');
	});
});
