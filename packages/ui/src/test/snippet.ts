import { createRawSnippet, type Snippet } from 'svelte';

/** A text snippet for `children`-style props in component tests. */
export function text(value: string): Snippet {
	return createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));
}
