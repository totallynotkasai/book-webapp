/**
 * Revenue splits (DESIGN.md §6.5 `revenue_split`, P1-STU-04). OPEN-08 decides the real ones, so
 * every number here is a placeholder in this one config, and the earnings dashboard says so.
 * Basis points, integer arithmetic (Invariant 17): the platform and the author are rounded
 * down, and the creator receives whatever is left, so the parts always add up to the gross.
 */
import type { Money } from '@book/core';
import { money } from './money';

export type RevenueKind = 'sale' | 'community_sale' | 'tip' | 'subscription';

export interface SplitRule {
	/** Out of 10 000. */
	platformBps: number;
	/** The Book's author, on a community Creator's Layer (§6.5). */
	authorBps: number;
	/** How the dashboard describes it. */
	note: string;
}

/** SIMULATION (OPEN-08): placeholder splits until the owner decides them. */
export const PLACEHOLDER_SPLITS: Record<RevenueKind, SplitRule> = {
	sale: { platformBps: 1000, authorBps: 0, note: 'Sales: platform 10% (placeholder)' },
	community_sale: {
		platformBps: 1000,
		authorBps: 1500,
		note: 'Community Layers: platform 10%, the book’s author 15% (placeholder)'
	},
	tip: { platformBps: 500, authorBps: 0, note: 'Tips: platform 5% (placeholder)' },
	subscription: {
		platformBps: 1000,
		authorBps: 0,
		note: 'Subscriptions: platform 10% (placeholder)'
	}
};

export interface Split {
	gross: Money;
	platform: Money;
	/** The Book's author's share of a community sale. */
	author: Money;
	/** The Creator who made it. */
	creator: Money;
}

export function splitRevenue(
	gross: Money,
	kind: RevenueKind,
	rules: Record<RevenueKind, SplitRule> = PLACEHOLDER_SPLITS
): Split {
	const rule = rules[kind];
	const platform = Math.floor((gross.amountMinor * rule.platformBps) / 10_000);
	const author = Math.floor((gross.amountMinor * rule.authorBps) / 10_000);
	return {
		gross,
		platform: money(platform, gross.currency),
		author: money(author, gross.currency),
		creator: money(gross.amountMinor - platform - author, gross.currency)
	};
}

/** Adds splits of one currency. */
export function addSplits(splits: readonly Split[], currency: string): Split {
	const sum = (pick: (s: Split) => Money) =>
		money(
			splits.reduce((total, s) => {
				const m = pick(s);
				if (m.currency !== currency) {
					throw new RangeError(`Can’t add ${m.currency} to ${currency}`);
				}
				return total + m.amountMinor;
			}, 0),
			currency
		);
	return {
		gross: sum((s) => s.gross),
		platform: sum((s) => s.platform),
		author: sum((s) => s.author),
		creator: sum((s) => s.creator)
	};
}
