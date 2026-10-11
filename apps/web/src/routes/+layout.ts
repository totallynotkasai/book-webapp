import { error } from '@sveltejs/kit';
import { flags, isRouteEnabled } from '$lib/flags';
import type { LayoutLoad } from './$types';

// The app is fully client-side for now: the reader needs the DOM and data lives in the browser.
export const ssr = false;
export const prerender = true;

// Areas switched off by the build profile don't exist for that build (P0-09).
export const load: LayoutLoad = ({ route }) => {
	if (route.id && !isRouteEnabled(route.id, flags)) error(404, 'Not found');
};
