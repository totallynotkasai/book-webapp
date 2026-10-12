/**
 * Store rules (DESIGN.md §6.5, P1-STO-01 to P1-STO-04), shared by `backend-local` now and the
 * API from Phase 2: what a Bundle costs a reader who owns some of it, which Chapters make a
 * sample, which are early access, and how a Creator Subscription's paid periods run.
 *
 * Money stays in integer minor units (Invariant 17).
 */
import type { Money } from '@book/core';
import { money } from './money';

/**
 * A Bundle's price for a reader who already owns some of its children: the Bundle price,
 * reduced in proportion to the list price of what they own ("complete the set"), rounded down
 * to a whole minor unit. Owning everything makes it free; owning nothing, the full price.
 */
export function bundlePriceFor(
	bundle: Money,
	children: readonly { productId: string; price: Money }[],
	owned: ReadonlySet<string>
): Money {
	const total = children.reduce((sum, c) => sum + same(c.price, bundle).amountMinor, 0);
	if (total === 0)
		return money(owned.size >= children.length ? 0 : bundle.amountMinor, bundle.currency);
	const missing = children
		.filter((c) => !owned.has(c.productId))
		.reduce((sum, c) => sum + c.price.amountMinor, 0);
	return money(Math.floor((bundle.amountMinor * missing) / total), bundle.currency);
}

function same(price: Money, as: Money): Money {
	if (price.currency !== as.currency) {
		throw new RangeError(`A Bundle can't mix ${price.currency} and ${as.currency}`);
	}
	return price;
}

interface ChapterShape {
	chapterId: string;
	wordCount: number;
	linear: boolean;
}

/**
 * SIMULATION: the sample is the Book's opening, up to a tenth of its Words: every Chapter
 * before the first linear Chapter with Words, then whole Chapters until the share is reached
 * (at least one). A store-wide placeholder until creators choose their own samples.
 */
export function sampleChapterIds(chapters: readonly ChapterShape[], share = 0.1): string[] {
	const total = chapters.reduce((sum, c) => sum + c.wordCount, 0);
	const out: string[] = [];
	let words = 0;
	let started = false;
	for (const chapter of chapters) {
		const reading = chapter.linear && chapter.wordCount > 0;
		if (started && words >= total * share) break;
		out.push(chapter.chapterId);
		if (reading) {
			started = true;
			words += chapter.wordCount;
		}
	}
	return out;
}

/**
 * SIMULATION (OPEN-10): a serial's newest `count` Chapters with Words are early access until
 * `freeAt`; subscribers to the author's plan read them now.
 */
export function earlyAccessChapterIds(chapters: readonly ChapterShape[], count: number): string[] {
	return chapters
		.filter((c) => c.linear && c.wordCount > 0)
		.slice(-count)
		.map((c) => c.chapterId);
}

/** The same day of the month, `n` months on (the last day when that month is shorter). */
export function addMonths(iso: string, n: number): string {
	const date = new Date(iso);
	const day = date.getUTCDate();
	date.setUTCDate(1);
	date.setUTCMonth(date.getUTCMonth() + n);
	const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
	date.setUTCDate(Math.min(day, last));
	return date.toISOString();
}

export interface SubscriptionPeriods {
	status: 'active' | 'cancelled' | 'ended';
	currentPeriodEnd: string;
	cancelAtPeriodEnd: boolean;
	endedAt: string | null;
}

/**
 * Brings a monthly subscription up to `now` (renewals follow the dev clock, P1-STO-04): each
 * period that has ended renews if it wasn't cancelled and the payment goes through, and the
 * subscription ends at the end of the last paid period otherwise. `renewalsPaid` is how many
 * renewals were charged, for the caller to record.
 */
export function advanceSubscription(
	sub: SubscriptionPeriods,
	now: Date,
	pay: () => boolean
): SubscriptionPeriods & { renewalsPaid: number } {
	let next = { ...sub };
	let renewalsPaid = 0;
	while (next.status !== 'ended' && Date.parse(next.currentPeriodEnd) <= now.getTime()) {
		if (next.cancelAtPeriodEnd || !pay()) {
			next = { ...next, status: 'ended', endedAt: next.currentPeriodEnd };
		} else {
			renewalsPaid++;
			next = { ...next, currentPeriodEnd: addMonths(next.currentPeriodEnd, 1) };
		}
	}
	return { ...next, renewalsPaid };
}
