/**
 * `Backend.checkout` in the browser (P1-STO-02, DESIGN.md §6.5): "Add to library" for free
 * Products, simulated purchases, and the orders behind them. A Bundle grants a parent
 * Entitlement and one per child the reader doesn't already own; refunding it (dev panel)
 * revokes them all. The same idempotency key always gives the same order, so a double tap buys
 * once. No card details and no money: the dev panel's payment outcome decides.
 */
import {
	BackendError,
	type CheckoutApi,
	type Clock,
	type OrderDto,
	type UserDto
} from '@book/core';
import { bundlePriceFor, ownedProductIds, revokeWithChildren } from '@book/domain';
import type { EntitlementRecord } from '@book/domain';
import type { BackendDatabase, OrderRecord } from './db';
import { paginate } from './paging';
import type { ProductRecord } from './seed';
import type { SimulationSettings } from './simulation';

export interface CheckoutModule extends CheckoutApi {
	/** Dev panel only: refunds an order, revoking what it granted (a Bundle's children too). */
	refund(orderId: string): Promise<void>;
	/** Every order, for the dev panel. */
	allOrders(): Promise<(OrderDto & { userId: string })[]>;
}

/** Throws the simulated payment outcome, if it isn't a success. */
export function charge(outcome: SimulationSettings['paymentOutcome']): void {
	if (outcome === 'decline') {
		throw new BackendError(
			'PAYMENT_DECLINED',
			'The payment was declined (simulated). Nothing was charged.'
		);
	}
	if (outcome === 'fail') {
		throw new BackendError(
			'SERVER_ERROR',
			'The payment service didn’t answer (simulated). Nothing was charged.'
		);
	}
}

/** Runs one call per key at a time, so a double tap can't create two records. */
export function serialiser() {
	const running = new Map<string, Promise<unknown>>();
	return <T>(key: string, run: () => Promise<T>): Promise<T> => {
		const existing = running.get(key) as Promise<T> | undefined;
		if (existing) return existing;
		const pending = run().finally(() => running.delete(key));
		running.set(key, pending);
		return pending;
	};
}

export function newId(prefix: string): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function createCheckoutApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	requireUser: () => UserDto;
	paymentOutcome: () => SimulationSettings['paymentOutcome'];
	changed: () => void;
}): CheckoutModule {
	const { db, clock } = deps;
	const once = serialiser();

	async function titleOf(product: ProductRecord): Promise<string> {
		switch (product.kind) {
			case 'book':
				return (await db.get('books', product.refId))?.title ?? product.refId;
			case 'illustration_pack':
				return (await db.get('illustrationPacks', product.refId))?.name ?? product.refId;
			case 'audio_track':
				return (await db.get('audioTracks', product.refId))?.name ?? product.refId;
			case 'bookmark_design':
				return (await db.get('bookmarkDesigns', product.refId))?.name ?? product.refId;
			case 'bundle': {
				const book = product.bookId ? await db.get('books', product.bookId) : undefined;
				return book ? `Complete edition: ${book.title}` : 'Complete edition';
			}
			default:
				return product.refId;
		}
	}

	async function toDto(order: OrderRecord): Promise<OrderDto> {
		const products = await Promise.all(order.items.map((i) => db.get('products', i.productId)));
		const items = await Promise.all(
			order.items.map(async (item, i) => ({
				productId: item.productId,
				kind: products[i]?.kind ?? 'book',
				title: products[i] ? await titleOf(products[i]!) : item.productId,
				price: { amountMinor: item.priceMinor, currency: order.currency }
			}))
		);
		const bought = await db.get('products', order.productId);
		return {
			id: order.id,
			status: order.status,
			items,
			total: { amountMinor: order.totalMinor, currency: order.currency },
			createdAt: order.createdAt,
			refundedAt: order.refundedAt,
			bookId: bought?.bookId ?? null
		};
	}

	/** What getting `productId` means for this user now: its price and what it would grant. */
	async function quote(user: UserDto, productId: string) {
		const product = await db.get('products', productId);
		if (!product || product.status !== 'active') {
			throw new BackendError('NOT_FOUND', 'That isn’t in the store.');
		}
		if (product.kind === 'early_access') {
			// SIMULATION (OPEN-10): early access comes only with a Creator Subscription for now.
			throw new BackendError('CONFLICT', 'Early access comes with a subscription to its author.');
		}
		const entitlements = await db.getAllFromIndex('entitlements', 'userId', user.id);
		const owned = ownedProductIds(entitlements, user.id, clock.now());
		const children =
			product.kind === 'bundle'
				? (await Promise.all(product.childProductIds.map((id) => db.get('products', id)))).filter(
						(p): p is ProductRecord => !!p
					)
				: [];
		const missing = product.kind === 'bundle' ? children.filter((c) => !owned.has(c.id)) : [];
		const allOwned = owned.has(product.id) || (product.kind === 'bundle' && missing.length === 0);
		const price =
			product.kind === 'bundle'
				? bundlePriceFor(
						product.price,
						children.map((c) => ({ productId: c.id, price: c.price })),
						owned
					)
				: product.price;
		return { product, missing, allOwned, price };
	}

	async function grant(
		user: UserDto,
		q: Awaited<ReturnType<typeof quote>>,
		idempotencyKey: string,
		status: 'paid' | 'claimed'
	): Promise<OrderRecord> {
		const now = clock.now().toISOString();
		const orderId = newId('order');
		const parent: EntitlementRecord = {
			id: newId('ent'),
			userId: user.id,
			productId: q.product.id,
			source: status === 'paid' ? 'purchase' : 'free_claim',
			grantedAt: now,
			revokedAt: null,
			parentId: null,
			orderId
		};
		const children: EntitlementRecord[] = q.missing.map((child) => ({
			id: newId('ent'),
			userId: user.id,
			productId: child.id,
			source: 'bundle',
			grantedAt: now,
			revokedAt: null,
			parentId: parent.id,
			orderId
		}));
		const order: OrderRecord = {
			id: orderId,
			userId: user.id,
			idempotencyKey,
			status,
			productId: q.product.id,
			items: [{ productId: q.product.id, priceMinor: q.price.amountMinor }],
			currency: q.price.currency,
			totalMinor: q.price.amountMinor,
			entitlementId: parent.id,
			createdAt: now,
			refundedAt: null
		};
		const tx = db.transaction(['orders', 'entitlements'], 'readwrite');
		await tx.objectStore('orders').put(order);
		for (const e of [parent, ...children]) await tx.objectStore('entitlements').put(e);
		await tx.done;
		deps.changed();
		return order;
	}

	async function existing(userId: string, key: string): Promise<OrderRecord | undefined> {
		return (await db.getAllFromIndex('orders', 'userId', userId)).find(
			(o) => o.idempotencyKey === key
		);
	}

	return {
		claim(productId) {
			const user = deps.requireUser();
			const key = `claim:${productId}`;
			return once(`${user.id}|${key}`, async () => {
				const previous = await existing(user.id, key);
				if (previous && previous.status !== 'refunded') return toDto(previous);
				const q = await quote(user, productId);
				if (q.allOwned) throw new BackendError('CONFLICT', 'That’s already in your library.');
				if (q.price.amountMinor > 0) {
					throw new BackendError('CONFLICT', 'That isn’t free; buy it instead.');
				}
				return toDto(await grant(user, q, key, 'claimed'));
			});
		},

		purchase(productId, idempotencyKey) {
			const user = deps.requireUser();
			return once(`${user.id}|${idempotencyKey}`, async () => {
				const previous = await existing(user.id, idempotencyKey);
				if (previous) return toDto(previous);
				const q = await quote(user, productId);
				if (q.allOwned) throw new BackendError('CONFLICT', 'That’s already in your library.');
				if (q.price.amountMinor > 0) charge(deps.paymentOutcome());
				return toDto(
					await grant(user, q, idempotencyKey, q.price.amountMinor > 0 ? 'paid' : 'claimed')
				);
			});
		},

		async listOrders(page) {
			const user = deps.requireUser();
			const orders = (await db.getAllFromIndex('orders', 'userId', user.id)).sort((a, b) =>
				b.createdAt.localeCompare(a.createdAt)
			);
			return paginate(await Promise.all(orders.map(toDto)), page);
		},

		async refund(orderId) {
			const order = await db.get('orders', orderId);
			if (!order || order.status === 'refunded') return;
			const at = clock.now();
			const entitlements = await db.getAllFromIndex('entitlements', 'userId', order.userId);
			const tx = db.transaction(['orders', 'entitlements'], 'readwrite');
			await tx.objectStore('orders').put({
				...order,
				status: 'refunded',
				refundedAt: at.toISOString()
			});
			for (const e of revokeWithChildren(entitlements, order.entitlementId, at)) {
				await tx.objectStore('entitlements').put(e);
			}
			await tx.done;
			deps.changed();
		},

		async allOrders() {
			const orders = (await db.getAll('orders')).sort((a, b) =>
				b.createdAt.localeCompare(a.createdAt)
			);
			return Promise.all(orders.map(async (o) => ({ ...(await toDto(o)), userId: o.userId })));
		}
	};
}
