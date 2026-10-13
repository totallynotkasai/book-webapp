/**
 * Display formatting. Money stays integer minor units until this last step (Invariant 17).
 */
import type { AiUse, ContentRating, FlagRule, Money, Role } from '@book/core';

const formatters = new Map<string, Intl.NumberFormat>();

/** "Free", or the price in its currency ("£3.99"). */
export function formatPrice(price: Money, locale?: string): string {
	if (price.amountMinor === 0) return 'Free';
	return formatAmount(price, locale);
}

/** An amount of money, zero included ("£0.00"): earnings and totals, not prices. */
export function formatAmount(price: Money, locale?: string): string {
	const key = `${locale ?? ''}:${price.currency}`;
	let format = formatters.get(key);
	if (!format) {
		format = new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency });
		formatters.set(key, format);
	}
	const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
	return format.format(price.amountMinor / 10 ** digits);
}

/** The AI label readers see (§10.6), or null when no AI was used. */
export function aiLabel(aiUse: AiUse): string | null {
	if (aiUse === 'generated') return 'AI-generated';
	if (aiUse === 'assisted') return 'AI-assisted';
	return null;
}

/** SIMULATION: placeholder rating names until OPEN-12 decides the scheme (§10.4). */
export const contentRatingLabels: Record<ContentRating, string> = {
	all_ages: 'All ages',
	teen: 'Teen',
	mature: 'Mature'
};

export const roleLabels: Record<Role, string> = {
	reader: 'Reader',
	creator: 'Creator',
	moderator: 'Moderator',
	admin: 'Admin'
};

export const flagRuleLabels: Record<FlagRule, string> = {
	upload_volume: 'Upload volume',
	ai_untagged_suspected: 'Possible unlabelled AI',
	report: 'Reader report',
	rapid_new_account: 'New account selling'
};

export function formatDate(iso: string, locale?: string): string {
	return new Date(iso).toLocaleDateString(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}
