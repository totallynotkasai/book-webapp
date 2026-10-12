// Builds the demo Illustration Packs (P1-LAY-06) when they're missing or older than their sources:
// `fixtures/layers/*.source.json`, the images they name, and the tool itself. The output under
// `static/demo/layers/` is generated, not committed (about 14 MB of WebP).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sources = join(root, 'fixtures/layers');
const newest = (paths) => Math.max(0, ...paths.map((p) => statSync(p).mtimeMs));
const files = (dir) => readdirSync(dir).map((f) => join(dir, f));

let stale = false;
for (const name of readdirSync(sources).filter((f) => f.endsWith('.source.json'))) {
	const source = JSON.parse(readFileSync(join(sources, name), 'utf8'));
	const output = join(root, 'apps/web/static/demo/layers', source.id, 'pack.json');
	const inputs = [
		join(sources, name),
		...files(join(root, source.images)),
		...files(join(root, 'tools/src'))
	];
	if (!existsSync(output) || statSync(output).mtimeMs < newest(inputs)) stale = true;
}
if (stale) {
	console.log('Building the demo Illustration Packs…');
	const run = spawnSync('npm', ['run', 'layers'], { cwd: root, stdio: 'inherit', shell: true });
	if (run.status !== 0) process.exit(run.status ?? 1);
}
