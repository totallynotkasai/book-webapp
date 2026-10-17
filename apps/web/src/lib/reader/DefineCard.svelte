<script module lang="ts">
	let dictionary: Dictionary | undefined;

	/** One dictionary for the session: the pieces read stay read, so they work offline after. */
	function shared(): Dictionary {
		dictionary ??= new Dictionary(async (name) => {
			const response = await fetch(asset(`${DICTIONARY_PATH}/${name}` as `/${string}`));
			if (!response.ok) throw new Error(`The dictionary's ${name} didn’t load: ${response.status}`);
			return response.json();
		});
		return dictionary;
	}
</script>

<script lang="ts">
	import { asset } from '$app/paths';
	import { DICTIONARY_PATH } from '@book/core';
	import { Button, Dialog, Progress } from '@book/ui';
	import { Dictionary, wiktionaryUrl, type Credit, type LookUp } from './define';

	/**
	 * Define (P1-RDR-18, D-043; plan §6 Phase 1.19 UX notes): a small card with the Word's meanings
	 * from the offline dictionary the app ships, and where they came from. Nothing leaves the
	 * device; for a Word the dictionary hasn't got, "Look up on Wiktionary" opens the web, and says
	 * so, only when tapped. Loaded the first time Define is used.
	 */
	interface Props {
		open: boolean;
		/** The selected Word, as on the page. */
		text: string;
	}

	let { open = $bindable(), text }: Props = $props();

	/** Meanings shown per part of speech before "More meanings". */
	const SHOWN = 3;

	let view = $state.raw<
		| { kind: 'loading' }
		| { kind: 'ready'; result: LookUp; credit: Credit }
		| { kind: 'error'; word: string }
	>({ kind: 'loading' });
	let all = $state(false);
	let attempt = $state(0);

	$effect(() => {
		const word = text;
		void attempt;
		if (!open) return;
		let current = true;
		view = { kind: 'loading' };
		all = false;
		void (async () => {
			try {
				const dictionary = shared();
				const [result, source] = await Promise.all([dictionary.lookUp(word), dictionary.source()]);
				if (current) {
					view = { kind: 'ready', result, credit: source };
				}
			} catch (error) {
				console.warn('The dictionary didn’t load', error);
				if (current) view = { kind: 'error', word };
			}
		})();
		return () => (current = false);
	});

	const result = $derived(view.kind === 'ready' ? view.result : null);
	const word = $derived(result?.word || text.trim());
	const more = $derived(
		!!result?.definitions.some((d) => d.parts.some((p) => p.meanings.length > SHOWN))
	);
</script>

<!-- Where the definitions came from, with links to the source and its licence (CC BY 4.0). -->
{#snippet credited(verb: string)}
	{#if view.kind === 'ready'}
		{@const credit = view.credit}
		<p class="credit">
			{verb}
			<a href={credit.url} target="_blank" rel="noopener noreferrer">{credit.source}</a>
			(<a href={credit.licenceUrl} target="_blank" rel="noopener noreferrer">{credit.licence}</a>)
		</p>
	{/if}
{/snippet}

<Dialog bind:open title={word} description="Definition">
	<div class="card" data-testid="define-card" aria-busy={view.kind === 'loading'}>
		{#if view.kind === 'loading'}
			<div class="status"><Progress kind="circular" size={24} label="Looking it up" /></div>
		{:else if view.kind === 'error'}
			<p class="status" role="alert">
				The dictionary couldn’t open. Check your connection and try again.
			</p>
		{:else if result && result.definitions.length}
			{#each result.definitions as definition (definition.headword)}
				<section aria-label={definition.headword}>
					{#if definition.headword !== result.word || result.definitions.length > 1}
						<h3 lang="en">{definition.headword}</h3>
					{/if}
					{#each definition.parts as part (part.label)}
						<p class="part">
							<span class="pos">{part.label}</span>{#if part.ipa}<span class="ipa" lang="en-fonipa"
									>/{part.ipa}/</span
								>{/if}
						</p>
						<ol>
							{#each all ? part.meanings : part.meanings.slice(0, SHOWN) as meaning, i (i)}
								<li>
									{meaning.definition}{#if meaning.example}<span class="example"
											>“{meaning.example}”</span
										>{/if}
								</li>
							{/each}
						</ol>
					{/each}
				</section>
			{/each}
			{#if more}
				<Button variant="text" onclick={() => (all = !all)}
					>{all ? 'Fewer meanings' : 'More meanings'}</Button
				>
			{/if}
			{@render credited('From')}
		{:else}
			<p>“{word}” isn’t in the dictionary on this device.</p>
			<div class="online">
				<Button
					variant="tonal"
					icon="open_in_new"
					href={wiktionaryUrl(word)}
					target="_blank"
					rel="noopener noreferrer"
					aria-describedby="define-online-note">Look up on Wiktionary</Button
				>
				<p class="note" id="define-online-note">
					Opens Wiktionary on the web, which will see the word.
				</p>
			</div>
			{@render credited('Searched')}
		{/if}
	</div>
	{#snippet actions()}
		{#if view.kind === 'error'}
			<Button variant="text" onclick={() => attempt++}>Try again</Button>
		{/if}
		<Button onclick={() => (open = false)}>Close</Button>
	{/snippet}
</Dialog>

<style>
	.card {
		display: grid;
		gap: var(--space-2);
	}

	.status {
		display: flex;
		justify-content: center;
		margin: 0;
		padding: var(--space-3) 0;
	}

	section {
		display: grid;
		gap: var(--space-1);
	}

	section + section {
		padding-top: var(--space-2);
		border-top: 1px solid var(--md-sys-color-outline-variant);
	}

	h3 {
		margin: 0;
		font-family: var(--font-literata);
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: 600;
	}

	p {
		margin: 0;
	}

	.part {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: baseline;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.pos {
		font-style: italic;
	}

	ol {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding-left: 1.5em;
		font-family: var(--font-literata);
		line-height: 1.5;
	}

	.example {
		display: block;
		color: var(--md-sys-color-on-surface-variant);
		font-style: italic;
	}

	.online {
		display: grid;
		justify-items: start;
		gap: var(--space-1);
	}

	.note,
	.credit {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.credit a {
		color: inherit;
	}
</style>
