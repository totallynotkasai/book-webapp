// SPIKE P0-10: measures what each component set adds to the built app (ADR-005, bundle size).
// Run after `npm run build`, from apps/web: node src/routes/spike/components/bundle-size.mjs
// Counts every JS and CSS file reachable from an entry that the rest of the app doesn't
// already load (the root layout and the client entry), minified and gzipped.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const client = '.svelte-kit/output/client';
const manifest = JSON.parse(readFileSync(join(client, '.vite/manifest.json'), 'utf8'));

/** Every file a manifest entry loads statically: its own JS, imported chunks and their CSS. */
function closure(key, seen = new Set()) {
	const entry = manifest[key];
	if (!entry || seen.has(entry.file)) return seen;
	seen.add(entry.file);
	for (const css of entry.css ?? []) seen.add(css);
	for (const imported of entry.imports ?? []) closure(imported, seen);
	return seen;
}

const baseline = new Set();
for (const [key, entry] of Object.entries(manifest)) {
	if (entry.isEntry && !key.includes('nodes/') && !key.includes('spike')) closure(key, baseline);
}
closure('.svelte-kit/generated/client-optimized/nodes/0.js', baseline);

function measure(label, key) {
	const files = [...closure(key)].filter((f) => !baseline.has(f));
	const totals = { js: [0, 0], css: [0, 0] };
	for (const file of files) {
		const bytes = readFileSync(join(client, file));
		const kind = file.endsWith('.css') ? 'css' : 'js';
		totals[kind][0] += bytes.length;
		totals[kind][1] += gzipSync(bytes, { level: 9 }).length;
	}
	const kb = (n) => (n / 1024).toFixed(1);
	console.log(
		`${label.padEnd(28)} JS ${kb(totals.js[0])} kB (${kb(totals.js[1])} kB gz) · ` +
			`CSS ${kb(totals.css[0])} kB (${kb(totals.css[1])} kB gz) · files: ${files.join(', ')}`
	);
}

const page = Object.keys(manifest).find(
	(key) =>
		key.includes('nodes/') &&
		manifest[key].dynamicImports?.some((d) => d.includes('spike/components'))
);
measure('m3-svelte set', 'src/routes/spike/components/m3/M3Set.svelte');
measure('Bits UI set', 'src/routes/spike/components/bits/BitsSet.svelte');
measure('Spike page (theme generation)', page);
