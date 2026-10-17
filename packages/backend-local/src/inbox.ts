/**
 * `Backend.inbox` in the browser (plan §4.7: an in-app inbox, no email or push in the PoC):
 * moderation outcomes and how to appeal (§10.6), community submissions waiting for an author,
 * the author's decisions, and a followed author's new Chapters (P1-STU-06).
 */
import { BackendError, type Clock, type InboxApi, type UserDto } from '@book/core';
import { newId } from './checkout';
import type { BackendDatabase, InboxRecord } from './db';

export interface InboxModule extends InboxApi {
	/** Sends a message to everyone signed in as one of a Creator's Personas, or to users. */
	notify(to: Recipients, message: Pick<InboxRecord, 'title' | 'body' | 'about'>): Promise<void>;
}

type Recipients = { userId: string } | { userIds: string[] } | { creatorId: string };

export function createInboxApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	changed: () => void;
	/** Brings what's time-based up to the clock first: Chapters out since (P1-STU-06). */
	beforeList?: () => Promise<void>;
}): InboxModule {
	const { db, clock } = deps;

	async function usersOf(to: Recipients): Promise<string[]> {
		if ('userId' in to) return [to.userId];
		if ('userIds' in to) return to.userIds;
		return (await db.getAll('personas'))
			.filter((p) => p.user.creatorId === to.creatorId)
			.map((p) => p.user.id);
	}

	return {
		async notify(to, message) {
			for (const userId of await usersOf(to)) {
				await db.put('inbox', {
					id: newId('msg'),
					userId,
					createdAt: clock.now().toISOString(),
					read: false,
					seq: await db.count('inbox'),
					...message
				});
			}
			deps.changed();
		},

		async list() {
			const user = deps.requireUser();
			await deps.beforeList?.();
			return (await db.getAllFromIndex('inbox', 'userId', user.id))
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.seq - a.seq)
				.map(({ id, title, body, createdAt, read, about }) => ({
					id,
					title,
					body,
					createdAt,
					read,
					about
				}));
		},

		async markRead(messageId) {
			const user = deps.requireUser();
			const message = await db.get('inbox', messageId);
			if (!message || message.userId !== user.id) {
				throw new BackendError('NOT_FOUND', 'That message isn’t in your inbox.');
			}
			if (!message.read) {
				await db.put('inbox', { ...message, read: true });
				deps.changed();
			}
		}
	};
}
