/**
 * Who is signed in (in the PoC, which Persona), shared by the navigation and role-gated screens.
 * Role checks here only decide what to show; the Backend enforces them itself (§10.6).
 *
 * The last known user is cached on the device, as a Phase 2 auth session would be, so the app's
 * navigation still knows the role while the (simulated) backend is offline or failing.
 */
import type { UserDto } from '@book/core';
import { can } from '@book/domain';
import { getBackend } from '$lib/services';

const CACHE_KEY = 'book-session';

function readCache(): UserDto | null {
	try {
		return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as UserDto | null;
	} catch {
		return null;
	}
}

function writeCache(user: UserDto | null) {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(user));
	} catch {
		// A full or disabled store only loses the offline fallback.
	}
}

class SessionState {
	user = $state<UserDto | null>(typeof localStorage === 'undefined' ? null : readCache());
	/** True once the backend has answered (or failed) at least once. */
	loaded = $state(false);
	canUseStudio = $derived(can(this.user?.role, 'studio'));
	canModerate = $derived(can(this.user?.role, 'moderation'));
	#started = false;

	/** Loads the session and follows `session` events. Safe to call more than once. */
	start() {
		if (this.#started) return;
		this.#started = true;
		void this.refresh();
		void getBackend().then((backend) => backend.events.on('session', () => void this.refresh()));
	}

	async refresh() {
		try {
			const backend = await getBackend();
			const { user } = await backend.session.current();
			this.user = user;
			writeCache(user);
		} catch {
			// Offline or failing: keep the cached user, as a signed-in app would.
		} finally {
			this.loaded = true;
		}
	}
}

export const session = new SessionState();
