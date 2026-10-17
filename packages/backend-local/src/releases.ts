/**
 * Serial release schedules in the browser (P1-STU-06, DESIGN.md §4.7): when a serial's
 * Chapters still to come come out, and the inbox message each of the author's followers gets
 * when one does. The rules are `@book/domain`'s (`releaseStates`, `scheduleProblem`).
 *
 * Nothing runs on a timer: like subscription renewals (P1-STO-04), releases are brought up to
 * the clock whenever something looks (`refresh`: the inbox, a Book page, opening a Book, the
 * Studio, and moving the dev clock), so moving the dev clock releases them.
 */
import {
	BackendError,
	type BackendTopic,
	type ChapterReleaseDto,
	type Clock,
	type RevisionManifest
} from '@book/core';
import {
	dueReleases,
	earlyAccessChapterIds,
	earlyAccessFreeAt,
	nextReleaseAt,
	releasableChapters,
	releaseStates,
	scheduleBlocker,
	scheduleProblem,
	stuckReleases,
	type ReleaseState
} from '@book/domain';
import type { ContentModule } from './content';
import type { BackendDatabase, ChapterReleaseRecord } from './db';
import type { InboxModule } from './inbox';
import type { BookRecord } from './seed';

export interface ReleasesModule {
	/**
	 * Releases every Chapter whose time has come: it's out, the early-access window starts again
	 * from it, and each of the author's followers gets one inbox message.
	 */
	refresh(): Promise<void>;
	/** When the Book's next Chapter comes out, for its store page. */
	nextChapterAt(book: BookRecord): Promise<string | null>;
	/** When the Book's latest Chapter came out, if any came out after its first version. */
	latestRelease(bookId: string): Promise<string | null>;
	/** Each Chapter's release as the Studio shows it, for a Revision that's current or ready. */
	forStudio(book: BookRecord, manifest: RevisionManifest): Promise<Map<string, ChapterReleaseDto>>;
	/**
	 * Gives a Chapter of `manifest` (the current Revision's when `current`, else a ready one's) a
	 * release time, or none (null). Throws the domain's problem as a `BackendError`.
	 */
	schedule(
		book: BookRecord,
		manifest: RevisionManifest,
		current: boolean,
		chapterId: string,
		releaseAt: string | null
	): Promise<void>;
	/** Chapters a new version can't be published with: scheduled, with Chapters out after them. */
	stuck(book: BookRecord, manifest: RevisionManifest): Promise<string[]>;
	/**
	 * After a Revision is published: its new Chapters come out now (or with a scheduled Chapter
	 * before them), and releases for Chapters it no longer has are dropped. The new Chapters of a
	 * Book's first version are out at once, with no message.
	 */
	published(
		book: BookRecord,
		previous: RevisionManifest | null,
		manifest: RevisionManifest
	): Promise<void>;
}

export function createReleases(deps: {
	db: BackendDatabase;
	clock: Clock;
	content: Pick<ContentModule, 'manifestOf' | 'currentRevisionId'>;
	inbox: Pick<InboxModule, 'notify'>;
	changed: (...topics: BackendTopic[]) => void;
}): ReleasesModule {
	const { db, clock, content } = deps;
	/** One release at a time, so a Chapter is announced once however many callers look. */
	let queue: Promise<unknown> = Promise.resolve();
	function serial<T>(run: () => Promise<T>): Promise<T> {
		const next = queue.then(run);
		queue = next.catch(() => undefined);
		return next;
	}

	const releasesOf = (bookId: string) => db.getAllFromIndex('chapterReleases', 'bookId', bookId);

	async function currentManifest(book: BookRecord): Promise<RevisionManifest | null> {
		if (!book.currentRevisionId && !book.epubUrl) return null;
		return content.manifestOf(await content.currentRevisionId(book));
	}

	const idsOf = (manifest: RevisionManifest | null) =>
		new Set(manifest?.chapters.map((c) => c.chapterId) ?? []);

	async function statesOf(
		book: BookRecord,
		manifest: RevisionManifest,
		current?: RevisionManifest | null
	) {
		const published = idsOf(current === undefined ? await currentManifest(book) : current);
		return releaseStates(manifest.chapters, await releasesOf(book.id), published);
	}

	const titleIn = (manifest: RevisionManifest) => (chapterId: string) =>
		manifest.chapters.find((c) => c.chapterId === chapterId)?.title ?? 'That chapter';

	const when = (at: Date) =>
		`on ${new Intl.DateTimeFormat('en-GB', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			hour: '2-digit',
			minute: '2-digit'
		}).format(at)}`;

	async function announce(book: BookRecord, manifest: RevisionManifest, chapterIds: string[]) {
		// A Book held for review or taken down isn't news (§10.6).
		if (book.listingState !== 'listed' || !chapterIds.length) return;
		const followers = (await db.getAllFromIndex('follows', 'creatorId', book.creatorId)).map(
			(f) => f.userId
		);
		if (!followers.length) return;
		const creator = await db.get('creators', book.creatorId);
		const name = creator?.displayName ?? 'The author';
		const states = await statesOf(book, manifest, manifest);
		const out = releasableChapters(manifest.chapters).filter((c) =>
			states.some((s) => s.chapterId === c.chapterId && s.state === 'out')
		);
		const early = book.earlyAccess
			? new Set(earlyAccessChapterIds(out, book.earlyAccess.chapters))
			: new Set<string>();
		for (const chapterId of chapterIds) {
			const title = titleIn(manifest)(chapterId);
			await deps.inbox.notify(
				{ userIds: followers },
				{
					title: `New chapter of ${book.title}`,
					body:
						`${name} has released “${title}”.` +
						// SIMULATION (OPEN-10): early access, as P1-STO-04 simulates it.
						(early.has(chapterId) ? ` It’s early access for ${name}’s subscribers at first.` : ''),
					about: { type: 'chapter', id: book.id, chapterId }
				}
			);
		}
	}

	/** Releases one Book's Chapters whose time has come, telling followers when `tell`. */
	async function releaseDue(book: BookRecord, tell: boolean): Promise<boolean> {
		const manifest = await currentManifest(book);
		if (!manifest) return false;
		const records = await releasesOf(book.id);
		const due = dueReleases(
			releaseStates(manifest.chapters, records, idsOf(manifest)),
			clock.now()
		);
		if (!due.length) return false;
		for (const { chapterId, at } of due) {
			const record = records.find((r) => r.chapterId === chapterId);
			await db.put('chapterReleases', {
				bookId: book.id,
				chapterId,
				releaseAt: record?.releaseAt ?? at.toISOString(),
				releasedAt: at.toISOString()
			});
		}
		const fresh = (await db.get('books', book.id)) ?? book;
		await restartEarlyAccess(fresh, due.at(-1)!.at.toISOString());
		if (tell) {
			await announce(
				fresh,
				manifest,
				due.map((d) => d.chapterId)
			);
		}
		return true;
	}

	/** SIMULATION (OPEN-10): a release starts the early-access window again (P1-STO-04). */
	async function restartEarlyAccess(book: BookRecord, releasedAt: string) {
		if (!book.earlyAccess) return;
		const freeAt = earlyAccessFreeAt(releasedAt);
		if (freeAt <= book.earlyAccess.freeAt) return;
		await db.put('books', { ...book, earlyAccess: { ...book.earlyAccess, freeAt } });
	}

	async function refreshNow(): Promise<void> {
		const pending = (await db.getAll('chapterReleases')).filter((r) => !r.releasedAt);
		let any = false;
		for (const bookId of new Set(pending.map((r) => r.bookId))) {
			const book = await db.get('books', bookId);
			if (book && (await releaseDue(book, true))) any = true;
		}
		if (any) deps.changed('catalogue', 'studio', 'entitlements');
	}

	const refresh = () => serial(refreshNow);

	return {
		refresh,

		async nextChapterAt(book) {
			const manifest = await currentManifest(book);
			if (!manifest) return null;
			const next = nextReleaseAt(await statesOf(book, manifest, manifest), clock.now());
			return next?.toISOString() ?? null;
		},

		async latestRelease(bookId) {
			const times = (await releasesOf(bookId))
				.map((r) => r.releasedAt)
				.filter((t): t is string => !!t)
				.sort();
			return times.at(-1) ?? null;
		},

		async forStudio(book, manifest) {
			const states = await statesOf(book, manifest);
			const out = new Map<string, ChapterReleaseDto>();
			for (const state of states) {
				const schedulable = state.state !== 'out' && !scheduleBlocker(states, state.chapterId);
				out.set(state.chapterId, dtoOf(state, schedulable));
			}
			return out;
		},

		async schedule(book, manifest, current, chapterId, releaseAt) {
			const now = clock.now();
			const states = await statesOf(book, manifest);
			const problem = scheduleProblem(
				states,
				chapterId,
				releaseAt ? new Date(releaseAt) : current ? 'now' : null,
				now,
				{ title: titleIn(manifest), when }
			);
			if (problem) {
				throw new BackendError(
					problem.code === 'not_found'
						? 'NOT_FOUND'
						: problem.code === 'conflict'
							? 'CONFLICT'
							: 'VALIDATION_FAILED',
					problem.message
				);
			}
			if (!releaseAt && !current) {
				// No time of its own: it comes out with its version.
				await db.delete('chapterReleases', [book.id, chapterId]);
			} else {
				const record: ChapterReleaseRecord = {
					bookId: book.id,
					chapterId,
					releaseAt: releaseAt ?? now.toISOString(),
					releasedAt: null
				};
				await db.put('chapterReleases', record);
				// "Release now" comes out at once (and is announced).
				if (current && !releaseAt) await serial(() => releaseDue(book, true));
			}
			deps.changed('studio', 'catalogue');
		},

		async stuck(book, manifest) {
			return stuckReleases(await statesOf(book, manifest)).map(titleIn(manifest));
		},

		async published(book, previous, manifest) {
			const now = clock.now().toISOString();
			const records = new Map((await releasesOf(book.id)).map((r) => [r.chapterId, r]));
			const before = idsOf(previous);
			const chapters = new Set(manifest.chapters.map((c) => c.chapterId));
			let scheduledSoFar = false;
			for (const { chapterId } of releasableChapters(manifest.chapters)) {
				const record = records.get(chapterId);
				if (record) {
					if (!record.releasedAt) scheduledSoFar = true;
					continue;
				}
				if (before.has(chapterId)) continue;
				// A first version's Chapters are out at once, unless one before them waits.
				const outNow = !previous && !scheduledSoFar;
				await db.put('chapterReleases', {
					bookId: book.id,
					chapterId,
					releaseAt: now,
					releasedAt: outNow ? now : null
				});
			}
			for (const record of records.values()) {
				if (!record.releasedAt && !chapters.has(record.chapterId)) {
					await db.delete('chapterReleases', [book.id, record.chapterId]);
				}
			}
			const fresh = (await db.get('books', book.id)) ?? book;
			if (!previous) await restartEarlyAccess(fresh, now);
			await serial(() => releaseDue(fresh, !!previous));
		}
	};
}

function dtoOf(state: ReleaseState, schedulable: boolean): ChapterReleaseDto {
	switch (state.state) {
		case 'out':
			return { state: 'out', releaseAt: null, scheduledAt: null, schedulable: false };
		case 'with_version':
			return { state: 'with_version', releaseAt: null, scheduledAt: null, schedulable };
		case 'scheduled':
			return {
				state: 'scheduled',
				releaseAt: state.at.toISOString(),
				scheduledAt: state.own?.toISOString() ?? null,
				schedulable
			};
	}
}
