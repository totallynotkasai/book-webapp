<script lang="ts">
	import type { FontId } from '@book/core';
	import { fontStacks } from '@book/tokens';
	import { Button, Dialog, SegmentedButton } from '@book/ui';
	import { copyImage, copyText } from '$lib/clipboard';
	import { getPlatform } from '$lib/platform';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import {
		QUOTE_MAX_WORDS,
		quoteAlt,
		quoteFileName,
		quoteText,
		type Quote,
		type QuoteSource
	} from './quote';
	import { drawQuoteCard, type CardColours } from './quote-card';

	/**
	 * Share quote (P1-RDR-16; plan §6 Phase 1.17 UX notes): a preview of the card in the reader's
	 * theme, as a picture or as text, then Android's share sheet, or on the web a copy and a
	 * download (and the browser's share sheet where it has one, as phones do). Loads on first use.
	 */
	interface Props {
		open: boolean;
		quote: Quote | null;
		source: QuoteSource;
		colours: CardColours;
		font: FontId;
		/** The Book's writing direction. */
		dir: 'ltr' | 'rtl';
	}

	let { open = $bindable(), quote, source, colours, font, dir }: Props = $props();

	const platform = getPlatform();
	let format = $state<'image' | 'text'>('image');
	let card = $state.raw<{ file: File; url: string } | null>(null);
	let failed = $state(false);

	const text = $derived(quote ? quoteText(quote, source) : '');
	const alt = $derived(quote ? quoteAlt(quote, source) : '');
	const canCopyImage = typeof ClipboardItem !== 'undefined';
	const content = $derived(
		format === 'image' && card ? { title: source.title, text, file: card.file } : { text }
	);
	const canShare = $derived(platform.share.canShare(content));

	// The card is drawn each time the dialog opens on a passage (the theme may have changed).
	$effect(() => {
		if (!open || !quote) return;
		let cancelled = false;
		let url: string | undefined;
		failed = false;
		const uiFont = getComputedStyle(document.documentElement).getPropertyValue('--font-ui');
		drawQuoteCard({ quote, source, colours, font, dir, uiFont: uiFont.trim() || 'sans-serif' })
			.then((blob) => {
				if (cancelled) return;
				url = URL.createObjectURL(blob);
				card = { file: new File([blob], quoteFileName(source), { type: 'image/png' }), url };
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
			card = null;
		};
	});

	function done(message: string) {
		open = false;
		snackbars.show(message);
	}

	async function share() {
		const result = await platform.share.share(content);
		if (result === 'shared') open = false;
		else if (result === 'unsupported') {
			snackbars.show('Sharing isn’t available here. Copy it instead.', { tone: 'error' });
		}
	}

	async function copy() {
		if (format === 'text') {
			if (await copyText(text)) done('Quote copied');
			else snackbars.show('Couldn’t copy the quote. Try again.', { tone: 'error' });
		} else if (card && (await copyImage(card.file))) {
			done('Picture copied');
		} else {
			snackbars.show('Couldn’t copy the picture. Download it instead.', { tone: 'error' });
		}
	}

	async function download() {
		if (!card) return;
		const result = await platform.files.saveFile({
			name: card.file.name,
			mimeType: 'image/png',
			data: card.file
		});
		if (result === 'saved') done('Picture saved');
	}
</script>

<Dialog bind:open title="Share quote" size="medium">
	<div class="share" data-testid="share-quote">
		<SegmentedButton
			label="Share as"
			value={format}
			onchange={(next) => (format = next)}
			options={[
				{ value: 'image', label: 'Picture', icon: 'image' },
				{ value: 'text', label: 'Text', icon: 'text_fields' }
			]}
		/>

		{#if format === 'image'}
			<div class="preview">
				{#if card}
					<img src={card.url} {alt} width="1080" height="1350" data-testid="quote-card" />
				{:else if failed}
					<p role="alert">The picture couldn’t be made on this device. Share it as text instead.</p>
				{:else}
					<div
						class="drawing"
						style:background={colours.page}
						role="status"
						aria-label="Making the picture"
					></div>
				{/if}
			</div>
		{:else}
			<blockquote
				class="text-card"
				{dir}
				style:background={colours.page}
				style:color={colours.text}
				style:font-family={fontStacks[font] ?? fontStacks.literata}
				data-testid="quote-text"
			>
				{text}
			</blockquote>
		{/if}

		{#if quote?.shortened}
			<p class="note">Long passages are shortened to about {QUOTE_MAX_WORDS} words.</p>
		{/if}
	</div>

	{#snippet actions()}
		{#if format === 'image' && platform.kind === 'web'}
			<Button variant="text" icon="download" disabled={!card} onclick={() => void download()}
				>Download</Button
			>
		{/if}
		{#if platform.kind === 'web' && (format === 'text' || canCopyImage)}
			<Button
				variant={canShare ? 'text' : 'filled'}
				icon="content_copy"
				disabled={format === 'image' && !card}
				onclick={() => void copy()}>{format === 'image' ? 'Copy picture' : 'Copy text'}</Button
			>
		{/if}
		{#if canShare}
			<Button
				variant="filled"
				icon="share"
				disabled={format === 'image' && !card}
				onclick={() => void share()}>Share</Button
			>
		{/if}
	{/snippet}
</Dialog>

<style>
	.share {
		display: grid;
		gap: var(--space-3);
		justify-items: center;
	}

	.preview {
		display: grid;
		place-items: center;
		width: 100%;
	}

	.preview img,
	.drawing {
		/* As tall as fits (half the screen at most), never wider than the dialog: 4:5 either way. */
		width: min(100%, calc(min(52vh, 27rem) * 0.8));
		height: auto;
		aspect-ratio: 4 / 5;
		border-radius: var(--md-sys-shape-corner-medium);
		box-shadow:
			0 0 0 1px var(--md-sys-color-outline-variant),
			var(--md-sys-elevation-1);
	}

	.text-card {
		width: 100%;
		margin: 0;
		padding: var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		box-shadow: inset 0 0 0 1px var(--md-sys-color-outline-variant);
		font-size: 1.05rem;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	.note {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}
</style>
