<script lang="ts">
	import type { DraftIllustrationDto, StudioPackDto } from '@book/core';
	import { AdaptiveSheet, Badge, Button, Icon, IconButton } from '@book/ui';

	/**
	 * The pictures in a pack being built (P1-LAY-05): in reading order, each with its passage.
	 * "Show passage" goes to it and marks its Anchor range; pictures whose text changed in a new
	 * Revision (orphaned) say so and can only be removed or attached again.
	 */
	interface Props {
		open: boolean;
		pack: StudioPackDto;
		/** A thumbnail for a picture. */
		thumbnail: (illustration: DraftIllustrationDto) => Promise<string | null>;
		onshow: (illustration: DraftIllustrationDto) => void;
		onedit: (illustration: DraftIllustrationDto) => void;
		onremove: (illustration: DraftIllustrationDto) => void;
	}

	let { open = $bindable(), pack, thumbnail, onshow, onedit, onremove }: Props = $props();
</script>

<AdaptiveSheet bind:open title={`Pictures in “${pack.name}”`}>
	{#if pack.illustrations.length === 0}
		<p class="empty">
			No pictures yet. Select a passage, then choose <strong>Attach picture</strong> in the toolbar.
		</p>
	{:else}
		<ul class="pictures" data-testid="pack-pictures">
			{#each pack.illustrations as ill (ill.id)}
				<li>
					{#await thumbnail(ill) then src}
						{#if src}<img {src} alt="" />{:else}<span class="thumb"></span>{/if}
					{/await}
					<div class="text">
						<span class="quote">“{ill.anchor.quote.exact}”</span>
						{#if ill.anchorStatus === 'orphaned'}
							<Badge tone="error" icon="warning">Its text changed: attach it again</Badge>
						{:else if !ill.alt.trim()}
							<Badge tone="error" icon="warning">Needs alt text</Badge>
						{:else}
							<span class="alt">{ill.alt}</span>
						{/if}
					</div>
					<div class="actions">
						{#if ill.anchorStatus !== 'orphaned'}
							<Button variant="text" icon="visibility" onclick={() => onshow(ill)}
								>Show passage</Button
							>
							<IconButton icon="edit" label="Edit picture" onclick={() => onedit(ill)} />
						{/if}
						<IconButton icon="delete" label="Remove picture" onclick={() => onremove(ill)} />
					</div>
				</li>
			{/each}
		</ul>
	{/if}
	<p class="note">
		<Icon name="info" size={18} /> Readers see pictures only once the pack is published.
	</p>
</AdaptiveSheet>

<style>
	.empty,
	.note {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.note {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin-top: var(--space-4);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.pictures {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: 56px 1fr;
		gap: var(--space-2) var(--space-3);
		align-items: start;
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--md-sys-color-outline-variant);
	}

	img,
	.thumb {
		width: 56px;
		height: 56px;
		border-radius: var(--md-sys-shape-corner-small);
		object-fit: cover;
		background: var(--md-sys-color-surface-container-highest);
	}

	.text {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}

	.quote {
		font-style: italic;
	}

	.alt {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.actions {
		grid-column: 2;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
</style>
