/**
 * Build profiles and feature flags (DESIGN.md P0-09, D-021). The profile is fixed at build time
 * by `VITE_PROFILE` (see .env.example). Owner builds have every area; tester builds show only the
 * reading experience, and the routes of the areas they hide answer 404.
 *
 * A PoC review session can add simulated areas to a tester build in two ways: `VITE_FLAGS` at
 * build time, or a facilitator link (`?areas=store,community`) that this device then remembers
 * (D-031). Neither can turn on the dev panel.
 */
export const featureFlags = ['store', 'studio', 'community', 'admin', 'devPanel'] as const;
export type FeatureFlag = (typeof featureFlags)[number];
export type Flags = Record<FeatureFlag, boolean>;

export type Profile = 'owner' | 'tester';

/** Flags a tester session may turn on. The dev panel is never one of them. */
export const TESTER_AREAS: readonly FeatureFlag[] = ['store', 'studio', 'community', 'admin'];

/** Where a tester device keeps the areas its last facilitator link chose. */
export const AREAS_KEY = 'book-areas';
/** The facilitator link's query parameter: `?areas=store,community`, or `?areas=none`. */
export const AREAS_PARAM = 'areas';

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
		featureFlags.map((flag) => [flag, TESTER_AREAS.includes(flag) && enabled.has(flag)])
	) as Flags;
}

/**
 * The areas a facilitator link asks for, as a clean comma-separated list in a fixed order, or
 * `undefined` when the URL has no `areas` parameter. `none` (or an empty value) means reading only;
 * unknown names, and the dev panel, are dropped.
 */
export function areasFromLink(url: URL): string | undefined {
	const value = url.searchParams.get(AREAS_PARAM);
	if (value === null) return undefined;
	const asked = new Set(value.split(',').map((a) => a.trim()));
	return TESTER_AREAS.filter((area) => asked.has(area)).join(',');
}

/**
 * Saves the areas from a facilitator link on this device. Returns true when that changed what
 * the device shows, so the caller can reload (flags are read once, when the app starts).
 */
export function rememberAreas(url: URL, storage: Storage | undefined = safeStorage()): boolean {
	const areas = areasFromLink(url);
	if (areas === undefined || !storage) return false;
	const before = storage.getItem(AREAS_KEY) ?? '';
	try {
		storage.setItem(AREAS_KEY, areas);
	} catch {
		return false;
	}
	return before !== areas;
}

/** The areas this device remembers, after applying a facilitator link in the current address. */
function deviceAreas(): string {
	const storage = safeStorage();
	if (!storage) return '';
	if (typeof location !== 'undefined') rememberAreas(new URL(location.href), storage);
	return storage.getItem(AREAS_KEY) ?? '';
}

function safeStorage(): Storage | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		// Storage can be blocked (private modes, site settings): the build's own areas still apply.
		return undefined;
	}
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
	// Route groups like `(app)` shape layouts, not URLs, so they never decide a flag.
	const path = routeId.replace(/\/\([^)]+\)/g, '') || '/';
	return ROUTE_FLAGS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1];
}

export function isRouteEnabled(routeId: string, current: Flags): boolean {
	const flag = flagForRoute(routeId);
	return flag === undefined || current[flag];
}

export const profile: Profile = resolveProfile(import.meta.env.VITE_PROFILE);
export const flags: Flags = resolveFlags(
	profile,
	profile === 'tester' ? `${import.meta.env.VITE_FLAGS ?? ''},${deviceAreas()}` : ''
);
