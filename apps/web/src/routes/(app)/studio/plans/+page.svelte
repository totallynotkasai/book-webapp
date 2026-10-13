<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PlanDto } from '@book/core';
	import { Badge, Button, Checkbox, Dialog, Skeleton, TextField } from '@book/ui';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatusView from '$lib/components/StatusView.svelte';
	import { describeError } from '$lib/errors';
	import { formatPrice } from '$lib/format';
	import { getBackend } from '$lib/services';
	import { resource } from '$lib/state/resource.svelte';
	import { snackbars } from '$lib/state/snackbar.svelte';
	import { parsePrice, priceText } from '$lib/studio/price';

	// Creator Subscription plans (P1-STU-04, DESIGN.md §6.5): monthly, with early access to the
	// Creator's serials as a benefit (a placeholder rule: OPEN-10 and OPEN-11 stay open). Readers
	// find them on the Creator's profile and next to their name on Book pages.
	const data = resource(
		async () => {
			const studio = (await getBackend()).studio;
			const [plans, books] = await Promise.all([
				studio.listPlans(),
				studio.listBooks({ limit: 100 })
			]);
			const serials = (await Promise.all(books.items.map((b) => studio.getBook(b.id)))).filter(
				(b) => b.settings.isSerial
			);
			return { plans, serials };
		},
		{ topics: ['studio', 'support'] }
	);

	let open = $state(false);
	let editing = $state.raw<PlanDto | null>(null);
	let name = $state('');
	let description = $state('');
	let price = $state('3.00');
	let earlyAccess = $state<string[]>([]);
	let saving = $state(false);
	let problem = $state<string | null>(null);

	function edit(plan: PlanDto | null) {
		editing = plan;
		name = plan?.name ?? '';
		description = plan?.description ?? '';
		price = plan ? priceText(plan.price) : '3.00';
		earlyAccess = plan?.benefits.map((b) => b.bookId) ?? [];
		problem = null;
		open = true;
	}

	const parsed = $derived(parsePrice(price));

	async function save() {
		if (!parsed || saving) return;
		saving = true;
		problem = null;
		try {
			await (
				await getBackend()
			).studio.savePlan(editing?.id ?? null, {
				name: name.trim(),
				description,
				price: parsed,
				earlyAccessBookIds: earlyAccess
			});
			open = false;
			snackbars.show(editing ? 'Plan saved.' : 'Plan created. It’s on your profile now.');
		} catch (error) {
			problem = describeError(error).message;
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Subscription plans · Studio · Book Reader</title></svelte:head>

<div class="page">
	<PageHeader
		title="Subscription plans"
		subtitle="Readers subscribe monthly to support you. Cancel any time; what they bought stays theirs."
		back={{ href: resolve('/(app)/studio'), label: 'Back to the Studio' }}
	>
		<Badge tone="simulated" icon="science">Simulated: no real money</Badge>
		{#snippet actions()}
			<Button icon="add" onclick={() => edit(null)}>New plan</Button>
		{/snippet}
	</PageHeader>

	<StatusView resource={data} what="Your plans" isEmpty={(d) => d.plans.length === 0}>
		{#snippet loading()}<Skeleton height="6rem" shape="block" />{/snippet}
		{#snippet empty()}
			<EmptyState
				icon="card_membership"
				title="No plans yet"
				message="Make a plan so readers can support you every month, for example with early access to new chapters."
			>
				{#snippet actions()}
					<Button icon="add" onclick={() => edit(null)}>New plan</Button>
				{/snippet}
			</EmptyState>
		{/snippet}
		{#snippet children({ plans })}
			<ul class="plans">
				{#each plans as plan (plan.id)}
					<li data-testid="studio-plan">
						<div class="text">
							<span class="name">{plan.name} · {formatPrice(plan.price)} a month</span>
							<span class="meta">{plan.description}</span>
							{#each plan.benefits as benefit (benefit.bookId)}
								<span class="meta">✓ {benefit.description}</span>
							{/each}
						</div>
						<Button variant="text" icon="edit" onclick={() => edit(plan)}>Edit</Button>
					</li>
				{/each}
			</ul>
		{/snippet}
	</StatusView>
</div>

<Dialog bind:open title={editing ? 'Edit plan' : 'New plan'} size="medium">
	<div class="form" data-testid="plan-form">
		<TextField label="Name" bind:value={name} required />
		<TextField label="What subscribers get" bind:value={description} multiline rows={2} />
		<TextField
			label="Price a month (£, simulated)"
			bind:value={price}
			inputmode="decimal"
			error={parsed && parsed.amountMinor >= 100 ? undefined : 'At least 1.00'}
		/>
		{#if data.data?.serials.length}
			<fieldset>
				<legend>Early access to new chapters</legend>
				{#each data.data.serials as serial (serial.id)}
					<Checkbox
						label={serial.settings.title}
						description={serial.settings.earlyAccessChapters
							? `The newest ${serial.settings.earlyAccessChapters} chapters, before everyone else`
							: 'Set how many chapters are early access in the book’s details'}
						checked={earlyAccess.includes(serial.id)}
						onchange={(on) =>
							(earlyAccess = on
								? [...earlyAccess, serial.id]
								: earlyAccess.filter((id) => id !== serial.id))}
					/>
				{/each}
			</fieldset>
		{/if}
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	</div>
	{#snippet actions()}
		<Button variant="text" onclick={() => (open = false)}>Cancel</Button>
		<Button
			disabled={!name.trim() || !parsed || parsed.amountMinor < 100}
			pending={saving}
			onclick={() => void save()}>{editing ? 'Save plan' : 'Create plan'}</Button
		>
	{/snippet}
</Dialog>

<style>
	.page {
		display: grid;
		/* The column never grows wider than the screen to fit wide content (tabs, tables). */
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		max-width: 48rem;
	}

	.plans {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.plans li {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.text {
		display: grid;
		gap: 2px;
		min-width: 0;
	}

	.name {
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.meta {
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.form {
		display: grid;
		gap: var(--space-3);
	}

	fieldset {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: var(--space-2);
		font-weight: var(--md-sys-typescale-weight-medium);
	}

	.problem {
		margin: 0;
		color: var(--md-sys-color-error);
	}
</style>
