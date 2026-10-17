/**
 * The reader's wishlist on store screens (P1-STO-06; plan §6 Phase 1.18 UX notes): which Books are
 * on it, and the heart that adds or takes one off. The heart changes at once; the list follows
 * the Backend's `wishlist` topic.
 */
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { SvelteMap } from 'svelte/reactivity';
import { describeError } from '$lib/errors';
import { getBackend } from '$lib/services';
import { resource } from '$lib/state/resource.svelte';
import { snackbars } from '$lib/state/snackbar.svelte';

/** Adds a Book to the wishlist or takes it off, saying so; false if it failed. */
export async function setWishlisted(book: { id: string }, on: boolean): Promise<boolean> {
	try {
		const wishlist = (await getBackend()).wishlist;
		if (on) await wishlist.add(book.id);
		else await wishlist.remove(book.id);
		snackbars.show(
			on ? 'Added to your wishlist. If its price drops, your inbox will say.' : 'Off your wishlist',
			on
				? { action: { label: 'See wishlist', run: () => void goto(resolve('/you/wishlist')) } }
				: undefined
		);
		return true;
	} catch (error) {
		snackbars.show(describeError(error).message, { tone: 'error' });
		return false;
	}
}

/** Which Books are on the wishlist. Create it while a component initialises (it's a resource). */
export class Wishlist {
	#ids = resource(
		async () => new Set((await (await getBackend()).wishlist.list()).map((e) => e.book.id)),
		{ topics: ['wishlist', 'entitlements', 'session'] }
	);
	/** Hearts already pressed, until the list has caught up. */
	#pressed = new SvelteMap<string, boolean>();

	has(bookId: string): boolean {
		return this.#pressed.get(bookId) ?? this.#ids.data?.has(bookId) ?? false;
	}

	async toggle(book: { id: string }) {
		const on = !this.has(book.id);
		this.#pressed.set(book.id, on);
		await setWishlisted(book, on);
		await this.#ids.refresh();
		this.#pressed.delete(book.id);
	}

	/** A card's heart, or none for a Book in the library. */
	heart(book: { id: string; inLibrary: boolean }) {
		return book.inLibrary
			? undefined
			: { on: this.has(book.id), toggle: () => void this.toggle(book) };
	}
}
