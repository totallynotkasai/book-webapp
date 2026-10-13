/**
 * The community and moderation part of the Backend contract (DESIGN.md §4.8, §6.6, §10.6;
 * P1-COM-01, P1-COM-02, P1-ADM-01, P1-ADM-02): Invariant 19 under every policy, the author's
 * approval and endorsement, the hub's order and ratings, follows, readers' reports, moderators'
 * actions with reasons, the append-only action log, and outcomes in creators' inboxes.
 *
 * Seed assumptions: two creator Personas (an author and a community Creator), a reader and a
 * moderator. The caller's EPUB is uploaded by the first creator, so nothing depends on the seed's
 * own Books.
 */
import {
	wordIndexSchema,
	type Backend,
	type CommunityPolicy,
	type PersonaDto,
	type RangeAnchor,
	type Role
} from '@book/core';
import { describe, expect, it } from 'vitest';
import { expectBackendError } from './backend';
import type { StudioFixtures } from './studio';

interface Context {
	backend(): Backend;
	personas(): PersonaDto[];
	conforms(module: string, method: string, value: unknown): void;
	fixtures: StudioFixtures;
}

const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52
]);
const blob = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);

export function describeCommunityContract(ctx: Context): void {
	const { conforms } = ctx;
	const persona = (role: Role, nth = 0) => {
		const found = ctx.personas().filter((p) => p.user.role === role)[nth];
		if (!found) throw new Error(`The seed needs ${nth + 1} ${role} Persona(s)`);
		return found;
	};
	const as = (role: Role, nth = 0) => ctx.backend().session.signInAs(persona(role, nth).id);
	const author = () => as('creator', 0);
	const illustrator = () => as('creator', 1);

	/** The author's published Book with the given policy, and an Anchor on its text. */
	async function authorsBook(policy: CommunityPolicy) {
		const backend = ctx.backend();
		await author();
		const upload = await backend.studio.upload(blob(ctx.fixtures.book));
		for (let i = 0; i < 400; i++) {
			const book = await backend.studio.getBook(upload.bookId);
			if (book.revisions[0]?.state !== 'processing') break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		await backend.studio.publishRevision(upload.bookId, { revisionId: upload.id, aiUse: 'none' });
		await backend.studio.updateBook(upload.bookId, { communityPolicy: policy });
		const opened = await backend.content.open(upload.bookId);
		const manifest = JSON.parse(
			await (await backend.content.read(opened.contentToken, 'manifest.json')).text()
		) as { chapters: { chapterId: string; wordCount: number }[] };
		const chapter = manifest.chapters.find((c) => c.wordCount > 0)!;
		const index = wordIndexSchema.parse(
			JSON.parse(
				await (
					await backend.content.read(opened.contentToken, `index/${chapter.chapterId}.words.json`)
				).text()
			)
		);
		const anchor: RangeAnchor = {
			kind: 'range',
			bookId: upload.bookId,
			revisionId: opened.revisionId,
			startWordId: index.words[0]![0],
			endWordId: index.words[2]![0],
			startOrdinal: index.firstOrdinal,
			endOrdinal: index.firstOrdinal + 2,
			quote: { exact: 'unused', prefix: '', suffix: '' }
		};
		return { bookId: upload.bookId, anchor };
	}

	/** As the community Creator: a pack with one described picture, ready to publish. */
	async function communityPack(bookId: string, anchor: RangeAnchor, aiUse: 'none' | 'generated') {
		const backend = ctx.backend();
		await illustrator();
		const pack = await backend.studio.createPack(bookId, { name: 'Fan art', aiUse });
		expect(pack.isOfficial).toBe(false);
		await backend.studio.addIllustration(pack.id, {
			anchor,
			placement: 'inline',
			span: 'single',
			alt: 'A drawing of the scene',
			spoilerSafe: false,
			image: { width: 1, height: 1, dominant: '#808080', variants: [{ width: 1, file: blob(PNG) }] }
		});
		return pack;
	}

	describe('community (P1-COM-01, Invariant 19)', () => {
		it('follows the author’s policy and AI choice for every combination', async () => {
			const backend = ctx.backend();
			const { bookId, anchor } = await authorsBook('closed');
			await illustrator();
			await expectBackendError(backend.studio.createPack(bookId, {}), 'FORBIDDEN');
			const hub = await backend.community.hub(bookId);
			conforms('community', 'hub', hub);
			expect(hub.canSubmit).toBe(false);

			for (const policy of ['approval', 'open'] as const) {
				for (const communityAi of ['allowed', 'refused'] as const) {
					for (const aiUse of ['none', 'generated'] as const) {
						await author();
						await backend.studio.updateBook(bookId, { communityPolicy: policy, communityAi });
						const pack = await communityPack(bookId, anchor, aiUse);
						if (aiUse === 'generated' && communityAi === 'refused') {
							await expectBackendError(backend.studio.publishPack(pack.id), 'FORBIDDEN');
							continue;
						}
						const published = await backend.studio.publishPack(pack.id);
						expect(published.listingState).toBe(policy === 'approval' ? 'pending' : 'listed');
					}
				}
			}
			// Closing it again stops new work.
			await author();
			await backend.studio.updateBook(bookId, { communityPolicy: 'closed' });
			await illustrator();
			await expectBackendError(backend.studio.createPack(bookId, {}), 'FORBIDDEN');
		});

		it('the author approves and endorses; readers rate once each and follow its creator', async () => {
			const backend = ctx.backend();
			const { bookId, anchor } = await authorsBook('approval');
			const pack = await communityPack(bookId, anchor, 'none');
			expect((await backend.studio.publishPack(pack.id)).listingState).toBe('pending');

			await author();
			const inbox = await backend.inbox.list();
			conforms('inbox', 'list', inbox);
			expect(inbox.some((m) => m.about?.id === pack.id)).toBe(true);
			const curation = await backend.studio.curation(bookId);
			conforms('studio', 'curation', curation);
			expect(curation.pending.map((l) => l.id)).toEqual([pack.id]);
			await backend.studio.decide(pack.id, 'approve', 'Lovely work.');
			const endorsed = await backend.studio.endorse(pack.id, true);
			expect(endorsed.layers.find((l) => l.id === pack.id)).toMatchObject({
				state: 'listed',
				endorsed: true
			});

			await illustrator();
			const messages = await backend.inbox.list();
			expect(messages.map((m) => m.title).join(' ')).toMatch(/is listed.*|.*endorsed/);
			await backend.inbox.markRead(messages[0]!.id);
			expect((await backend.inbox.list())[0]!.read).toBe(true);

			await as('reader');
			const hub = await backend.community.hub(bookId);
			const layer = hub.layers.find((l) => l.id === pack.id)!;
			expect(layer.endorsed).toBe(true);
			await expectBackendError(backend.community.rate(pack.id, 4), 'ENTITLEMENT_REQUIRED');
			await backend.checkout.claim(layer.productId);
			await backend.community.rate(pack.id, 2);
			const rated = await backend.community.rate(pack.id, 5);
			conforms('community', 'rate', rated);
			expect(rated.rating).toEqual({ average: 5, count: 1 });
			expect(rated.myRating).toBe(5);

			const before = await backend.community.profile(layer.creatorHandle);
			conforms('community', 'profile', before);
			const after = await backend.community.follow(layer.creatorHandle, true);
			expect(after).toMatchObject({ following: true, followers: before.followers + 1 });
			expect(after.layers.map((l) => l.id)).toContain(pack.id);
			expect((await backend.community.follow(layer.creatorHandle, false)).followers).toBe(
				before.followers
			);
		});
	});

	describe('moderation (P1-ADM-01, P1-ADM-02)', () => {
		it('a report raises a Flag; moderators act with reasons; others are refused', async () => {
			const backend = ctx.backend();
			const { bookId, anchor } = await authorsBook('open');
			const pack = await communityPack(bookId, anchor, 'none');
			await backend.studio.publishPack(pack.id);

			await as('reader');
			await backend.community.report({
				targetType: 'illustration_pack',
				targetId: pack.id,
				reason: 'ai_unlabelled',
				details: 'Looks AI-made to me.'
			});
			await expectBackendError(backend.moderation.listActions(), 'FORBIDDEN');

			await as('moderator');
			const flag = (await backend.moderation.listQueue({ limit: 100 })).items.find(
				(f) => f.targetId === pack.id && f.rule === 'report'
			)!;
			expect(flag).toBeDefined();
			const detail = await backend.moderation.getFlag(flag.id);
			conforms('moderation', 'getFlag', detail);
			expect(detail.reports).toHaveLength(1);
			expect(detail.target).toMatchObject({ type: 'illustration_pack', state: 'listed' });

			await expectBackendError(
				backend.moderation.act(flag.id, { action: 'hide', reason: '' }),
				'VALIDATION_FAILED'
			);
			const relabel = await backend.moderation.act(flag.id, {
				action: 'require_relabel',
				reason: 'Please label the AI use.'
			});
			conforms('moderation', 'act', relabel);
			expect(relabel.flag.state).toBe('open');
			expect(relabel.target).toMatchObject({ state: 'held', relabelRequired: true });

			for (const role of ['reader', 'creator'] as const) {
				await as(role);
				await expectBackendError(
					backend.moderation.act(flag.id, { action: 'approve', reason: 'Not mine to approve' }),
					'FORBIDDEN'
				);
				await expectBackendError(backend.moderation.getFlag(flag.id), 'FORBIDDEN');
			}

			await illustrator();
			expect((await backend.inbox.list()).some((m) => /correct the AI label/.test(m.title))).toBe(
				true
			);
			await backend.studio.updatePack(pack.id, { aiUse: 'assisted' });

			await as('moderator');
			const approved = await backend.moderation.act(flag.id, {
				action: 'approve',
				reason: 'Relabelled.'
			});
			expect(approved.flag.state).toBe('cleared');
			expect(approved.target).toMatchObject({
				state: 'listed',
				relabelRequired: false,
				aiUse: 'assisted'
			});
			const log = await backend.moderation.listActions();
			conforms('moderation', 'listActions', log);
			expect(log.items.slice(0, 2).map((a) => a.action)).toEqual(['approve', 'require_relabel']);
			expect(log.items[0]).toMatchObject({ reason: 'Relabelled.', targetId: pack.id });
		});
	});
}
