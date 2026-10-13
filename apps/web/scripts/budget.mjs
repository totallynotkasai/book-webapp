// JavaScript budget for the reader route (DESIGN.md §12.3, P1-QA-01): what a browser downloads to
// show /read/[bookId], gzipped, must stay under 250 KB, excluding the reader engine (foliate-js,
// which loads on demand). Run after `npm run build`; CI fails the build when a budget is missed.
//
//   node scripts/budget.mjs [build-dir=build]
//
// The route's JavaScript is SvelteKit's client entries plus the route's layout and page nodes and
// everything they import statically, read from Vite's manifest. Dynamic imports (the engine, the
// simulated backend, the import worker) load later and aren't counted.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const app = fileURLToPath(new URL('..', import.meta.url));
const out = join(app, process.argv[2] ?? 'build');
const kit = join(app, '.svelte-kit');
const manifest = JSON.parse(readFileSync(join(kit, 'output/client/.vite/manifest.json'), 'utf8'));
const appJs = readFileSync(join(kit, 'generated/client-optimized/app.js'), 'utf8');

const KB = 1024;
const BUDGETS = [{ route: '/read/[bookId]', label: 'Reader route', limit: 250 * KB }];

/** Node indices for a route: its page, its layouts and always the root layout (0). */
function nodesFor(route) {
	const line = appJs.split('\n').find((l) => l.includes(`"${route}":`));
	if (!line) throw new Error(`${route} isn't in the route dictionary`);
	const numbers = [...line.slice(line.indexOf(':')).matchAll(/-?\d+/g)].map((m) => Math.abs(+m[0]));
	return [...new Set([0, ...numbers])];
}

/** Every chunk a set of manifest entries pulls in statically, as manifest keys. */
function staticGraph(keys) {
	const seen = new Set();
	const visit = (key) => {
		if (seen.has(key)) return;
		seen.add(key);
		for (const next of manifest[key]?.imports ?? []) visit(next);
	};
	keys.forEach(visit);
	return seen;
}

const gzipped = (file) => gzipSync(readFileSync(join(out, file))).length;
// SvelteKit's two client entries: its runtime (entry/start) and the app's (entry/app).
const entries = Object.keys(manifest).filter(
	(key) => manifest[key].isEntry && /\/entry\/(start|app)\./.test(manifest[key].file)
);
if (entries.length !== 2) throw new Error(`Expected 2 client entries, found ${entries.length}`);

let failed = false;
for (const budget of BUDGETS) {
	const nodes = nodesFor(budget.route).map(
		(n) => `.svelte-kit/generated/client-optimized/nodes/${n}.js`
	);
	const keys = staticGraph([...entries, ...nodes]);
	const files = [...keys].map((key) => manifest[key].file).filter((f) => f.endsWith('.js'));
	const size = files.reduce((sum, file) => sum + gzipped(file), 0);
	const ok = size <= budget.limit;
	failed ||= !ok;
	console.log(
		`${ok ? 'ok  ' : 'OVER'} ${budget.label}: ${(size / KB).toFixed(1)} KB gzipped of ${budget.limit / KB} KB (${files.length} files)`
	);
}

// For the record: the engine and the other on-demand chunks, which the budget leaves out.
const engine = Object.keys(manifest).find((key) => key.includes('reader-core/src/foliate-engine'));
if (engine) {
	const files = [...staticGraph([engine])].map((key) => manifest[key].file);
	const size = files.reduce((sum, file) => sum + gzipped(file), 0);
	console.log(`info Reader engine (loaded on demand): ${(size / KB).toFixed(1)} KB gzipped`);
}

if (failed) {
	console.error('\nA JavaScript budget is missed (DESIGN.md §12.3).');
	process.exit(1);
}
