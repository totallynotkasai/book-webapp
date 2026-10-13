/**
 * `Backend.support` in the browser (P1-STO-04, DESIGN.md §6.5): Tips and Creator Subscriptions.
 * A subscription's benefits are Entitlements (`source: 'subscription'`) that last to the end of
 * the last paid period. Renewals follow the simulated clock: whenever subscriptions are looked
 * at, ended periods renew (if the simulated payment goes through) or the subscription ends.
 * Purchases are never touched.
 */
import {
	BackendError,
	tipInputSchema,
	type Clock,
	type PlanDto,
	type SubscriptionDto,
	type SupportApi,
	type TipDto,
	type UserDto
} from '@book/core';
import { addMonths, advanceSubscription, type EntitlementRecord } from '@book/domain';
import { charge, newId, serialiser } from './checkout';
import type { BackendDatabase, SubscriptionRecord, TipRecord } from './db';
import type { PlanRecord } from './seed';
import type { SimulationSettings } from './simulation';

export interface SupportModule extends SupportApi {
	/** Renews or ends the user's subscriptions as of now; call before checking early access. */
	refresh(userId: string): Promise<void>;
	/** A plan as readers see it, for the Studio's plan list (P1-STU-04). */
	planDto(plan: PlanRecord): Promise<PlanDto>;
}

export function createSupportApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	paymentOutcome: () => SimulationSettings['paymentOutcome'];
	changed: () => void;
	supportChanged: () => void;
}): SupportModule {
	const { db, clock } = deps;
	const once = serialiser();

	async function planDto(plan: PlanRecord): Promise<PlanDto> {
		const creator = await db.get('creators', plan.creatorId);
		return {
			id: plan.id,
			creatorId: plan.creatorId,
			creatorName: creator?.displayName ?? '',
			name: plan.name,
			description: plan.description,
			price: plan.price,
			benefits: await Promise.all(
				plan.benefits.map(async (b) => ({
					kind: b.kind,
					bookId: b.bookId,
					bookTitle: (await db.get('books', b.bookId))?.title ?? '',
					description: b.description
				}))
			)
		};
	}

	async function subscriptionDto(sub: SubscriptionRecord): Promise<SubscriptionDto> {
		const plan = await db.get('plans', sub.planId);
		if (!plan) throw new BackendError('SERVER_ERROR', `Plan ${sub.planId} is missing.`);
		return {
			id: sub.id,
			plan: await planDto(plan),
			status: sub.status,
			startedAt: sub.startedAt,
			currentPeriodEnd: sub.currentPeriodEnd,
			endedAt: sub.endedAt
		};
	}

	async function tipDto(tip: TipRecord): Promise<TipDto> {
		return {
			id: tip.id,
			creatorId: tip.creatorId,
			creatorName: (await db.get('creators', tip.creatorId))?.displayName ?? '',
			bookId: tip.bookId,
			amount: { amountMinor: tip.amountMinor, currency: tip.currency },
			message: tip.message,
			createdAt: tip.createdAt
		};
	}

	/** Sets when a subscription's Entitlements end: never while it renews, else its period end. */
	async function settle(sub: SubscriptionRecord) {
		const revokedAt =
			sub.status === 'ended' ? sub.endedAt : sub.cancelAtPeriodEnd ? sub.currentPeriodEnd : null;
		const tx = db.transaction(['subscriptions', 'entitlements'], 'readwrite');
		await tx.objectStore('subscriptions').put(sub);
		const entitlements = await tx.objectStore('entitlements').index('userId').getAll(sub.userId);
		for (const e of entitlements) {
			if (e.subscriptionId === sub.id && e.revokedAt !== revokedAt) {
				await tx.objectStore('entitlements').put({ ...e, revokedAt });
			}
		}
		await tx.done;
	}

	async function refresh(userId: string) {
		const now = clock.now();
		let changed = false;
		for (const sub of await db.getAllFromIndex('subscriptions', 'userId', userId)) {
			if (sub.status === 'ended') continue;
			const next = advanceSubscription(sub, now, () => deps.paymentOutcome() === 'succeed');
			if (next.status === sub.status && next.currentPeriodEnd === sub.currentPeriodEnd) continue;
			await settle({
				...sub,
				status: next.status,
				currentPeriodEnd: next.currentPeriodEnd,
				endedAt: next.endedAt,
				payments: sub.payments + next.renewalsPaid
			});
			changed = true;
		}
		if (changed) deps.changed();
	}

	return {
		refresh,
		planDto,

		async listPlans(creatorHandle) {
			const creator = await db.getFromIndex('creators', 'handle', creatorHandle);
			if (!creator) throw new BackendError('NOT_FOUND', 'There is no creator with that name.');
			const plans = await db.getAllFromIndex('plans', 'creatorId', creator.id);
			return Promise.all(plans.map(planDto));
		},

		subscribe(planId, idempotencyKey) {
			const user = deps.requireUser();
			return once(`${user.id}|${idempotencyKey}`, async () => {
				await refresh(user.id);
				const subs = await db.getAllFromIndex('subscriptions', 'userId', user.id);
				const previous = subs.find((s) => s.idempotencyKey === idempotencyKey);
				if (previous) return subscriptionDto(previous);
				const plan = await db.get('plans', planId);
				if (!plan) throw new BackendError('NOT_FOUND', 'That plan isn’t available.');
				if (subs.some((s) => s.planId === planId && s.status === 'active')) {
					throw new BackendError('CONFLICT', 'You already subscribe to this plan.');
				}
				charge(deps.paymentOutcome());
				// A cancelled one still running is replaced: its benefits carry on under the new one.
				for (const s of subs.filter((s) => s.planId === planId && s.status === 'cancelled')) {
					await settle({ ...s, status: 'ended', endedAt: clock.now().toISOString() });
				}
				const now = clock.now().toISOString();
				const sub: SubscriptionRecord = {
					id: newId('sub'),
					userId: user.id,
					planId,
					idempotencyKey,
					status: 'active',
					startedAt: now,
					currentPeriodEnd: addMonths(now, 1),
					cancelAtPeriodEnd: false,
					endedAt: null,
					payments: 1
				};
				const benefits: EntitlementRecord[] = plan.benefits.map((b) => ({
					id: newId('ent'),
					userId: user.id,
					productId: b.productId,
					source: 'subscription',
					grantedAt: now,
					revokedAt: null,
					parentId: null,
					subscriptionId: sub.id
				}));
				const tx = db.transaction(['subscriptions', 'entitlements'], 'readwrite');
				await tx.objectStore('subscriptions').put(sub);
				for (const e of benefits) await tx.objectStore('entitlements').put(e);
				await tx.done;
				deps.changed();
				return subscriptionDto(sub);
			});
		},

		async cancel(subscriptionId) {
			const user = deps.requireUser();
			await refresh(user.id);
			const sub = await db.get('subscriptions', subscriptionId);
			if (!sub || sub.userId !== user.id) {
				throw new BackendError('NOT_FOUND', 'That subscription isn’t yours.');
			}
			if (sub.status !== 'active') return subscriptionDto(sub);
			const cancelled: SubscriptionRecord = {
				...sub,
				status: 'cancelled',
				cancelAtPeriodEnd: true
			};
			await settle(cancelled);
			deps.changed();
			return subscriptionDto(cancelled);
		},

		async listSubscriptions() {
			const user = deps.requireUser();
			await refresh(user.id);
			const subs = (await db.getAllFromIndex('subscriptions', 'userId', user.id)).sort((a, b) =>
				b.startedAt.localeCompare(a.startedAt)
			);
			return Promise.all(subs.map(subscriptionDto));
		},

		tip(input) {
			const user = deps.requireUser();
			const tip = tipInputSchema.parse(input);
			return once(`${user.id}|${tip.idempotencyKey}`, async () => {
				const tips = await db.getAllFromIndex('tips', 'userId', user.id);
				const previous = tips.find((t) => t.idempotencyKey === tip.idempotencyKey);
				if (previous) return tipDto(previous);
				if (!(await db.get('creators', tip.creatorId))) {
					throw new BackendError('NOT_FOUND', 'There is no creator with that name.');
				}
				charge(deps.paymentOutcome());
				const record: TipRecord = {
					id: newId('tip'),
					userId: user.id,
					idempotencyKey: tip.idempotencyKey,
					creatorId: tip.creatorId,
					bookId: tip.bookId,
					amountMinor: tip.amount.amountMinor,
					currency: tip.amount.currency,
					message: tip.message?.trim() || null,
					createdAt: clock.now().toISOString()
				};
				await db.put('tips', record);
				deps.supportChanged();
				return tipDto(record);
			});
		},

		async listTips() {
			const user = deps.requireUser();
			const tips = (await db.getAllFromIndex('tips', 'userId', user.id)).sort((a, b) =>
				b.createdAt.localeCompare(a.createdAt)
			);
			return Promise.all(tips.map(tipDto));
		}
	};
}
