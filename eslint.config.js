import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

/**
 * Import boundaries (docs/DESIGN.md §5.3, Invariants 7–9). Dependencies point one way:
 * apps/* → packages/* → core. Each package lists the internal packages it may import;
 * every other `@book/*` package is refused.
 *
 * ESLint replaces (rather than merges) a rule configured in two matching blocks, so each file
 * gets exactly one `no-restricted-imports` config, built here.
 */
const PACKAGES = {
	core: [],
	domain: ['core'],
	'text-pipeline': ['core'],
	alignment: ['core'],
	'reader-core': ['core'],
	'contract-tests': ['core'],
	'storage-local': ['core'],
	'backend-local': ['core', 'domain', 'text-pipeline'],
	tokens: ['core'],
	ui: ['tokens']
};
const ALL_PACKAGES = Object.keys(PACKAGES);

/** Only `packages/reader-core` may import a reader engine (Invariant 8). */
const READER_ENGINES = ['foliate-js', 'foliate-js/*', '@readium/*'];
const engineRule = {
	group: READER_ENGINES,
	message: 'Only packages/reader-core may import the reader engine (DESIGN.md Invariant 8).'
};

/** Packages never reach into apps, by name, alias or relative path. */
const appRule = {
	group: ['@book/web', '@book/web/*', '$lib', '$lib/*', '$app/*', '**/apps/**'],
	message: 'Packages must not import from apps/* (DESIGN.md §5.3).'
};

/** Packages import each other by name, never by path into another package's source. */
const crossPackagePathRule = {
	group: ['**/packages/**', '../../*/src', '../../*/src/**'],
	message: 'Import other packages by their @book/* name.'
};

function forbiddenPackages(allowed, self) {
	return ALL_PACKAGES.filter((name) => name !== self && !allowed.includes(name)).flatMap((name) => [
		`@book/${name}`,
		`@book/${name}/*`
	]);
}

function boundaryPatterns(name, allowed) {
	const forbidden = forbiddenPackages(allowed, name);
	const patterns = [appRule, crossPackagePathRule];
	if (forbidden.length > 0) {
		patterns.unshift({
			group: forbidden,
			message: `@book/${name} may import only ${allowed.length ? allowed.map((a) => `@book/${a}`).join(', ') : 'no other @book package'} (DESIGN.md §5.3).`
		});
	}
	if (name !== 'reader-core') patterns.push(engineRule);
	if (name === 'core') {
		// Invariant 9: core stays platform-neutral.
		patterns.push({
			group: ['svelte', 'svelte/*', 'node:*', 'idb'],
			message: '@book/core must stay platform-neutral (DESIGN.md Invariant 9).'
		});
	}
	return patterns;
}

/** Source files get the package's boundary; its tests may also use the shared contract suites. */
function packageBoundary(name, allowed) {
	const testFiles = `packages/${name}/**/*.test.ts`;
	return [
		{
			files: [`packages/${name}/**/*.{ts,js,svelte}`],
			ignores: [testFiles],
			rules: { 'no-restricted-imports': ['error', { patterns: boundaryPatterns(name, allowed) }] }
		},
		{
			files: [testFiles],
			rules: {
				'no-restricted-imports': [
					'error',
					{ patterns: boundaryPatterns(name, [...allowed, 'contract-tests']) }
				]
			}
		}
	];
}

/** Inside apps/web, only services.ts chooses implementations (Invariant 7). */
const implementationRule = {
	group: [
		'@book/storage-local',
		'@book/storage-local/*',
		'@book/backend-local',
		'@book/backend-local/*'
	],
	message:
		'Only apps/web/src/lib/services.ts may import storage-local or backend-local (DESIGN.md Invariant 7).'
};
const webPathRule = {
	group: ['**/packages/**'],
	message: 'Import packages by their @book/* name.'
};

export default ts.config(
	{
		ignores: [
			'**/node_modules',
			'**/.svelte-kit',
			'**/build',
			'**/build-*',
			'**/coverage',
			'**/test-results',
			'**/playwright-report',
			'apps/web/android',
			'.claude',
			'**/spike-results'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: { 'no-undef': 'off' }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser } }
	},
	...Object.entries(PACKAGES).flatMap(([name, allowed]) => packageBoundary(name, allowed)),
	{
		files: ['apps/web/**/*.{ts,js,svelte}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{ patterns: [implementationRule, engineRule, webPathRule] }
			]
		}
	},
	{
		// Components take hrefs the app has already resolved with $app/paths; packages/ui can't
		// import SvelteKit (it imports only @book/tokens, §5.3).
		files: ['packages/ui/**/*.svelte'],
		rules: { 'svelte/no-navigation-without-resolve': 'off' }
	},
	{
		files: ['apps/web/src/lib/services.ts'],
		rules: { 'no-restricted-imports': ['error', { patterns: [engineRule, webPathRule] }] }
	}
);
