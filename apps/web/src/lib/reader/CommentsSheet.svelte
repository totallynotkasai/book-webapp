<script lang="ts">
	import {
		COMMENT_MAX_LENGTH,
		type CommentDto,
		type CommentReplyDto,
		type RangeAnchor
	} from '@book/core';
	import { AdaptiveSheet, Badge, Button, Dialog, Icon, Switch, TextField } from '@book/ui';
	import { tick, untrack } from 'svelte';
	import ReportDialog from '$lib/community/ReportDialog.svelte';
	import { describeError, type DescribedError } from '$lib/errors';
	import { formatDate } from '$lib/format';
	import { onPassage } from './together';

	/**
	 * A paragraph's comments (P1-COM-03; plan §6 Phase 1.20 UX notes), from its count in the text
	 * or from "Comment" in the selection toolbar: each comment with what it's on, its replies, and
	 * Reply, Report and Delete; then a box for a new one. A comment marked as having spoilers keeps
	 * its words behind "Show comment" (D-044). Loaded on first use.
	 */
	interface Props {
		open: boolean;
		/** The paragraph's comments, in reading order. */
		comments: CommentDto[];
		/** The paragraph's Ordinals: a comment on only part of it says which part. */
		paragraph: { first: number; last: number };
		/** The paragraph's words, quoted at the top. */
		paragraphText: string;
		/** Where a new comment goes: the selection it was opened from, or the whole paragraph. */
		passage: { anchor: RangeAnchor; selected: boolean };
		/** Opened from the selection toolbar: start in the new comment's box. */
		composing: boolean;
		/** A passage's Words as the page has them, punctuation and all. */
		passageText: (anchor: RangeAnchor) => string;
		/** The author lets readers comment on this Book (D-044). */
		allowed: boolean;
		/** The reader owns the Book (D-044). */
		canComment: boolean;
		/** Its store page, for a sample reader. */
		storeHref: string | null;
		/** Why the comments couldn't be fetched. */
		error: DescribedError | null;
		onretry: () => void;
		onadd: (input: { anchor: RangeAnchor; text: string; spoilers: boolean }) => Promise<void>;
		onreply: (commentId: string, input: { text: string; spoilers: boolean }) => Promise<void>;
		onremove: (commentId: string) => Promise<void>;
	}

	let {
		open = $bindable(),
		comments,
		paragraph,
		paragraphText,
		passage,
		composing,
		passageText,
		allowed,
		canComment,
		storeHref,
		error,
		onretry,
		onadd,
		onreply,
		onremove
	}: Props = $props();

	let text = $state('');
	let spoilers = $state(false);
	let posting = $state(false);
	let problem = $state<string | null>(null);
	let box = $state<HTMLInputElement | HTMLTextAreaElement>();

	/** The comment being replied to, and its reply. */
	let replyingTo = $state<string | null>(null);
	let replyText = $state('');
	let replySpoilers = $state(false);
	let replyProblem = $state<string | null>(null);
	let replyBox = $state<HTMLInputElement | HTMLTextAreaElement>();

	/** Spoilers the reader chose to read. */
	let shown = $state<Record<string, boolean>>({});
	let reporting = $state(false);
	let reported = $state.raw<{ id: string; title: string } | null>(null);
	let deleting = $state.raw<{ id: string; reply: boolean } | null>(null);
	let confirmOpen = $state(false);

	// A fresh sheet each time it opens; from the toolbar, straight into the new comment's box.
	$effect(() => {
		if (!open) return;
		untrack(() => {
			text = '';
			spoilers = false;
			problem = null;
			replyingTo = null;
			if (composing) void tick().then(() => box?.focus());
		});
	});

	/** On part of the paragraph: say which part. */
	const onPart = (anchor: RangeAnchor) =>
		anchor.startOrdinal !== paragraph.first || anchor.endOrdinal !== paragraph.last;

	async function post() {
		if (!text.trim() || posting) return;
		posting = true;
		problem = null;
		try {
			await onadd({ anchor: passage.anchor, text: text.trim(), spoilers });
			text = '';
			spoilers = false;
		} catch (e) {
			problem = describeError(e).message;
		} finally {
			posting = false;
		}
	}

	async function startReply(commentId: string) {
		replyingTo = commentId;
		replyText = '';
		replySpoilers = false;
		replyProblem = null;
		await tick();
		replyBox?.focus();
	}

	async function sendReply() {
		if (!replyingTo || !replyText.trim() || posting) return;
		posting = true;
		replyProblem = null;
		try {
			await onreply(replyingTo, { text: replyText.trim(), spoilers: replySpoilers });
			replyingTo = null;
		} catch (e) {
			replyProblem = describeError(e).message;
		} finally {
			posting = false;
		}
	}

	async function confirmDelete() {
		const target = deleting;
		confirmOpen = false;
		if (!target) return;
		try {
			await onremove(target.id);
		} catch (e) {
			problem = describeError(e).message;
		}
	}
</script>

{#snippet words(c: CommentReplyDto, title: string)}
	<header>
		<h3 id={`comment-${c.id}`} class="name">{c.mine ? 'You' : c.authorName}</h3>
		{#if c.byAuthor}<Badge tone="primary" icon="verified">Author</Badge>{/if}
		<span class="meta">{formatDate(c.createdAt)}</span>
		<div class="actions">
			{#if c.mine}
				<Button
					variant="text"
					icon="delete"
					onclick={() => {
						deleting = { id: c.id, reply: title === 'reply' };
						confirmOpen = true;
					}}>Delete</Button
				>
			{:else}
				<Button
					variant="text"
					icon="flag"
					onclick={() => {
						reported = {
							id: c.id,
							title: `${c.authorName}’s ${title === 'reply' ? 'reply' : 'comment'}`
						};
						reporting = true;
					}}>Report</Button
				>
			{/if}
		</div>
	</header>
	{#if c.hidden}
		<p class="note">
			<Icon name="visibility_off" size={16} /> A moderator hid this after a report, so only you can see
			it. Your inbox says why.
		</p>
	{/if}
	{#if c.spoilers && !shown[c.id] && !c.mine}
		<p class="spoiler">
			<Badge tone="tertiary" icon="warning">Spoilers</Badge>
			This gives away some of what happens later.
			<Button variant="text" onclick={() => (shown[c.id] = true)}>Show comment</Button>
		</p>
	{:else}
		{#if c.spoilers}<Badge tone="tertiary" icon="warning">Spoilers</Badge>{/if}
		<p class="text">{c.text}</p>
	{/if}
{/snippet}

{#snippet spoilerSwitch(checked: boolean, onchange: (v: boolean) => void)}
	<Switch
		label="Contains spoilers"
		description="Other readers see it only if they choose to."
		{checked}
		{onchange}
	/>
{/snippet}

<Dialog
	bind:open={confirmOpen}
	title={deleting?.reply ? 'Delete your reply?' : 'Delete your comment?'}
	description={deleting?.reply
		? 'It goes for everyone.'
		: 'It goes for everyone. Any replies to it stay, under “Comment deleted”.'}
>
	{#snippet actions()}
		<Button variant="text" onclick={() => (confirmOpen = false)}>Cancel</Button>
		<Button danger onclick={() => void confirmDelete()}>Delete</Button>
	{/snippet}
</Dialog>

<ReportDialog
	bind:open={reporting}
	target={reported ? { type: 'comment', id: reported.id, title: reported.title } : null}
/>

<AdaptiveSheet bind:open title="Comments" height="half">
	<div class="sheet" data-testid="comments-sheet">
		<blockquote class="passage" aria-label="The paragraph">{paragraphText}</blockquote>

		{#if error}
			<div class="problem-box" role="alert">
				<p>{error.message}</p>
				<Button variant="text" icon="refresh" onclick={onretry}>Try again</Button>
			</div>
		{:else if !allowed}
			<p class="empty">The author has turned comments off for this book.</p>
		{:else}
			{#if !comments.length}
				<p class="empty">No comments on this paragraph yet.</p>
			{/if}
			<ol class="threads">
				{#each comments as c (c.id)}
					<li>
						<article class="comment" data-testid="comment" aria-labelledby={`comment-${c.id}`}>
							{#if c.deleted}
								<h3 id={`comment-${c.id}`} class="deleted">Comment deleted</h3>
							{:else}
								{#if onPart(c.anchor)}
									<p class="on">{onPassage(passageText(c.anchor))}</p>
								{/if}
								{@render words(c, 'comment')}
							{/if}
							{#if c.replies.length}
								<ol class="replies" aria-label="Replies">
									{#each c.replies as r (r.id)}
										<li>
											<article
												class="reply"
												data-testid="reply"
												aria-labelledby={`comment-${r.id}`}
											>
												{@render words(r, 'reply')}
											</article>
										</li>
									{/each}
								</ol>
							{/if}
							{#if canComment}
								{#if replyingTo === c.id}
									<form
										class="compose reply-box"
										onsubmit={(e) => {
											e.preventDefault();
											void sendReply();
										}}
									>
										<TextField
											label="Your reply"
											bind:value={replyText}
											bind:element={replyBox}
											multiline
											rows={2}
											maxlength={COMMENT_MAX_LENGTH}
										/>
										{@render spoilerSwitch(replySpoilers, (v) => (replySpoilers = v))}
										{#if replyProblem}<p class="problem" role="alert">{replyProblem}</p>{/if}
										<div class="buttons">
											<Button variant="text" onclick={() => (replyingTo = null)}>Cancel</Button>
											<Button
												type="submit"
												icon="reply"
												disabled={!replyText.trim()}
												pending={posting}>Reply</Button
											>
										</div>
									</form>
								{:else}
									<div class="reply-action">
										<Button variant="text" icon="reply" onclick={() => void startReply(c.id)}
											>Reply</Button
										>
									</div>
								{/if}
							{/if}
						</article>
					</li>
				{/each}
			</ol>

			{#if canComment}
				<form
					class="compose"
					aria-labelledby="new-comment"
					onsubmit={(e) => {
						e.preventDefault();
						void post();
					}}
				>
					<h3 id="new-comment" class="new">Add a comment</h3>
					{#if passage.selected}
						<p class="on">{onPassage(passageText(passage.anchor))}</p>
					{/if}
					<TextField
						label="Your comment"
						bind:value={text}
						bind:element={box}
						multiline
						rows={3}
						maxlength={COMMENT_MAX_LENGTH}
						supportingText="Other readers of this book see it, with your name."
					/>
					{@render spoilerSwitch(spoilers, (v) => (spoilers = v))}
					{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
					<div class="buttons">
						<Button type="submit" icon="add_comment" disabled={!text.trim()} pending={posting}
							>Post</Button
						>
					</div>
				</form>
			{:else}
				<p class="empty">
					Get the book to join in.
					{#if storeHref}<Button variant="text" href={storeHref}>Get the book</Button>{/if}
				</p>
			{/if}
		{/if}
	</div>
</AdaptiveSheet>

<style>
	.sheet {
		display: grid;
		gap: var(--space-4);
		padding-bottom: var(--space-4);
	}

	.passage {
		display: -webkit-box;
		margin: 0;
		padding-inline-start: var(--space-3);
		overflow: hidden;
		border-inline-start: 3px solid var(--md-sys-color-outline-variant);
		color: var(--md-sys-color-on-surface-variant);
		font-family: var(--font-literata);
		line-height: 1.5;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
	}

	.threads,
	.replies {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.comment {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3);
		border-radius: var(--md-sys-shape-corner-medium);
		background: var(--md-sys-color-surface-container-low);
	}

	.replies {
		margin-top: var(--space-2);
		padding-inline-start: var(--space-4);
		border-inline-start: 2px solid var(--md-sys-color-outline-variant);
	}

	.reply {
		display: grid;
		gap: var(--space-1);
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
	}

	.name,
	.new,
	.deleted {
		margin: 0;
		font-size: var(--md-sys-typescale-title-small-size);
	}

	.deleted {
		color: var(--md-sys-color-on-surface-variant);
		font-style: italic;
		font-weight: var(--md-sys-typescale-weight-regular, 400);
	}

	.meta,
	.on,
	.note {
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
		font-size: var(--md-sys-typescale-body-small-size);
	}

	.on {
		font-style: italic;
	}

	.note,
	.spoiler {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		margin: 0;
	}

	.actions {
		display: flex;
		margin-inline-start: auto;
	}

	.text {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.compose {
		display: grid;
		gap: var(--space-2);
	}

	.reply-box {
		margin-top: var(--space-2);
	}

	.reply-action {
		justify-self: start;
	}

	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.empty {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		color: var(--md-sys-color-on-surface-variant);
	}

	.problem,
	.problem-box p {
		margin: 0;
		color: var(--md-sys-color-error);
	}

	.problem-box {
		display: grid;
		gap: var(--space-2);
		justify-items: start;
	}
</style>
