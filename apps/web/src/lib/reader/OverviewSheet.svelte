<script lang="ts">
	import type { ChapterPages, PageDrawing } from '@book/reader-core';
	import { IconButton, Overlay } from '@book/ui';
	import { tick } from 'svelte';

	/**
	 * Overview mode (P1-RDR-17, DESIGN.md §4.1; plan §6 Phase 1.19 UX notes): the Chapter's pages
	 * as thumbnails, four to a row on a wide screen and two on a phone, to find a place, not to
	 * read. Each is drawn from the page as it's laid out now, so it shows exactly that page's
	 * Words; choosing one goes there. Arrow keys move between them (Home and End too), Enter
	 * goes, Esc closes. A thumbnail is drawn as it comes into view. Loaded on first use.
	 */
	interface Props {
		open: boolean;
		pages: ChapterPages | null;
		/** The Chapter's title. */
		title: string;
		draw: (index: number) => PageDrawing | null;
		ongo: (index: number) => void;
	}

	let { open = $bindable(), pages, title, draw, ongo }: Props = $props();

	const GAP = 12;
	/** After the current page's number (a constant: Svelte trims an element's leading space). */
	const HERE = ' · You’re here';
	let gridWidth = $state(0);
	let grid = $state<HTMLElement>();
	let drawings = $state.raw<(PageDrawing | null | undefined)[]>([]);
	let focusIndex = $state(0);

	const landscape = $derived(!!pages && pages.width > pages.height);
	/** Four up where there's room; two on a phone (a page each is too small to scan). */
	const columns = $derived(
		Math.max(2, Math.min(4, Math.floor((gridWidth + GAP) / ((landscape ? 260 : 150) + GAP))))
	);
	const scale = $derived(
		pages && gridWidth ? (gridWidth - GAP * (columns - 1)) / columns / pages.width : 0
	);
	const count = $derived(pages?.pages.length ?? 0);
	const rtl = $derived(pages?.dir === 'rtl');

	// New pages (opened again, or the layout changed): draw them afresh, starting from here.
	$effect(() => {
		const current = pages;
		drawings = current ? Array.from({ length: current.pages.length }, () => undefined) : [];
		focusIndex = current?.current ?? 0;
		if (!current || !open) return;
		void tick().then(() => {
			const button = grid?.querySelector<HTMLElement>(`[data-index="${focusIndex}"]`);
			button?.scrollIntoView({ block: 'center' });
			button?.focus();
		});
	});

	/** Draws a page once it's near the screen. */
	function lazily(index: number) {
		return (node: HTMLElement) => {
			const observer = new IntersectionObserver(
				(entries) => {
					if (!entries.some((e) => e.isIntersecting) || drawings[index] !== undefined) return;
					const next = [...drawings];
					next[index] = draw(index);
					drawings = next;
					observer.disconnect();
				},
				{ rootMargin: '50% 0px' }
			);
			observer.observe(node);
			return () => observer.disconnect();
		};
	}

	function label(index: number): string {
		const first = pages?.pages[index]?.first;
		const words = first
			? `: “${`${first.quote.exact} ${first.quote.suffix}`.trim()}…”`
			: ', a picture';
		return `Page ${index + 1} of ${count}${index === pages?.current ? ', where you are' : ''}${words}`;
	}

	function move(to: number) {
		focusIndex = Math.max(0, Math.min(count - 1, to));
		grid?.querySelector<HTMLElement>(`[data-index="${focusIndex}"]`)?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
		const back = rtl ? 'ArrowRight' : 'ArrowLeft';
		if (event.key === forward) move(focusIndex + 1);
		else if (event.key === back) move(focusIndex - 1);
		else if (event.key === 'ArrowDown') move(focusIndex + columns);
		else if (event.key === 'ArrowUp') move(focusIndex - columns);
		else if (event.key === 'Home') move(0);
		else if (event.key === 'End') move(count - 1);
		else return;
		event.preventDefault();
	}

	function go(index: number) {
		open = false;
		ongo(index);
	}
</script>

<Overlay bind:open label={`Pages of ${title || 'this chapter'}`} variant="fullscreen">
	{#if pages}
		<div class="overview" data-testid="overview">
			<header>
				<div class="titles">
					<h2>{title || 'This chapter'}</h2>
					<p>{count} {count === 1 ? 'page' : 'pages'} · Choose one to go there</p>
				</div>
				<IconButton icon="close" label="Close" onclick={() => (open = false)} />
			</header>
			<div class="scroller">
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions (arrow keys move between the pages' buttons) -->
				<ol
					class="grid"
					dir={pages.dir}
					aria-label="Pages"
					style:--columns={columns}
					style:--gap={`${GAP}px`}
					bind:this={grid}
					bind:clientWidth={gridWidth}
					{onkeydown}
				>
					{#each pages.pages as page, index (index)}
						{@const drawing = drawings[index]}
						<li>
							<button
								type="button"
								class={['thumb', { current: index === pages.current }]}
								style:aspect-ratio={`${pages.width} / ${pages.height}`}
								style:background={pages.background}
								aria-label={label(index)}
								aria-current={index === pages.current ? 'page' : undefined}
								tabindex={index === focusIndex ? 0 : -1}
								data-index={index}
								data-testid="overview-page"
								data-first={page.first?.ordinal}
								onfocus={() => (focusIndex = index)}
								onclick={() => go(index)}
								{@attach lazily(index)}
							>
								<div
									class="page"
									aria-hidden="true"
									style:width={`${pages.width}px`}
									style:height={`${pages.height}px`}
									style:transform={`scale(${scale})`}
								>
									{#if drawing}
										{#each drawing.boxes as box, i (i)}
											<div
												class="box"
												style:left={`${box.x}px`}
												style:top={`${box.y}px`}
												style:width={`${box.width}px`}
												style:height={`${box.height}px`}
												style:background={box.background || undefined}
												style:border-top={box.border.top || undefined}
												style:border-right={box.border.right || undefined}
												style:border-bottom={box.border.bottom || undefined}
												style:border-left={box.border.left || undefined}
												style:border-radius={box.radius || undefined}
											></div>
										{/each}
										{#each drawing.images as image, i (i)}
											{#if image.src}
												<img
													class="picture"
													src={image.src}
													alt=""
													style:left={`${image.x}px`}
													style:top={`${image.y}px`}
													style:width={`${image.width}px`}
													style:height={`${image.height}px`}
												/>
											{:else}
												<div
													class="picture placeholder"
													style:left={`${image.x}px`}
													style:top={`${image.y}px`}
													style:width={`${image.width}px`}
													style:height={`${image.height}px`}
												></div>
											{/if}
										{/each}
										{#each drawing.lines as line, i (i)}
											<div
												class={['line', { justify: line.justify }]}
												style:left={`${line.x}px`}
												style:top={`${line.y}px`}
												style:width={`${line.width}px`}
												style:height={`${line.height}px`}
												style:line-height={`${line.height}px`}
											>
												{#each line.runs as run, j (j)}
													{@const style = drawing.styles[run.style]}
													<span
														style:font={style?.font}
														style:color={style?.color}
														style:text-transform={style?.transform || undefined}
														style:letter-spacing={style?.spacing || undefined}>{run.text}</span
													>
												{/each}
											</div>
										{/each}
									{/if}
								</div>
							</button>
							<span class="number" aria-hidden="true"
								>{index + 1}{#if index === pages.current}<span class="here">{HERE}</span>{/if}</span
							>
						</li>
					{/each}
				</ol>
			</div>
		</div>
	{/if}
</Overlay>

<style>
	.overview {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-rows: auto 1fr;
		padding: calc(var(--safe-top) + var(--space-2)) 0 0;
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-2) var(--space-2) var(--space-4);
		--md-sys-color-on-surface-variant: #fff;
	}

	.titles {
		flex: 1;
		min-width: 0;
	}

	h2,
	.titles p {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	h2 {
		font-size: var(--md-sys-typescale-title-medium-size);
		font-weight: 600;
	}

	.titles p {
		color: rgb(255 255 255 / 0.8);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.scroller {
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
		padding: var(--space-2) var(--space-3) calc(var(--safe-bottom) + var(--space-5));
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
		gap: var(--space-4) var(--gap);
		max-width: 1200px;
		margin: 0 auto;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}

	.thumb {
		position: relative;
		display: block;
		width: 100%;
		padding: 0;
		overflow: hidden;
		border: none;
		border-radius: var(--md-sys-shape-corner-small);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
		cursor: pointer;
	}

	.thumb.current {
		outline: 3px solid var(--md-sys-color-primary-fixed, #9cf1f0);
		outline-offset: 3px;
	}

	.thumb:focus-visible {
		outline: 3px solid #fff;
		outline-offset: 3px;
	}

	.page {
		position: absolute;
		top: 0;
		left: 0;
		overflow: hidden;
		transform-origin: 0 0;
		pointer-events: none;
	}

	.box,
	.picture,
	.line {
		position: absolute;
		box-sizing: border-box;
	}

	.picture {
		object-fit: contain;
	}

	.placeholder {
		background: rgb(128 128 128 / 0.3);
	}

	/* Not clipped: a fallback font a little wider than the page's mustn't lose a letter. */
	.line {
		white-space: pre;
	}

	.line.justify {
		text-align: justify;
		text-align-last: justify;
	}

	.number {
		color: #fff;
		font-size: var(--md-sys-typescale-body-small-size);
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.here {
		font-weight: 600;
	}
</style>
