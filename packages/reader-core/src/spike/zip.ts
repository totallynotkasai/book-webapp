// SPIKE (P0-04): throwaway. A minimal ZIP reader for the engine spike, using the platform's
// DecompressionStream (Chromium, Safari 16.4+, Android WebView). text-pipeline owns EPUB
// parsing from Phase 1; this exists only so both engines can be fed the same files.

export interface ZipEntry {
	name: string;
	compressedSize: number;
	size: number;
	method: number;
	offset: number;
}

export interface ZipArchive {
	entries: Map<string, ZipEntry>;
	read(name: string): Promise<Uint8Array>;
}

function findEndOfCentralDirectory(view: DataView): number {
	for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65_557); i--) {
		if (view.getUint32(i, true) === 0x06054b50) return i;
	}
	throw new Error('Not a ZIP file (no end of central directory).');
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function openZip(buffer: ArrayBuffer): ZipArchive {
	const view = new DataView(buffer);
	const bytes = new Uint8Array(buffer);
	const decoder = new TextDecoder();
	const eocd = findEndOfCentralDirectory(view);
	const count = view.getUint16(eocd + 10, true);
	let pointer = view.getUint32(eocd + 16, true);
	const entries = new Map<string, ZipEntry>();

	for (let i = 0; i < count; i++) {
		if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('Corrupt central directory.');
		const method = view.getUint16(pointer + 10, true);
		const compressedSize = view.getUint32(pointer + 20, true);
		const size = view.getUint32(pointer + 24, true);
		const nameLength = view.getUint16(pointer + 28, true);
		const extraLength = view.getUint16(pointer + 30, true);
		const commentLength = view.getUint16(pointer + 32, true);
		const offset = view.getUint32(pointer + 42, true);
		const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
		entries.set(name, { name, compressedSize, size, method, offset });
		pointer += 46 + nameLength + extraLength + commentLength;
	}

	return {
		entries,
		async read(name) {
			const entry = entries.get(name);
			if (!entry) throw new Error(`No ${name} in the archive.`);
			const local = entry.offset;
			const start =
				local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
			const data = bytes.subarray(start, start + entry.compressedSize);
			if (entry.method === 0) return data;
			if (entry.method === 8) return inflateRaw(data);
			throw new Error(`Unsupported compression method ${entry.method} for ${name}.`);
		}
	};
}
