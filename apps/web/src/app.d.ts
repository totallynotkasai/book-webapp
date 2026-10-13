// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	interface ImportMetaEnv {
		/** `owner` (default) or `tester`. See .env.example. */
		readonly VITE_PROFILE?: string;
		/** Tester builds: simulated areas to include, comma-separated. */
		readonly VITE_FLAGS?: string;
		/** Which build this is, shown in Help for PoC review notes (set by the deploy workflow). */
		readonly VITE_BUILD_ID?: string;
	}
}

export {};
