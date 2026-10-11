/**
 * Record IDs and time (docs/DESIGN.md §6.3; IMPLEMENTATION-PLAN.md §4.6 rules 8–9).
 * IDs are UUIDv7: generated on the device, time-sortable, safe to create offline.
 */

/** ISO 8601 UTC timestamp string. Kept as a string so records serialise cleanly. */
export type Timestamp = string;

/** The one source of time. Inject it so tests and the dev panel's clock can control it. */
export interface Clock {
	now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function timestamp(clock: Clock = systemClock): Timestamp {
	return clock.now().toISOString();
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/**
 * RFC 9562 UUID version 7: 48-bit Unix milliseconds, then random bits.
 * Uses Web Crypto, which browsers and Node 19+ both provide on `globalThis`.
 */
export function uuidv7(ms: number = Date.now()): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	const time = Math.max(0, Math.floor(ms));
	// 48-bit big-endian timestamp. Division keeps it exact beyond 32 bits.
	const high = Math.floor(time / 2 ** 16);
	bytes[0] = (high >>> 24) & 0xff;
	bytes[1] = (high >>> 16) & 0xff;
	bytes[2] = (high >>> 8) & 0xff;
	bytes[3] = high & 0xff;
	bytes[4] = (time >>> 8) & 0xff;
	bytes[5] = time & 0xff;
	bytes[6] = 0x70 | (bytes[6]! & 0x0f); // version 7
	bytes[8] = 0x80 | (bytes[8]! & 0x3f); // RFC 9562 variant
	const h = Array.from(bytes, (b) => HEX[b]).join('');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Makes IDs from an injected clock, so records created "at" a dev-clock time sort correctly. */
export function idGenerator(clock: Clock = systemClock): () => string {
	return () => uuidv7(clock.now().getTime());
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidv7(value: string): boolean {
	return UUID_V7.test(value);
}

/** Reads the creation time back out of a UUIDv7. */
export function uuidv7Time(id: string): number {
	return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}
