// Lets Node (22.18+/24, which strips TypeScript types natively) load the workspace packages'
// TypeScript sources, which use bundler-style extensionless imports (`./normalise`). Import this
// file before importing any `@book/*` package. No dependency needed (no tsx, no build step).
import { registerHooks } from 'node:module';

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			const relative = specifier.startsWith('./') || specifier.startsWith('../');
			if (!relative || !context.parentURL?.endsWith('.ts')) throw error;
			for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
				try {
					return nextResolve(candidate, context);
				} catch {
					// try the next candidate
				}
			}
			throw error;
		}
	}
});
