/**
 * Build profiles and feature flags (DESIGN.md P0-09, D-021). The profile is fixed at build time
 * by `VITE_PROFILE` (see .env.example), so a tester build never contains a way into the areas it
 * hides: the routes themselves answer 404.
 */
export const featureFlags = ['store', 'studio', 'community', 'admin', 'devPanel'] as const;
export type FeatureFlag = (typeof featureFlags)[number];
export type Flags = Record<FeatureFlag, boolean>;

export type Profile = 'owner' | 'tester';

/** Flags a tester session may turn on with `VITE_FLAGS`. The dev panel is never one of them. */
const TESTER_OPTIONAL: readonly FeatureFlag[] = ['store', 'studio', 'community', 'admin'];

export function resolveProfile(value: string | undefined): Profile {
	return value === 'tester' ? 'tester' : 'owner';
}

/**
 * Owner builds have everything. Tester builds show only the reading experience, plus any
 * simulated areas listed in `extra` (e.g. "store,community") for sessions that include them.
 */
export function resolveFlags(profile: Profile, extra = ''): Flags {
	if (profile === 'owner') {
		return { store: true, studio: true, community: true, admin: true, devPanel: true };
	}
	const enabled = new Set(extra.split(',').map((f) => f.trim()));
	return Object.fromEntries(
		featureFlags.map((flag) => [flag, TESTER_OPTIONAL.includes(flag) && enabled.has(flag)])
	) as Flags;
}

/** Which flag guards each route (IMPLEMENTATION-PLAN.md §5.2). The most specific prefix wins. */
const ROUTE_FLAGS: [prefix: string, flag: FeatureFlag][] = [
	['/book/[slug]/community', 'community'],
	['/dev', 'devPanel'],
	['/store', 'store'],
	['/book', 'store'],
	['/creator', 'store'],
	['/studio', 'studio'],
	['/admin', 'admin']
];

export function flagForRoute(routeId: string): FeatureFlag | undefined {
	return ROUTE_FLAGS.find(
		([prefix]) => routeId === prefix || routeId.startsWith(`${prefix}/`)
	)?.[1];
}

export function isRouteEnabled(routeId: string, current: Flags): boolean {
	const flag = flagForRoute(routeId);
	return flag === undefined || current[flag];
}

export const profile: Profile = resolveProfile(import.meta.env.VITE_PROFILE);
export const flags: Flags = resolveFlags(profile, import.meta.env.VITE_FLAGS);
