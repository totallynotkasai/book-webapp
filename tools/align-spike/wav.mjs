// SPIKE (P0-06): reads 16-bit PCM samples from a WAV file (any chunk layout), for the pause
// analysis in @book/alignment (findPauses, timingAccuracy).
import { readFileSync } from 'node:fs';

export function readWav(path) {
	const buffer = readFileSync(path);
	const rate = buffer.readUInt32LE(24);
	let offset = 12;
	while (offset < buffer.length - 8) {
		const id = buffer.toString('ascii', offset, offset + 4);
		const size = buffer.readUInt32LE(offset + 4);
		if (id === 'data') {
			const end = Math.min(buffer.length, offset + 8 + size);
			const bytes = buffer.buffer.slice(buffer.byteOffset + offset + 8, buffer.byteOffset + end);
			return { rate, samples: new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2)) };
		}
		offset += 8 + size + (size % 2);
	}
	throw new Error(`No data chunk in ${path}`);
}
