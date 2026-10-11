import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Lints source snippets as if they lived at the given path, using the repo's real config.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

async function boundaryErrors(filePath: string, code: string): Promise<string[]> {
	const [result] = await eslint.lintText(code, { filePath });
	return (result?.messages ?? [])
		.filter((m) => m.ruleId === 'no-restricted-imports')
		.map((m) => m.message);
}

describe('import boundaries (DESIGN.md §5.3)', () => {
	it('stops packages importing apps/web code', async () => {
		for (const source of ['@book/web', '$lib/services', '../../../apps/web/src/lib/services']) {
			const errors = await boundaryErrors(
				'packages/domain/src/example.ts',
				`import { x } from '${source}';\nexport const y = x;\n`
			);
			expect(errors, source).toHaveLength(1);
		}
	});

	it('keeps core free of internal and platform imports', async () => {
		for (const source of ['@book/domain', 'svelte', 'node:fs', 'idb']) {
			const errors = await boundaryErrors(
				'packages/core/src/example.ts',
				`import { x } from '${source}';\nexport const y = x;\n`
			);
			expect(errors, source).toHaveLength(1);
		}
	});

	it('lets each package import only what §5.3 allows', async () => {
		const cases: [string, string, boolean][] = [
			['packages/domain/src/a.ts', '@book/core', true],
			['packages/domain/src/a.ts', '@book/storage-local', false],
			['packages/backend-local/src/a.ts', '@book/domain', true],
			['packages/backend-local/src/a.ts', '@book/text-pipeline', true],
			['packages/backend-local/src/a.ts', '@book/storage-local', false],
			['packages/contract-tests/src/a.ts', '@book/core', true],
			['packages/contract-tests/src/a.ts', '@book/backend-local', false],
			['packages/ui/src/a.ts', '@book/tokens', true],
			['packages/ui/src/a.ts', '@book/core', false]
		];
		for (const [file, source, allowed] of cases) {
			const errors = await boundaryErrors(
				file,
				`import { x } from '${source}';\nexport const y = x;\n`
			);
			expect(errors.length === 0, `${file} → ${source}`).toBe(allowed);
		}
	});

	it('allows only reader-core to import a reader engine', async () => {
		const code = `import { x } from 'foliate-js/view.js';\nexport const y = x;\n`;
		expect(await boundaryErrors('packages/reader-core/src/a.ts', code)).toHaveLength(0);
		expect(await boundaryErrors('packages/domain/src/a.ts', code)).toHaveLength(1);
		expect(await boundaryErrors('apps/web/src/routes/+page.ts', code)).toHaveLength(1);
	});

	it('allows only services.ts to import storage-local or backend-local in apps/web', async () => {
		for (const source of ['@book/storage-local', '@book/backend-local']) {
			const code = `import { x } from '${source}';\nexport const y = x;\n`;
			expect(await boundaryErrors('apps/web/src/lib/services.ts', code)).toHaveLength(0);
			expect(await boundaryErrors('apps/web/src/lib/state/library.svelte.ts', code)).toHaveLength(
				1
			);
			expect(await boundaryErrors('apps/web/src/routes/dev/+page.ts', code)).toHaveLength(1);
		}
	});
});
