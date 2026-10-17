/**
 * `Backend.moderation` in the browser (DESIGN.md §10.6; P1-APP-01, P1-ADM-01, P1-ADM-02): the
 * review queue, Flag detail, actions with reasons, and the append-only action log. Moderators
 * and admins only, refused with `FORBIDDEN` here rather than just hidden in the UI.
 *
 * Also the automatic Flags (rules and thresholds in `@book/domain`): `checkPublish` runs when a
 * Book, pack or narration is published, and `report` when a reader reports something. Content
 * suspected of unlabelled AI is held (private) until a moderator decides; detector scores are
 * evidence for them, never a verdict.
 */
import {
	BackendError,
	type ActInput,
	type AiUse,
	type Clock,
	type FlagDetailDto,
	type FlagDto,
	type FlagRule,
	type FlagTargetType,
	type ListingState,
	type ModerationActionLogDto,
	type ModerationApi,
	type ReportInput,
	type UserDto
} from '@book/core';
import {
	aiUntaggedSuspected,
	DEFAULT_FLAG_THRESHOLDS,
	rapidNewAccount,
	reportPriority,
	stubDetectorScore,
	uploadVolume,
	type Permission
} from '@book/domain';
import { newId } from './checkout';
import type { CommentsModule } from './comments';
import type { BackendDatabase, ModerationActionRecord } from './db';
import type { InboxModule } from './inbox';
import { paginate } from './paging';
import type { ReviewsModule } from './reviews';
import type { FlagRecord } from './seed';
import type { SimulationSettings } from './simulation';

/** What a Book's or Layer's listing state applies to; readers' words are moderated on their own. */
type ContentType = Exclude<FlagTargetType, 'creator' | 'review' | 'comment'>;

/** Readers' own words (P1-STO-07, P1-COM-03): approved, hidden, removed, or their writer warned. */
type ReadersWords = Extract<FlagTargetType, 'review' | 'comment'>;
const readersWords = (type: FlagTargetType): type is ReadersWords =>
	type === 'review' || type === 'comment';

interface Target {
	type: FlagTargetType;
	id: string;
	title: string;
	creatorId: string | null;
	creatorName: string;
	aiUse: AiUse | null;
	state: ListingState | null;
	relabelRequired: boolean;
	bookTitle: string | null;
	bookId: string | null;
	/** A review's stars and words (P1-STO-07), or a comment's words and passage (P1-COM-03). */
	excerpt: string | null;
	/** Who wrote a review or comment: they hear the outcome, as a Creator does for their content. */
	writerId: string | null;
	/** The Book page, for the reviewer's message. */
	bookSlug: string | null;
}

export interface ModerationModule extends ModerationApi {
	/**
	 * After a Book, pack or narration is published: records it for `upload_volume`, runs the rules,
	 * raises Flags, and says whether it must be held for review instead of listed.
	 */
	checkPublish(content: {
		type: ContentType;
		id: string;
		/** For `upload_volume`: the Book, so several Revisions of one Book count once. */
		volumeTargetId: string;
		creatorId: string;
		aiUse: AiUse | null;
		priceMinor: number;
	}): Promise<{ hold: boolean }>;
	/** A reader's report: a `report` Flag, its priority rising with each report. */
	report(userId: string, input: ReportInput): Promise<void>;
	/** Whether a reported thing exists (a Book, a Layer or a review). */
	exists(type: ReportInput['targetType'], id: string): Promise<boolean>;
	/** Open and past Flags on a Book and its Layers, for the author's curation view. */
	flagsAbout(bookId: string): Promise<(FlagRecord & { targetTitle: string })[]>;
}

export function createModerationApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requirePermission: (permission: Permission) => UserDto;
	simulation: () => SimulationSettings;
	inbox: InboxModule;
	/** Readers' reviews (P1-STO-07): a report target, hidden or removed by a moderator. */
	reviews?: ReviewsModule;
	/** Readers' comments and replies (P1-COM-03): the same. */
	comments?: CommentsModule;
	changed: () => void;
}): ModerationModule {
	const { db, clock } = deps;

	async function target(type: FlagTargetType, id: string): Promise<Target> {
		const creatorName = async (creatorId: string | null) =>
			creatorId ? ((await db.get('creators', creatorId))?.displayName ?? '') : '';
		const none = { excerpt: null, writerId: null, bookSlug: null };
		if (type === 'creator') {
			const creator = await db.get('creators', id);
			return {
				type,
				id,
				title: creator?.displayName ?? id,
				creatorId: id,
				creatorName: creator?.displayName ?? '',
				aiUse: null,
				state: null,
				relabelRequired: false,
				bookTitle: null,
				bookId: null,
				...none
			};
		}
		if (type === 'review') {
			const review = await deps.reviews?.get(id);
			const book = review ? await db.get('books', review.bookId) : undefined;
			return {
				type,
				id,
				title: review
					? `Review of “${book?.title ?? review.bookId}” by ${review.reviewerName}`
					: id,
				creatorId: null,
				creatorName: review?.reviewerName ?? '',
				aiUse: null,
				state: null,
				relabelRequired: false,
				bookTitle: book?.title ?? null,
				bookId: review?.bookId ?? null,
				excerpt: review
					? `${review.stars} of 5 stars${review.spoilers ? ', marked as having spoilers' : ''}. ${review.text || '(Stars only, no words.)'}`
					: null,
				writerId: review?.userId ?? null,
				bookSlug: book?.slug ?? null
			};
		}
		if (type === 'comment') {
			const comment = await deps.comments?.get(id);
			const book = comment ? await db.get('books', comment.bookId) : undefined;
			const parent = comment?.parentId ? await deps.comments?.get(comment.parentId) : comment;
			const passage = parent?.place?.anchor?.quote.exact ?? parent?.place?.passage ?? null;
			const kind = comment?.parentId ? 'Reply' : 'Comment';
			return {
				type,
				id,
				title: comment
					? `${kind} on “${book?.title ?? comment.bookId}” by ${comment.authorName}`
					: id,
				creatorId: null,
				creatorName: comment?.authorName ?? '',
				aiUse: null,
				state: null,
				relabelRequired: false,
				bookTitle: book?.title ?? null,
				bookId: comment?.bookId ?? null,
				excerpt: comment
					? [
							`“${comment.text || '(Deleted by its writer.)'}”`,
							comment.spoilers ? 'Marked as having spoilers.' : '',
							passage ? `On the passage “${passage}”.` : ''
						]
							.filter(Boolean)
							.join(' ')
					: null,
				writerId: comment?.userId ?? null,
				bookSlug: book?.slug ?? null
			};
		}
		const record =
			type === 'book'
				? await db.get('books', id)
				: type === 'illustration_pack'
					? await db.get('illustrationPacks', id)
					: await db.get('audioTracks', id);
		if (!record) {
			return {
				type,
				id,
				title: id,
				creatorId: null,
				creatorName: '',
				aiUse: null,
				state: null,
				relabelRequired: false,
				bookTitle: null,
				bookId: null,
				...none
			};
		}
		const bookId = 'bookId' in record ? record.bookId : record.id;
		const book = type === 'book' ? null : await db.get('books', bookId);
		return {
			type,
			id,
			title: 'title' in record ? record.title : record.name,
			creatorId: record.creatorId,
			creatorName: await creatorName(record.creatorId),
			aiUse: record.aiUse,
			state: record.listingState,
			relabelRequired: record.relabelRequired,
			bookTitle: book?.title ?? null,
			bookId,
			...none
		};
	}

	/** Changes a Book's, pack's or narration's state (and relabel request). */
	async function update(
		type: ContentType,
		id: string,
		changes: { listingState?: ListingState; relabelRequired?: boolean }
	) {
		if (type === 'book') {
			const record = await db.get('books', id);
			if (record) await db.put('books', { ...record, ...changes });
		} else if (type === 'illustration_pack') {
			const record = await db.get('illustrationPacks', id);
			if (record) await db.put('illustrationPacks', { ...record, ...changes });
		} else {
			const record = await db.get('audioTracks', id);
			if (record) await db.put('audioTracks', { ...record, ...changes });
		}
	}

	async function toDto(flag: FlagRecord): Promise<FlagDto> {
		const { detectorScore: _score, ...rest } = flag;
		void _score;
		return { ...rest, targetTitle: (await target(flag.targetType, flag.targetId)).title };
	}

	async function raise(flag: Omit<FlagRecord, 'id' | 'createdAt' | 'state'>): Promise<void> {
		await db.put('flags', {
			...flag,
			id: newId('flag'),
			state: 'open',
			createdAt: clock.now().toISOString()
		});
	}

	async function logDto(record: ModerationActionRecord): Promise<ModerationActionLogDto> {
		const moderator = (await db.getAll('personas')).find((p) => p.user.id === record.moderatorId);
		const creator = record.creatorId ? await db.get('creators', record.creatorId) : undefined;
		return {
			id: record.id,
			flagId: record.flagId,
			action: record.action,
			reason: record.reason,
			moderatorName: moderator?.user.displayName ?? record.moderatorId,
			targetType: record.targetType,
			targetId: record.targetId,
			targetTitle: record.targetTitle,
			creatorName: creator?.displayName ?? '',
			createdAt: record.createdAt
		};
	}

	async function detail(flag: FlagRecord): Promise<FlagDetailDto> {
		const t = await target(flag.targetType, flag.targetId);
		const reports = (await db.getAllFromIndex('reports', 'targetId', flag.targetId))
			.filter((r) => r.targetType === flag.targetType)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.map(({ reason, details, createdAt }) => ({ reason, details, createdAt }));
		const everyFlag = await db.getAll('flags');
		const theirs: FlagRecord[] = [];
		for (const f of everyFlag) {
			if (f.id === flag.id) continue;
			if ((await target(f.targetType, f.targetId)).creatorId === t.creatorId && t.creatorId) {
				theirs.push(f);
			}
		}
		const actions = (await db.getAll('moderationActions')).filter(
			(a) => a.creatorId !== null && a.creatorId === t.creatorId
		);
		const newest = <T extends { createdAt: string }>(a: T, b: T) =>
			b.createdAt.localeCompare(a.createdAt);
		const { bookId: _bookId, writerId: _writer, bookSlug: _slug, ...visible } = t;
		void _bookId;
		void _writer;
		void _slug;
		return {
			flag: await toDto(flag),
			target: visible,
			detectorScore: flag.detectorScore,
			reports,
			history: {
				flags: await Promise.all(theirs.sort(newest).map(toDto)),
				actions: await Promise.all(actions.sort(newest).map(logDto))
			}
		};
	}

	/** Where held content goes once approved: back to the author's queue if it never got there. */
	async function approvedState(t: Target): Promise<ListingState> {
		if (t.type === 'book' || !t.bookId) return 'listed';
		const book = await db.get('books', t.bookId);
		const layer =
			t.type === 'illustration_pack'
				? await db.get('illustrationPacks', t.id)
				: await db.get('audioTracks', t.id);
		const community = !!book && book.creatorId !== t.creatorId;
		if (community && book.communityPolicy === 'approval' && !layer?.authorApproved) {
			return 'pending';
		}
		return 'listed';
	}

	const OUTCOME: Record<ActInput['action'], (title: string) => string> = {
		approve: (title) => `“${title}” was reviewed and is fine`,
		require_relabel: (title) => `Please correct the AI label on “${title}”`,
		hide: (title) => `“${title}” has been hidden from the store`,
		remove: (title) => `“${title}” has been removed`,
		warn: (title) => `A warning about “${title}”`,
		suspend: () => 'Your account has been suspended'
	};

	/**
	 * What a reviewer (P1-STO-07) or commenter (P1-COM-03) hears: readers' words can't be
	 * relabelled, and have no Creator account to suspend.
	 */
	const WORDS_OUTCOME: Partial<Record<ActInput['action'], (what: string) => string>> = {
		approve: (what) => `Your ${what} was looked at and is fine`,
		hide: (what) => `Your ${what} has been hidden`,
		remove: (what) => `Your ${what} has been removed`,
		warn: (what) => `A warning about your ${what}`
	};
	const wordsAbout = (type: ReadersWords, book: string) =>
		type === 'review' ? `review of “${book}”` : `comment on “${book}”`;

	const APPEAL =
		'If you think this is a mistake, you can appeal: reply from your Studio (in this preview, tell the owner).';

	return {
		async listQueue(page) {
			deps.requirePermission('moderation');
			const open = (await db.getAll('flags'))
				.filter((f) => f.state === 'open')
				.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
			return paginate(await Promise.all(open.map(toDto)), page);
		},

		async getFlag(flagId) {
			deps.requirePermission('moderation');
			const flag = await db.get('flags', flagId);
			if (!flag) throw new BackendError('NOT_FOUND', 'That Flag isn’t in the queue.');
			return detail(flag);
		},

		async act(flagId, input) {
			const moderator = deps.requirePermission('moderation');
			const flag = await db.get('flags', flagId);
			if (!flag) throw new BackendError('NOT_FOUND', 'That Flag isn’t in the queue.');
			const t = await target(flag.targetType, flag.targetId);
			const content = flag.targetType !== 'creator';
			if (!content && ['approve', 'require_relabel', 'hide', 'remove'].includes(input.action)) {
				if (input.action !== 'approve') {
					throw new BackendError(
						'VALIDATION_FAILED',
						'That action is for content; this Flag is about an account.'
					);
				}
			}
			let state: FlagRecord['state'] = 'actioned';
			const type = flag.targetType as ContentType;
			const wordsOutcome = WORDS_OUTCOME[input.action];
			if (readersWords(flag.targetType)) {
				if (!wordsOutcome) {
					throw new BackendError(
						'VALIDATION_FAILED',
						`A ${flag.targetType} can be approved, hidden or removed, or its writer warned.`
					);
				}
				const moderate = (outcome: 'visible' | 'hidden' | 'removed') =>
					flag.targetType === 'review'
						? deps.reviews?.moderate(t.id, outcome)
						: deps.comments?.moderate(t.id, outcome);
				if (input.action === 'approve') state = 'cleared';
				if (input.action === 'approve') await moderate('visible');
				if (input.action === 'hide') await moderate('hidden');
				if (input.action === 'remove') await moderate('removed');
			} else {
				switch (input.action) {
					case 'approve':
						state = 'cleared';
						if (content && t.state === 'held') {
							await update(type, t.id, {
								listingState: await approvedState(t),
								relabelRequired: false
							});
						} else if (content) {
							await update(type, t.id, { relabelRequired: false });
						}
						break;
					case 'require_relabel':
						// The Flag stays open: the creator relabels, then a moderator approves.
						state = 'open';
						await update(type, t.id, {
							relabelRequired: true,
							...(t.state === 'listed' ? { listingState: 'held' as const } : {})
						});
						break;
					case 'hide':
						await update(type, t.id, { listingState: 'delisted' });
						break;
					case 'remove':
						await update(type, t.id, { listingState: 'removed' });
						break;
					case 'warn':
						break;
					case 'suspend': {
						const creator = t.creatorId ? await db.get('creators', t.creatorId) : undefined;
						if (creator) await db.put('creators', { ...creator, suspended: true });
						break;
					}
				}
			}
			await db.put('flags', { ...flag, state });
			const now = clock.now().toISOString();
			await db.add('moderationActions', {
				id: newId('action'),
				flagId,
				moderatorId: moderator.id,
				action: input.action,
				reason: input.reason,
				targetType: flag.targetType,
				targetId: flag.targetId,
				targetTitle: t.title,
				creatorId: t.creatorId,
				createdAt: now,
				seq: await db.count('moderationActions')
			});
			if (readersWords(flag.targetType) && t.writerId && wordsOutcome) {
				await deps.inbox.notify(
					{ userId: t.writerId },
					{
						title: wordsOutcome(wordsAbout(flag.targetType, t.bookTitle ?? 'a book')),
						body:
							input.action === 'approve'
								? `A moderator read it after a report. ${input.reason}`
								: `${input.reason} ${APPEAL}`,
						about: t.bookSlug
							? { type: flag.targetType, id: flag.targetId, slug: t.bookSlug }
							: null
					}
				);
			} else if (t.creatorId) {
				await deps.inbox.notify(
					{ creatorId: t.creatorId },
					{
						title: OUTCOME[input.action](t.title),
						body:
							input.action === 'approve'
								? `A moderator reviewed it. ${input.reason}`
								: `${input.reason} ${APPEAL}`,
						about: { type: flag.targetType, id: flag.targetId }
					}
				);
			}
			deps.changed();
			return detail((await db.get('flags', flagId))!);
		},

		async listActions(page) {
			deps.requirePermission('moderation');
			const all = (await db.getAll('moderationActions')).sort(
				(a, b) => b.createdAt.localeCompare(a.createdAt) || b.seq - a.seq
			);
			return paginate(await Promise.all(all.map(logDto)), page);
		},

		async checkPublish(content) {
			const now = clock.now();
			const kind = content.type === 'book' ? 'book' : 'layer';
			await db.put('publishes', {
				id: newId('publish'),
				creatorId: content.creatorId,
				kind,
				targetId: content.volumeTargetId,
				at: now.toISOString()
			});
			const publishes = (await db.getAllFromIndex('publishes', 'creatorId', content.creatorId))
				.filter((p) => p.kind === kind)
				.map(({ at, targetId }) => ({ at, targetId }));
			const volume = uploadVolume(publishes, kind === 'book' ? 'books' : 'layers', now);
			const t = DEFAULT_FLAG_THRESHOLDS;
			let changed = false;
			if (volume.fires) {
				const open = (await db.getAll('flags')).some(
					(f) =>
						f.rule === 'upload_volume' && f.targetId === content.creatorId && f.state === 'open'
				);
				if (!open) {
					await raise({
						targetType: 'creator',
						targetId: content.creatorId,
						rule: 'upload_volume',
						priority: 1,
						details: `Published ${volume.count} ${kind === 'book' ? 'Books (or new versions of different Books)' : 'packs and narrations'} in ${t.days} days (threshold ${kind === 'book' ? t.books : t.layers}).`,
						detectorScore: null
					});
					changed = true;
				}
			}
			// SIMULATION: the stub detector's verdict comes from the dev panel (OPEN-09 detail).
			const score =
				content.aiUse === 'none' ? stubDetectorScore(deps.simulation().aiDetectorVerdict) : null;
			const hold = aiUntaggedSuspected({
				aiUse: content.aiUse,
				volumeFired: volume.fires,
				detectorScore: score
			});
			if (hold) {
				await raise({
					targetType: content.type,
					targetId: content.id,
					rule: 'ai_untagged_suspected',
					priority: 2,
					details: volume.fires
						? 'Published during an upload burst without an AI label. Held until a moderator looks.'
						: `The AI detector scored it ${score?.toFixed(2)} (threshold ${t.detectorScore}) and it isn’t labelled AI. Held until a moderator looks.`,
					detectorScore: score
				});
				changed = true;
			}
			const persona = (await db.getAll('personas')).find(
				(p) => p.user.creatorId === content.creatorId
			);
			if (persona && rapidNewAccount(persona, { priceMinor: content.priceMinor }, now)) {
				await raise({
					targetType: content.type,
					targetId: content.id,
					rule: 'rapid_new_account',
					priority: 1,
					details: `Paid content from an account that joined within ${t.newAccountDays} days.`,
					detectorScore: null
				});
				changed = true;
			}
			if (changed) deps.changed();
			return { hold };
		},

		async report(userId, input) {
			const now = clock.now().toISOString();
			const id = `${userId}|${input.targetType}|${input.targetId}`;
			// One report per reader per item: reporting again updates it.
			await db.put('reports', {
				id,
				userId,
				targetType: input.targetType,
				targetId: input.targetId,
				reason: input.reason,
				details: input.details ?? '',
				createdAt: now
			});
			const reports = (await db.getAllFromIndex('reports', 'targetId', input.targetId)).filter(
				(r) => r.targetType === input.targetType
			);
			const open = (await db.getAll('flags')).find(
				(f) =>
					f.rule === ('report' satisfies FlagRule) &&
					f.targetType === input.targetType &&
					f.targetId === input.targetId &&
					f.state === 'open'
			);
			const details = `${reports.length} ${reports.length === 1 ? 'reader reported' : 'readers reported'} it. Latest reason: ${input.reason.replace('_', ' ')}${input.details ? ` (“${input.details}”)` : ''}.`;
			if (open) {
				// More reports only ever raise it (§10.6).
				await db.put('flags', {
					...open,
					priority: Math.max(open.priority, reportPriority(reports.length)),
					details
				});
			} else {
				await raise({
					targetType: input.targetType,
					targetId: input.targetId,
					rule: 'report',
					priority: reportPriority(reports.length),
					details,
					detectorScore: null
				});
			}
			deps.changed();
		},

		async exists(type, id) {
			if (type === 'review') return !!(await deps.reviews?.get(id));
			if (type === 'comment') {
				const comment = await deps.comments?.get(id);
				return !!comment && comment.state !== 'deleted';
			}
			const record =
				type === 'book'
					? await db.get('books', id)
					: type === 'illustration_pack'
						? await db.get('illustrationPacks', id)
						: await db.get('audioTracks', id);
			return !!record;
		},

		async flagsAbout(bookId) {
			const packs = (await db.getAllFromIndex('illustrationPacks', 'bookId', bookId)).map(
				(p) => p.id
			);
			const tracks = (await db.getAllFromIndex('audioTracks', 'bookId', bookId)).map((t) => t.id);
			const about = new Set([bookId, ...packs, ...tracks]);
			const flags = (await db.getAll('flags'))
				.filter((f) => f.targetType !== 'creator' && about.has(f.targetId))
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
			return Promise.all(
				flags.map(async (f) => ({
					...f,
					targetTitle: (await target(f.targetType, f.targetId)).title
				}))
			);
		}
	};
}
