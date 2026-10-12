// Builds the hand-made fixture EPUBs from their sources in fixtures/src/ (DESIGN.md §12.2, P0-11).
// Usage: npm run fixtures:epubs
//
// Plain Node with no dependencies: a minimal ZIP writer (CRC-32, STORED and DEFLATE) that makes
// the output byte-identical across runs and machines with the same Node/zlib version:
// - `mimetype` is the first entry and STORED (uncompressed), as the EPUB OCF spec requires;
// - every other file is deflated at level 9, in sorted path order;
// - every entry has the same fixed timestamp and no extra fields or per-machine attributes.
// Sources are read as bytes; .gitattributes keeps text files LF on every checkout.
//
// Before writing, it checks each OPF: every manifest href exists, every file is in the manifest,
// and every spine itemref points at a manifest item. It prints the SHA-256 of each output.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const BOOKS = [
	{ src: 'fixtures/src/status-window', out: 'fixtures/epub/status-window.epub' },
	{
		src: 'fixtures/src/lamplighters-ledger',
		out: 'apps/web/static/demo/books/the-lamplighters-ledger.epub'
	}
];

/** 2026-10-11 00:00:00 in MS-DOS date/time format, used for every entry. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 11;

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/** @param {{ name: string, data: Buffer, store?: boolean }[]} entries in archive order */
function zip(entries) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const { name, data, store } of entries) {
		const nameBytes = Buffer.from(name, 'utf8');
		const body = store ? data : deflateRawSync(data, { level: 9 });
		const method = store ? 0 : 8;
		const crc = crc32(data);
		// Bit 11: file names are UTF-8.
		const flags = /^[\x20-\x7e]*$/.test(name) ? 0 : 0x0800;

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed: 2.0
		local.writeUInt16LE(flags, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		local.writeUInt16LE(0, 28); // no extra field
		locals.push(local, nameBytes, body);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4); // version made by: 2.0, MS-DOS attributes
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(flags, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		// extra length, comment length, disk number, internal and external attributes: all 0
		central.writeUInt32LE(offset, 42);
		centrals.push(central, nameBytes);

		offset += local.length + nameBytes.length + body.length;
	}
	const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, ...centrals, end]);
}

function listFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...listFiles(path));
		else out.push(path);
	}
	return out;
}

const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function checkPackage(srcDir, paths) {
	const problems = [];
	const container = readFileSync(join(srcDir, 'META-INF', 'container.xml'), 'utf8');
	const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
	if (!opfPath || !paths.includes(opfPath)) return [`container.xml: no package document`];
	const opf = readFileSync(join(srcDir, opfPath), 'utf8');
	const opfDir = posix.dirname(opfPath);
	const manifest = new Map();
	for (const [item] of opf.matchAll(/<item\s[^>]*>/g)) {
		const id = /\sid="([^"]+)"/.exec(item)?.[1];
		const href = /\shref="([^"]+)"/.exec(item)?.[1];
		if (!id || !href) problems.push(`${opfPath}: item without id or href: ${item}`);
		else manifest.set(id, posix.join(opfDir, href));
	}
	const listed = new Set(manifest.values());
	for (const href of listed) if (!paths.includes(href)) problems.push(`missing file: ${href}`);
	for (const path of paths) {
		if (path === opfPath || path.startsWith('META-INF/')) continue;
		if (!listed.has(path)) problems.push(`not in the manifest: ${path}`);
	}
	for (const [, idref] of opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/g)) {
		if (!manifest.has(idref)) problems.push(`spine itemref "${idref}" is not in the manifest`);
	}
	for (const required of ['dc:identifier', 'dc:title', 'dc:language', 'dcterms:modified']) {
		if (!opf.includes(required)) problems.push(`${opfPath}: no ${required}`);
	}
	if (!/properties="[^"]*\bnav\b/.test(opf)) problems.push(`${opfPath}: no nav document`);
	return problems;
}

let failed = false;
for (const book of BOOKS) {
	const srcDir = join(ROOT, book.src);
	const paths = listFiles(srcDir)
		.map((p) => relative(srcDir, p).split(sep).join('/'))
		.filter((p) => p !== 'mimetype')
		.sort(byteOrder);
	const problems = checkPackage(srcDir, paths);
	if (problems.length > 0) {
		failed = true;
		console.error(`${book.src}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
		continue;
	}
	const entries = [
		{ name: 'mimetype', data: Buffer.from('application/epub+zip', 'ascii'), store: true },
		...paths.map((name) => ({ name, data: readFileSync(join(srcDir, name)) }))
	];
	const bytes = zip(entries);
	const outPath = join(ROOT, book.out);
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, bytes);
	const sha = createHash('sha256').update(bytes).digest('hex');
	console.log(`${book.out}  ${bytes.length} bytes  sha256 ${sha}`);
}
if (failed) process.exit(1);
