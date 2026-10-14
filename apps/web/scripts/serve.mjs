// Serves a built copy of the app (adapter-static output) with the SPA fallback, the way a static
// host does: byte ranges for audio, and text files gzipped as GitHub Pages and other hosts send
// them (so the performance spec measures realistic downloads, P1-QA-01). Used by Playwright and
// for trying a production build on a phone.
// Usage: node scripts/serve.mjs [dir=build] [port=4173] [--host]
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const root = resolve(args[0] ?? 'build');
const port = Number(args[1] ?? 4173);
const host = process.argv.includes('--host') ? '0.0.0.0' : '127.0.0.1';

const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.webp': 'image/webp',
	'.woff2': 'font/woff2',
	'.epub': 'application/epub+zip',
	'.m4a': 'audio/mp4',
	'.mp3': 'audio/mpeg',
	'.txt': 'text/plain; charset=utf-8'
};

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);
const gzipped = new Map();

async function gzippedFile(file, mtimeMs) {
	const cached = gzipped.get(file);
	if (cached?.mtimeMs === mtimeMs) return cached.data;
	const data = gzipSync(await readFile(file));
	gzipped.set(file, { mtimeMs, data });
	return data;
}

async function fileFor(urlPath) {
	const path = normalize(decodeURIComponent(urlPath.split('?')[0] ?? '/'));
	const candidate = join(root, path);
	if (!candidate.startsWith(root)) return undefined;
	for (const file of [candidate, join(candidate, 'index.html'), `${candidate}.html`]) {
		const info = await stat(file).catch(() => undefined);
		if (info?.isFile()) return file;
	}
	return undefined;
}

createServer(async (req, res) => {
	const file = (await fileFor(req.url ?? '/')) ?? join(root, 'index.html');
	const type = TYPES[extname(file)] ?? 'application/octet-stream';
	const { size, mtimeMs } = await stat(file);
	if (
		!req.headers.range &&
		COMPRESSIBLE.has(extname(file)) &&
		/\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
	) {
		const data = await gzippedFile(file, mtimeMs);
		res.writeHead(200, {
			'content-type': type,
			'content-encoding': 'gzip',
			'content-length': data.length,
			vary: 'Accept-Encoding'
		});
		return res.end(req.method === 'HEAD' ? undefined : data);
	}
	// Byte ranges, as static hosts serve them: browsers need them to seek in audio (P0-06).
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
	if (range && (range[1] || range[2])) {
		const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
		const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
		if (start > end || start >= size) {
			res.writeHead(416, { 'content-range': `bytes */${size}` });
			return res.end();
		}
		res.writeHead(206, {
			'content-type': type,
			'accept-ranges': 'bytes',
			'content-range': `bytes ${start}-${end}/${size}`,
			'content-length': end - start + 1
		});
		if (req.method === 'HEAD') return res.end();
		return createReadStream(file, { start, end }).pipe(res);
	}
	res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
	if (req.method === 'HEAD') return res.end();
	createReadStream(file).pipe(res);
}).listen(port, host, () => console.log(`Serving ${root} at http://${host}:${port}`));
