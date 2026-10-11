import { describe, expect, it } from 'vitest';
import { idGenerator, isUuidv7, timestamp, uuidv7, uuidv7Time, type Clock } from './ids';

describe('uuidv7', () => {
	it('produces RFC 9562 version 7 IDs', () => {
		for (let i = 0; i < 100; i++) expect(isUuidv7(uuidv7())).toBe(true);
	});

	it('encodes the timestamp, so IDs sort by creation time', () => {
		const ms = Date.UTC(2026, 9, 11, 12, 0, 0);
		expect(uuidv7Time(uuidv7(ms))).toBe(ms);
		const ids = [uuidv7(ms), uuidv7(ms + 1), uuidv7(ms + 1000), uuidv7(ms + 86_400_000)];
		expect([...ids].sort()).toEqual(ids);
	});

	it('is unique', () => {
		const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(0)));
		expect(ids.size).toBe(1000);
	});
});

describe('injected clock', () => {
	const fixed: Clock = { now: () => new Date('2030-01-02T03:04:05.000Z') };

	it('drives timestamps and IDs', () => {
		expect(timestamp(fixed)).toBe('2030-01-02T03:04:05.000Z');
		expect(uuidv7Time(idGenerator(fixed)())).toBe(fixed.now().getTime());
	});
});
