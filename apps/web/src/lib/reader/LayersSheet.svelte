<script lang="ts">
	import {
		illustrationModes,
		type IllustrationMode,
		type IllustrationPackSummaryDto
	} from '@book/core';
	import { AdaptiveSheet, Badge, IconButton, RadioGroup, Switch } from '@book/ui';
	import type { BookIllustrations } from './illustrations.svelte';

	/**
	 * The Layers menu (P1-LAY-07, §8.1): how pictures show (the Illustration mode), and which
	 * packs, in what order. Each pack says who made it, whether it's official, whether AI was used
	 * and whose work it is. Only packs the reader holds can be turned on.
	 */
	interface Props {
		open: boolean;
		mode: IllustrationMode;
		illustrations: BookIllustrations;
		onmode: (mode: IllustrationMode) => void;
		/** The Book's store page, where packs the reader doesn't have can be got. */
		storeHref?: string | null;
		/** "Hide AI-generated content" (P1-STO-05). */
		hideAi?: boolean;
	}

	let {
		open = $bindable(),
		mode,
		illustrations,
		onmode,
		storeHref = null,
		hideAi = false
	}: Props = $props();

	const MODE_LABELS: Record<IllustrationMode, string> = {
		popup: 'Pop-up',
		'per-page': 'Per page',
		spread: 'Spread',
		'in-text': 'In text',
		off: 'Off'
	};
	const MODE_HINTS: Record<IllustrationMode, string> = {
		popup: 'A picture button on the page. The text never moves.',
		'per-page': 'The picture for where you are, beside the text (above it on phones).',
		spread: 'A wide area above the text, for double-page pictures.',
		'in-text': 'Pictures in the text where the illustrator placed them, like a printed book.',
		off: 'No pictures.'
	};
	const AI_LABELS: Record<IllustrationPackSummaryDto['aiUse'], string> = {
		none: 'No AI used',
		assisted: 'Made with AI help',
		generated: 'AI-generated'
	};

	/** Enabled packs first, in priority order, then the rest (less AI-generated ones if hidden). */
	const ordered = $derived(
		[
			...illustrations.enabled
				.map((id) => illustrations.packs.find((p) => p.id === id))
				.filter((p): p is IllustrationPackSummaryDto => !!p),
			...illustrations.packs.filter((p) => !illustrations.enabled.includes(p.id))
		].filter((p) => !(hideAi && p.aiUse === 'generated'))
	);
</script>

<AdaptiveSheet bind:open title="Illustrations" side="end" height="half" scrim={false}>
	<div class="content">
		<RadioGroup
			label="Show pictures"
			value={mode}
			onchange={(next: IllustrationMode) => onmode(next)}
			options={illustrationModes.map((m) => ({
				value: m,
				label: MODE_LABELS[m],
				description: MODE_HINTS[m]
			}))}
		/>

		<section aria-labelledby="packs-heading">
			<h3 id="packs-heading">Packs</h3>
			<ul class="packs">
				{#each ordered as pack (pack.id)}
					{@const position = illustrations.enabled.indexOf(pack.id)}
					<li class="pack" data-testid="layer-pack">
						<div class="about">
							<div class="title">
								<span class="name">{pack.name}</span>
								{#if pack.isOfficial}<Badge>Official</Badge>{:else if pack.endorsed}<Badge
										tone="primary"
										icon="verified">Author-endorsed</Badge
									>{/if}
							</div>
							<p class="meta">
								By {pack.creatorName} · {pack.illustrationCount} pictures · {AI_LABELS[pack.aiUse]}
							</p>
							<p class="credit">{pack.credit}</p>
							{#if !pack.entitled}
								<p class="hint">
									You don’t have this pack yet.
									<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved by the reader -->
									{#if storeHref}<a href={storeHref}>Get it in the store</a>{/if}
								</p>
							{/if}
						</div>
						<div class="controls">
							<Switch
								label={`Show ${pack.name}`}
								hideLabel
								checked={position >= 0}
								disabled={!pack.entitled}
								onchange={(on) => void illustrations.setEnabled(pack.id, on)}
							/>
							{#if position >= 0 && illustrations.enabled.length > 1}
								<IconButton
									size="small"
									icon="arrow_upward"
									label={`Move ${pack.name} up`}
									disabled={position === 0}
									onclick={() => void illustrations.move(pack.id, -1)}
								/>
								<IconButton
									size="small"
									icon="arrow_downward"
									label={`Move ${pack.name} down`}
									disabled={position === illustrations.enabled.length - 1}
									onclick={() => void illustrations.move(pack.id, 1)}
								/>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
			{#if illustrations.enabled.length > 1}
				<p class="hint">
					When several packs have a picture for the same place, the first one shows; swipe or use
					the arrows to see the others.
				</p>
			{/if}
		</section>
	</div>
</AdaptiveSheet>

<style>
	.content {
		display: grid;
		gap: var(--space-5);
	}

	h3 {
		margin: 0;
		font-size: var(--md-sys-typescale-title-small-size);
		font-weight: var(--md-sys-typescale-weight-medium);
		color: var(--md-sys-color-on-surface-variant);
	}

	.hint {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.packs {
		display: grid;
		gap: var(--space-3);
		margin: var(--space-3) 0;
		padding: 0;
		list-style: none;
	}

	.pack {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--md-sys-shape-corner-medium);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline-variant);
	}

	.about {
		display: grid;
		flex: 1;
		gap: var(--space-1);
		min-width: 0;
	}

	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.name {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.meta,
	.credit {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.controls {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
	}
</style>
