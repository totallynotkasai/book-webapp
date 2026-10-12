<script lang="ts">
	import { Button, Dialog, Icon, Progress } from '@book/ui';
	import { readerHref } from '$lib/links';
	import { getPlatform } from '$lib/platform';
	import { importEpub, migrationText, reportSummary, type ImportOutcome } from './import';

	/**
	 * Import an EPUB (P1-ING-02): pick a file, watch it process, then read a plain-language report
	 * (plan §6, Phase 1.2 UX notes). Exposes `start()` for the Library's Import button.
	 */
	interface Props {
		onimported?: () => void;
	}

	let { onimported }: Props = $props();

	let open = $state(false);
	let stage = $state<'working' | 'done'>('working');
	let fraction = $state<number | null>(null);
	let fileName = $state('');
	let outcome = $state<ImportOutcome>();

	export async function start() {
		const [file] = await getPlatform().files.pickFiles({
			accept: ['.epub', 'application/epub+zip']
		});
		if (!file) return;
		await run(file.name, new Uint8Array(await file.arrayBuffer()));
	}

	/** Imports bytes directly (the dev panel's test books). */
	export async function run(name: string, bytes: Uint8Array) {
		fileName = name;
		fraction = null;
		outcome = undefined;
		stage = 'working';
		open = true;
		outcome = await importEpub(bytes, (f) => (fraction = f));
		stage = 'done';
		if (outcome.kind === 'imported') onimported?.();
	}
</script>

<Dialog
	bind:open
	title={stage === 'working'
		? 'Importing'
		: outcome?.kind === 'failed'
			? 'Couldn’t import this file'
			: outcome?.kind === 'already'
				? 'Already in your library'
				: 'Imported'}
	size="medium"
>
	<div class="body" aria-live="polite">
		{#if stage === 'working'}
			<p class="file">{fileName}</p>
			<Progress label="Importing {fileName}" value={fraction} />
			<p class="muted">Processing on this device. Nothing is uploaded.</p>
		{:else if outcome?.kind === 'imported'}
			<p data-testid="import-summary">{reportSummary(outcome.title, outcome.report)}</p>
			{#if outcome.newRevision}
				<p class="muted" data-testid="import-migration">{migrationText(outcome.migration)}</p>
			{/if}
			{#if outcome.report.warnings.length}
				<ul class="warnings">
					{#each outcome.report.warnings as warning (warning.code)}
						<li class={warning.severity}>
							<Icon name={warning.severity === 'warning' ? 'warning' : 'info'} size={18} />
							<span>{warning.message}</span>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if outcome?.kind === 'already'}
			<p>{outcome.title} is already in your library. Nothing changed.</p>
		{:else if outcome?.kind === 'failed'}
			<p role="alert" data-testid="import-error">{outcome.message}</p>
		{/if}
	</div>
	{#snippet actions()}
		{#if stage === 'done'}
			<Button variant="text" onclick={() => (open = false)}>Close</Button>
			{#if outcome && outcome.kind !== 'failed'}
				<Button href={readerHref(outcome.bookId)}>Read now</Button>
			{/if}
		{/if}
	{/snippet}
</Dialog>

<style>
	.body {
		display: grid;
		gap: var(--space-3);
	}

	p {
		margin: 0;
	}

	.file {
		font-weight: var(--md-sys-typescale-weight-medium);
		overflow-wrap: anywhere;
	}

	.muted {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-medium-size);
	}

	.warnings {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.warnings li {
		display: flex;
		gap: var(--space-2);
		font-size: var(--md-sys-typescale-body-medium-size);
	}

	.warnings .warning :global(svg) {
		color: var(--md-sys-color-error);
	}

	.warnings .info :global(svg) {
		color: var(--md-sys-color-on-surface-variant);
	}
</style>
