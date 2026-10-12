import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

// `/` opens the Library (IMPLEMENTATION-PLAN.md §5.1).
export const load = () => {
	redirect(307, resolve('/library'));
};
