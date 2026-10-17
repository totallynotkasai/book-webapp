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

/**
 * A day ahead, with its weekday: "Friday 24 October" (P1-STU-06's "Next chapter: Friday"),
 * and the year when it isn't this one.
 */
export function formatDay(iso: string, locale?: string): string {
	const date = new Date(iso);
	return date.toLocaleDateString(locale, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' })
	});
}

/** A day and time ahead: "Friday 24 October, 09:00" (when a Chapter comes out). */
export function formatDayTime(iso: string, locale?: string): string {
	const date = new Date(iso);
	const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
	return `${formatDay(iso, locale)}, ${time}`;
}

/** A reading time, to the minute: "less than a minute", "8 min", "1 h 5 min", "12 h". */
export function formatReadingTime(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return 'less than a minute';
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours >= 10) return `${Math.round(minutes / 60)} h`;
	return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** Time left at the reader's pace (P1-RDR-14): "8 min left", "Less than a minute left". */
export function formatTimeLeft(ms: number): string {
	const time = formatReadingTime(ms);
	return `${time[0]!.toUpperCase()}${time.slice(1)} left`;
}
