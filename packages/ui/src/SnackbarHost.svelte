<script lang="ts">
	import IconButton from './IconButton.svelte';

	interface SnackbarData {
		id: number;
		message: string;
		tone: 'info' | 'error';
		action?: { label: string; run: () => void };
	}

	interface Props {
		/** The snackbar on screen, if any (the app's snackbar service owns the queue). */
		snackbar: SnackbarData | null;
		ondismiss: (id: number) => void;
		/** Pause and resume the timeout while hovered or focused. */
		onhold?: () => void;
		onrelease?: () => void;
	}

	let { snackbar, ondismiss, onhold, onrelease }: Props = $props();
</script>

<!--
	The live regions stay in the page so screen readers announce each new message: confirmations
	politely, errors assertively (§11.7).
-->
<div class="host" data-snackbar-host>
	<div aria-live="polite" aria-atomic="true" class="region">
		{#if snackbar && snackbar.tone === 'info'}{@render bar(snackbar)}{/if}
	</div>
	<div aria-live="assertive" aria-atomic="true" class="region">
		{#if snackbar && snackbar.tone === 'error'}{@render bar(snackbar)}{/if}
	</div>
</div>

{#snippet bar(s: SnackbarData)}
	<div
		class={['snackbar', s.tone]}
		role="presentation"
		onpointerenter={onhold}
		onpointerleave={onrelease}
		onfocusin={onhold}
		onfocusout={onrelease}
	>
		<p class="message">{s.message}</p>
		{#if s.action}
			<button
				type="button"
				class="action"
				onclick={() => {
					s.action?.run();
					ondismiss(s.id);
				}}>{s.action.label}</button
			>
		{/if}
		<IconButton icon="close" label="Dismiss" size="small" onclick={() => ondismiss(s.id)} />
	</div>
{/snippet}

<style>
	.host {
		position: fixed;
		right: 0;
		bottom: calc(var(--snackbar-offset, 0px) + var(--safe-bottom) + var(--space-4));
		left: 0;
		z-index: 70;
		display: flex;
		justify-content: center;
		padding: 0 var(--space-4);
		pointer-events: none;
	}

	.region:empty {
		display: none;
	}

	.snackbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: min(100%, 560px);
		min-height: 48px;
		padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
		border-radius: var(--md-sys-shape-corner-extra-small);
		background: var(--md-sys-color-inverse-surface);
		color: var(--md-sys-color-inverse-on-surface);
		box-shadow: var(--md-sys-elevation-3);
		pointer-events: auto;
		animation: rise var(--duration-base) var(--easing-emphasized-decelerate);
	}

	.snackbar :global(.icon-button) {
		color: var(--md-sys-color-inverse-on-surface);
	}

	.message {
		flex: 1;
		margin: var(--space-2) 0;
		font-size: var(--md-sys-typescale-body-medium-size);
		line-height: var(--md-sys-typescale-body-medium-line-height);
	}

	.action {
		min-height: var(--touch-target);
		padding: 0 var(--space-3);
		border: none;
		border-radius: var(--md-sys-shape-corner-full);
		background: transparent;
		color: var(--md-sys-color-inverse-primary);
		font: inherit;
		font-weight: var(--md-sys-typescale-weight-medium);
		cursor: pointer;
	}

	.action:focus-visible {
		outline: 3px solid var(--md-sys-color-inverse-primary);
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
