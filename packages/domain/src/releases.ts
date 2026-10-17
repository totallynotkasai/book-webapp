/**
 * Serial release schedules (P1-STU-06, DESIGN.md §4.7): when each Chapter of a serial comes
 * out. An author gives a Chapter still to come a release time; until then it's locked for every
 * reader, and when it comes, the author's followers are told once. Shared by `backend-local` and,
 * from Phase 6, the server.
 *
 * Release times live per Book and Chapter, not per Revision, so a schedule set on an uploaded
 * version carries over when it's published, and on to the next version.
 */

interface ChapterShape {
	chapterId: string;
	wordCount: number;
	linear: boolean;
}

/** A Chapter's release, as stored. */
export interface ReleaseLike {
	chapterId: string;
	/** The time the author chose (or the publish, for a Chapter out with its version). */
	releaseAt: string;
	/** When it came out and followers were told; null while it's still to come. */
	releasedAt: string | null;
}

export type ReleaseState =
	/** Readers can open it (if they own the Book, and early access allows). */
	| { chapterId: string; state: 'out' }
	/** In a version not yet published, with no time of its own: it comes out with the version. */
	| { chapterId: string; state: 'with_version' }
	/**
	 * Comes out at `at`: its own time (`own`), or later when the Chapter before it comes out
	 * later, since a Chapter never comes out before the one ahead of it. `own` is null for a
	 * Chapter that has no time of its own and follows one that does.
	 */
	| { chapterId: string; state: 'scheduled'; at: Date; own: Date | null };

/** The Chapters a schedule applies to: those with Words in reading order (§13.2 P1-STO-04). */
export function releasableChapters<T extends ChapterShape>(chapters: readonly T[]): T[] {
	return chapters.filter((c) => c.linear && c.wordCount > 0);
}

/**
 * When each of a Revision's Chapters with Words comes out, in reading order. `published` holds
 * the Chapters of the Revision readers have now: those with no release of their own are out. A
 * Chapter that isn't in it (new in a version not yet published) and has no release comes out
 * with its version, or with the scheduled Chapter before it.
 */
export function releaseStates(
	chapters: readonly ChapterShape[],
	releases: readonly ReleaseLike[],
	published: ReadonlySet<string>
): ReleaseState[] {
	const byChapter = new Map(releases.map((r) => [r.chapterId, r]));
	let latest: Date | null = null;
	return releasableChapters(chapters).map(({ chapterId }): ReleaseState => {
		const release = byChapter.get(chapterId);
		if (release?.releasedAt || (!release && published.has(chapterId))) {
			return { chapterId, state: 'out' };
		}
		const own = release ? new Date(release.releaseAt) : null;
		const at = own && latest ? (own > latest ? own : latest) : (own ?? latest);
		if (!at) return { chapterId, state: 'with_version' };
		latest = at;
		return { chapterId, state: 'scheduled', at, own };
	});
}

/** The Chapters still to come at `now`, with when each comes out. */
export function chaptersToCome(states: readonly ReleaseState[], now: Date): Map<string, Date> {
	const out = new Map<string, Date>();
	for (const s of states) if (s.state === 'scheduled' && s.at > now) out.set(s.chapterId, s.at);
	return out;
}

/** The scheduled Chapters whose time has come by `now`, but haven't been released yet. */
export function dueReleases(
	states: readonly ReleaseState[],
	now: Date
): { chapterId: string; at: Date }[] {
	return states.flatMap((s) =>
		s.state === 'scheduled' && s.at <= now ? [{ chapterId: s.chapterId, at: s.at }] : []
	);
}

/** When the next Chapter comes out, or null when none is scheduled. */
export function nextReleaseAt(states: readonly ReleaseState[], now: Date): Date | null {
	const times = [...chaptersToCome(states, now).values()];
	return times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : null;
}

export type ScheduleProblem =
	| { code: 'not_found'; message: string }
	| { code: 'conflict'; message: string }
	| { code: 'invalid'; message: string };

/**
 * Why a Chapter can't be given a release time at all, or null when it can: it must still be to
 * come, not be the first Chapter (which comes out with the Book), and have no Chapter already out
 * after it (Chapters come out in reading order).
 */
export function scheduleBlocker(
	states: readonly ReleaseState[],
	chapterId: string
): ScheduleProblem | null {
	const index = states.findIndex((s) => s.chapterId === chapterId);
	const state = states[index];
	if (!state) {
		return { code: 'not_found', message: 'That chapter isn’t in this version of the book.' };
	}
	if (state.state === 'out') return { code: 'conflict', message: 'That chapter is already out.' };
	if (index === 0) {
		return {
			code: 'conflict',
			message: 'The first chapter comes out with the book, so it can’t wait.'
		};
	}
	if (states.slice(index + 1).some((s) => s.state === 'out')) {
		return {
			code: 'conflict',
			message: 'Chapters after this one are already out, so it can’t wait.'
		};
	}
	return null;
}

/**
 * Why a Chapter can't come out at `releaseAt`, or null when it can. `releaseAt` is a time in the
 * future, `now` (release it now: only for a Chapter of the version readers have), or null (no
 * time of its own: it comes out with its version, or with the scheduled Chapter before it).
 * Chapters come out in reading order, so a time can't be before the Chapter ahead of it, or
 * after a later Chapter's own time.
 */
export function scheduleProblem(
	states: readonly ReleaseState[],
	chapterId: string,
	releaseAt: Date | 'now' | null,
	now: Date,
	describe: { title(chapterId: string): string; when(at: Date): string } = {
		title: (id) => id,
		when: (at) => at.toISOString()
	}
): ScheduleProblem | null {
	const blocker = scheduleBlocker(states, chapterId);
	if (blocker) return blocker;
	if (releaseAt === null) return null;
	if (releaseAt !== 'now' && releaseAt <= now) {
		return { code: 'invalid', message: 'Choose a time in the future, or release it now.' };
	}
	const at = releaseAt === 'now' ? now : releaseAt;
	const index = states.findIndex((s) => s.chapterId === chapterId);
	const before = states
		.slice(0, index)
		.reverse()
		.find((s) => s.state === 'scheduled');
	if (before?.state === 'scheduled' && before.at > at) {
		return {
			code: 'invalid',
			message: `“${describe.title(before.chapterId)}” comes out ${describe.when(before.at)}, and chapters come out in order. Choose that time or later.`
		};
	}
	const after = states.slice(index + 1).find((s) => s.state === 'scheduled' && s.own);
	if (after?.state === 'scheduled' && after.own && after.own < at) {
		return {
			code: 'invalid',
			message: `“${describe.title(after.chapterId)}” is set for ${describe.when(after.own)}, and chapters come out in order. Choose an earlier time, or move that chapter first.`
		};
	}
	return null;
}

/**
 * Scheduled Chapters a new version would leave in the middle of the Book: a Chapter still to
 * come with a Chapter already out after it. Publishing it would lock a Chapter between ones
 * readers can open, so the author releases it, or removes its time, first.
 */
export function stuckReleases(states: readonly ReleaseState[]): string[] {
	const lastOut = states.map((s) => s.state).lastIndexOf('out');
	return states
		.slice(0, Math.max(0, lastOut))
		.filter((s) => s.state === 'scheduled')
		.map((s) => s.chapterId);
}
