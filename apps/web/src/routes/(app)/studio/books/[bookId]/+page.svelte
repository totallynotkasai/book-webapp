<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type {
		CommunityPolicy,
		ContentRating,
		IngestWarning,
		StudioBookDetailDto,
		StudioRevisionDto
	} from '@book/core';
	import { Badge, Button, Icon, Skeleton, Switch, Tabs, TextField, RadioGroup } from '@book/ui';
	import AiLabel from '$lib/components/AiLabel.svelte';
	import BookCover from '$lib/components/BookCover.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { contentRatingLabels, formatDate, formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import { ImageProblem, prepareCover } from '$lib/studio/images';
	import LayerDetailsDialog from '$lib/studio/LayerDetailsDialog.svelte';
	import { parsePrice, priceText } from '$lib/studio/price';
	import PublishDialog from '$lib/studio/PublishDialog.svelte';
	import CurationPanel from '$lib/studio/CurationPanel.svelte';
	import {
		changeSummary,
		listingStateLabels,
		reportLine,
		revisionStateLabels
	} from '$lib/studio/summaries';
	import UploadDialog from '$lib/studio/UploadDialog.svelte';

	// A Book in the Studio (P1-STU-01, P1-STU-02, P1-LAY-05, P1-STU-03): its versions with their
	// ingest reports, its settings, and its Illustration Packs and narration.
	const bookId = $derived(page.params.bookId ?? '');
	const book = resource(async () => (await getBackend()).studio.getBook(bookId), {
		topics: ['studio']
	});

	type Tab = 'versions' | 'details' | 'illustrations' | 'narration' | 'community';
	let tab = $state<Tab>('versions');
	let uploadOpen = $state(false);
	let publishOpen = $state(false);
	let publishing = $state.raw<StudioRevisionDto | null>(null);
	let layerOpen = $state(false);
	let layerKind = $state<'pack' | 'track'>('pack');
	function newLayer(kind: 'pack' | 'track') {
		layerKind = kind;
		layerOpen = true;
	}

	const previewHref = (revisionId: string, chapterId?: string) =>
		`${resolve('/read/[bookId]', { bookId })}?preview=${encodeURIComponent(revisionId)}${
			chapterId ? `&chapter=${encodeURIComponent(chapterId)}` : ''
		}`;

	function warningsBySeverity(warnings: IngestWarning[]) {
		return [...warnings].sort(
			(a, b) => Number(b.severity === 'warning') - Number(a.severity === 'warning')
		);
	}

	// ---- details (P1-STU-02) ----

	let title = $state('');
	let description = $state('');
	let price = $state('0.00');
	let contentRating = $state<ContentRating>('all_ages');
	let warnings = $state('');
	let isSerial = $state(false);
	let earlyAccess = $state('0');
	let communityPolicy = $state<CommunityPolicy>('closed');
	let refuseAi = $state(false);
	let saving = $state(false);
	let loadedFor = '';

	$effect(() => {
		const detail = book.data;
		if (!detail || loadedFor === `${detail.id}`) return;
		loadedFor = detail.id;
		fill(detail);
	});

	function fill(detail: StudioBookDetailDto) {
		const s = detail.settings;
		title = s.title;
		description = s.description;
		price = priceText(s.price);
		contentRating = s.contentRating;
		warnings = s.contentWarnings.join(', ');
		isSerial = s.isSerial;
		earlyAccess = String(s.earlyAccessChapters);
		communityPolicy = s.communityPolicy;
		refuseAi = s.communityAi === 'refused';
	}

	const parsedPrice = $derived(parsePrice(price));

	async function saveDetails() {
		if (!parsedPrice || saving) return;
		saving = true;
		try {
			const detail = await (
				await getBackend()
			).studio.updateBook(bookId, {
				title: title.trim(),
				description,
				price: parsedPrice,
				contentRating,
				contentWarnings: warnings
					.split(',')
					.map((w) => w.trim())
					.filter(Boolean),
				isSerial,
				earlyAccessChapters: isSerial ? Math.max(0, Math.min(10, Number(earlyAccess) || 0)) : 0,
				communityPolicy,
				communityAi: refuseAi ? 'refused' : 'allowed'
			});
			fill(detail);
			snackbars.show('Saved.');
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		} finally {
			saving = false;
		}
	}

	async function chooseCover(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const cover = await prepareCover(file);
			await (await getBackend()).studio.updateBook(bookId, { cover });
			snackbars.show('Cover saved.');
		} catch (error) {
			snackbars.show(error instanceof ImageProblem ? error.message : describeError(error).message, {
				tone: 'error'
			});
		}
	}

	async function removeCover() {
		try {
			await (await getBackend()).studio.updateBook(bookId, { cover: null });
			snackbars.show('Cover removed.');
		} catch (error) {
			snackbars.show(describeError(error).message, { tone: 'error' });
		}
	}

	async function layerCreated(id: string) {
		if (layerKind === 'pack') {
			const reader = resolve('/read/[bookId]', { bookId });
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved, plus a query
			await goto(`${reader}?mode=creator&pack=${encodeURIComponent(id)}`);
		} else {
			await goto(resolve('/(app)/studio/tracks/[trackId]', { trackId: id }));
		}
	}

	const listingLabels = listingStateLabels;
</script>

<svelte:head
	><title>{book.data?.settings.title ?? 'Book'} · Studio · Book Reader</title></svelte:head
>

<div class="page">
	<StatusView resource={book} what="This book">
		{#snippet loading()}
			<Skeleton width="60%" height="2rem" />
			<Skeleton height="8rem" shape="block" />
		{/snippet}
		{#snippet children(detail)}
			<PageHeader
				title={detail.settings.title}
				back={{ href: resolve('/(app)/studio'), label: 'Back to the Studio' }}
			>
				<div class="badges">
					<Badge tone={detail.listingState === 'listed' ? 'primary' : 'neutral'}>
						{listingLabels[detail.listingState]}
					</Badge>
					{#if detail.aiUse}<AiLabel aiUse={detail.aiUse} />{/if}
					<Badge tone="simulated" icon="science">Simulated</Badge>
				</div>
				{#snippet actions()}
					{#if detail.listingState === 'listed'}
						<Button
							variant="text"
							icon="storefront"
							href={resolve('/(app)/book/[slug]', { slug: detail.slug })}>In the store</Button
						>
					{/if}
				{/snippet}
			</PageHeader>

			<Tabs
				label="This book"
				value={tab}
				onchange={(v) => (tab = v)}
				items={[
					{ value: 'versions', label: 'Versions' },
					{ value: 'details', label: 'Details' },
					{ value: 'illustrations', label: 'Illustrations' },
					{ value: 'narration', label: 'Narration' },
					{ value: 'community', label: 'Community' }
				]}
			>
				{#snippet panel(value)}
					{#if value === 'versions'}
						<div class="section">
							<Button icon="upload" onclick={() => (uploadOpen = true)}
								>{detail.revisions.length ? 'Upload a new version' : 'Upload the book'}</Button
							>
							<ol class="revisions">
								{#each detail.revisions as revision (revision.id)}
									<li data-testid="revision" data-state={revision.state}>
										<div class="revision-head">
											<Badge
												tone={revision.state === 'published'
													? 'primary'
													: revision.state === 'failed'
														? 'error'
														: 'neutral'}
												icon={revision.state === 'processing' ? 'schedule' : undefined}
											>
												{revisionStateLabels[revision.state]}
											</Badge>
											<span class="meta">Uploaded {formatDate(revision.uploadedAt)}</span>
										</div>
										{#if revision.failure}
											<p class="problem">{revision.failure}</p>
										{/if}
										{#if revision.report}
											<p class="report-line">{reportLine(revision.report)}</p>
											{#if revision.state === 'ready'}
												<p class="changes">{changeSummary(revision, detail)}</p>
											{/if}
											{#if revision.report.warnings.length}
												<details class="warnings">
													<summary>
														{revision.report.warnings.length}
														{revision.report.warnings.length === 1 ? 'thing' : 'things'} to check
													</summary>
													<ul>
														{#each warningsBySeverity(revision.report.warnings) as warning (warning.code)}
															<li>
																<Icon
																	name={warning.severity === 'warning' ? 'warning' : 'info'}
																	size={18}
																/>
																<span>
																	{warning.message}
																	{#each warning.chapterIds.slice(0, 3) as chapterId (chapterId)}
																		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- previewHref resolves -->
																		<a class="see" href={previewHref(revision.id, chapterId)}
																			>{revision.chapters.find((c) => c.chapterId === chapterId)
																				?.title || 'See it'}</a
																		>
																	{/each}
																</span>
															</li>
														{/each}
													</ul>
												</details>
											{/if}
										{/if}
										<div class="actions">
											{#if revision.state !== 'processing' && revision.state !== 'failed'}
												<Button variant="text" icon="visibility" href={previewHref(revision.id)}
													>Preview</Button
												>
											{/if}
											{#if revision.state === 'ready'}
												<Button
													icon="publish"
													onclick={() => {
														publishing = revision;
														publishOpen = true;
													}}>Publish…</Button
												>
											{/if}
										</div>
									</li>
								{/each}
							</ol>
						</div>
					{:else if value === 'details'}
						<form
							class="section details"
							onsubmit={(e) => {
								e.preventDefault();
								void saveDetails();
							}}
						>
							<div class="cover-row">
								<div class="cover">
									<BookCover
										title={detail.settings.title}
										coverUrl={detail.coverUrl}
										size="medium"
									/>
								</div>
								<div class="cover-actions">
									<label class="file">
										<span class="label">Cover picture</span>
										<input type="file" accept="image/*" onchange={(e) => void chooseCover(e)} />
									</label>
									{#if detail.coverUrl}
										<Button variant="text" icon="delete" onclick={() => void removeCover()}
											>Remove cover</Button
										>
									{/if}
								</div>
							</div>
							<TextField label="Title" bind:value={title} required />
							<TextField label="Description" bind:value={description} multiline rows={4} />
							<TextField
								label="Price (£, simulated)"
								bind:value={price}
								inputmode="decimal"
								error={parsedPrice ? undefined : 'A price like 0.00 or 3.99'}
								supportingText="0.00 makes it free. No money moves in this preview."
							/>
							<RadioGroup
								label="Content rating"
								value={contentRating}
								onchange={(v) => (contentRating = v)}
								orientation="horizontal"
								options={(['all_ages', 'teen', 'mature'] as const).map((r) => ({
									value: r,
									label: contentRatingLabels[r]
								}))}
							/>
							<TextField
								label="Content warnings"
								bind:value={warnings}
								supportingText="Separated by commas, e.g. Peril, Mild violence"
							/>
							<Switch
								label="It’s a serial"
								description="Chapters come out over time."
								checked={isSerial}
								onchange={(v) => (isSerial = v)}
							/>
							{#if isSerial}
								<TextField
									label="Early-access chapters"
									bind:value={earlyAccess}
									type="number"
									min="0"
									max="10"
									supportingText="The newest this-many chapters are for your subscribers first, for 30 days after each publish. A placeholder rule (simulated)."
								/>
							{/if}
							<RadioGroup
								label="Community illustrations and narration"
								value={communityPolicy}
								onchange={(v) => (communityPolicy = v)}
								options={[
									{
										value: 'closed',
										label: 'Not allowed',
										description: 'Only you add illustrations and narration.'
									},
									{
										value: 'approval',
										label: 'With my approval',
										description: 'Other creators can submit; you approve each one.'
									},
									{
										value: 'open',
										label: 'Open',
										description: 'Listed straight away, subject to moderation. You can remove any.'
									}
								]}
							/>
							<Switch
								label="Refuse AI-generated community content"
								checked={refuseAi}
								onchange={(v) => (refuseAi = v)}
							/>
							<div class="actions">
								<Button type="submit" pending={saving} disabled={!title.trim() || !parsedPrice}
									>Save details</Button
								>
							</div>
						</form>
					{:else if value === 'illustrations'}
						<div class="section">
							{#if detail.revisions.some((r) => r.state === 'published' || r.state === 'ready')}
								<Button icon="add_photo_alternate" onclick={() => newLayer('pack')}
									>New illustration pack</Button
								>
							{:else}
								<p class="muted">Upload the book first; pictures attach to its text.</p>
							{/if}
							<ul class="layers">
								{#each detail.packs as pack (pack.id)}
									<li data-testid="studio-pack">
										<div class="layer-text">
											<span class="name">{pack.name}</span>
											<span class="meta">
												{pack.illustrationCount}
												{pack.illustrationCount === 1 ? 'picture' : 'pictures'} ·
												{formatPrice(pack.price)}
											</span>
											<span class="badges">
												<Badge tone={pack.listingState === 'listed' ? 'primary' : 'neutral'}
													>{listingLabels[pack.listingState]}</Badge
												>
												{#if pack.missingAlt}<Badge tone="error" icon="warning"
														>{pack.missingAlt} need alt text</Badge
													>{/if}
												{#if pack.orphaned}<Badge tone="error" icon="warning"
														>{pack.orphaned} to attach again</Badge
													>{/if}
											</span>
										</div>
										<Button
											variant="tonal"
											icon="add_photo_alternate"
											href={`${resolve('/read/[bookId]', { bookId })}?mode=creator&pack=${encodeURIComponent(pack.id)}`}
											>Open in Creator mode</Button
										>
									</li>
								{/each}
							</ul>
						</div>
					{:else if value === 'narration'}
						<div class="section">
							{#if detail.revisions.some((r) => r.state === 'published' || r.state === 'ready')}
								<Button icon="mic" onclick={() => newLayer('track')}>New narration</Button>
							{:else}
								<p class="muted">Upload the book first; narration is matched to its words.</p>
							{/if}
							<ul class="layers">
								{#each detail.tracks as track (track.id)}
									<li data-testid="studio-track">
										<div class="layer-text">
											<span class="name">{track.name}</span>
											<span class="meta"
												>Read by {track.narrator} · {track.chapterCount}
												{track.chapterCount === 1 ? 'chapter' : 'chapters'}</span
											>
											<span class="badges">
												<Badge tone={track.listingState === 'listed' ? 'primary' : 'neutral'}
													>{listingLabels[track.listingState]}</Badge
												>
												{#if track.needsReview}<Badge tone="tertiary"
														>{track.needsReview} to review</Badge
													>{/if}
												{#if track.stale}<Badge tone="error" icon="warning"
														>{track.stale} out of date</Badge
													>{/if}
											</span>
										</div>
										<Button
											variant="tonal"
											href={resolve('/(app)/studio/tracks/[trackId]', { trackId: track.id })}
											>Manage</Button
										>
									</li>
								{/each}
							</ul>
						</div>
					{:else}
						<CurationPanel bookId={detail.id} />
					{/if}
				{/snippet}
			</Tabs>

			<UploadDialog
				bind:open={uploadOpen}
				bookId={detail.id}
				onuploaded={() => (tab = 'versions')}
			/>
			<PublishDialog bind:open={publishOpen} book={detail} revision={publishing} />
			<LayerDetailsDialog
				bind:open={layerOpen}
				kind={layerKind}
				bookId={detail.id}
				onsaved={(id) => void layerCreated(id)}
			/>
		{/snippet}
	</StatusView>
</div>

<style>
	.page {
		display: grid;
		/* The column never grows wider than the screen to fit wide content (tabs, tables). */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 52rem;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.section {
		display: grid;
		gap: var(--space-4);
		padding-top: var(--space-4);
		justify-items: start;
	}

	.details {
		justify-items: stretch;
		max-width: 36rem;
	}

	.revisions,
	.layers {
		display: grid;
		gap: var(--space-3);
		width: 100%;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.revisions > li,
	.layers > li {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.layers > li {
		grid-template-columns: 1fr auto;
		align-items: center;
	}

	@media (max-width: 599.98px) {
		.layers > li {
			grid-template-columns: 1fr;
		}
	}

	.revision-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.report-line,
	.changes,
	.problem {
		margin: 0;
	}

	.problem {
		color: var(--md-sys-color-error);
	}

	.changes {
		color: var(--md-sys-color-on-surface-variant);
	}

	.warnings summary {
		min-height: var(--touch-target);
		display: flex;
		align-items: center;
		cursor: pointer;
		color: var(--md-sys-color-primary);
	}

	.warnings ul {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.see {
		margin-left: var(--space-1);
	}

	.warnings li {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.meta,
	.muted {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.cover-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-items: flex-end;
	}

	.cover {
		flex: none;
		width: 6rem;
	}

	.cover-actions {
		display: grid;
		min-width: 0;
		gap: var(--space-2);
	}

	.file {
		display: grid;
		gap: var(--space-1);
	}

	.label {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.file input {
		max-width: 100%;
		min-height: var(--touch-target);
	}

	.layer-text {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.name {
		font-weight: var(--md-sys-typescale-weight-medium);
	}
</style>
