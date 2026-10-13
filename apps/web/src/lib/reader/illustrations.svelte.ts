/**
 * Illustrations for the open Book (P1-LAY-01, P1-LAY-02; DESIGN.md §8.1, §8.2): its packs from
 * `Backend.layers`, the reader's selection in `Stores.layerSelection` (or the default: every
 * official pack they hold), and the current-Illustration rule.
 *
 * The rule is the spoiler-safe one (Invariant 6): the Illustration with the latest start at or
 * before the **last** visible Word. Nothing anchored ahead of what's on screen can be returned.
 */
import {
	isBackendError,
	latestAtOrBefore,
	type Backend,
	type IllustrationDto,
	type IllustrationPackSummaryDto,
	type LayerSummaryDto,
	type PointAnchor,
	type Stores,
	type StudioPackDto
} from '@book/core';
import { defaultIllustrationPackIds, usableIllustrationPackIds } from '@book/domain';
import { SvelteMap } from 'svelte/reactivity';

export interface OpenedPack {
	pack: IllustrationPackSummaryDto;
	/** Illustrations on the open Revision, in reading order. */
	illustrations: IllustrationDto[];
	token: string;
}

/** A pack's current Illustration, with the one before it (spread mode shows both). */
export interface Current {
	pack: IllustrationPackSummaryDto;
	illustration: IllustrationDto;
	previous: IllustrationDto | null;
}

export class BookIllustrations {
	/** Every listed pack for the Book, held or not (the Layers menu shows them all). */
	packs = $state.raw<IllustrationPackSummaryDto[]>([]);
	/** Enabled packs, in priority order. */
	enabled = $state.raw<string[]>([]);
	readonly opened = new SvelteMap<string, OpenedPack>();

	readonly #backend: Backend;
	readonly #stores: Stores;
	readonly #bookId: string;
	readonly #revisionId: string;
	/** Blob URLs by pack and file: a cache, not state, so a plain object. */
	readonly #urls: Record<string, Promise<string | null>> = {};
	#destroyed = false;

	constructor(backend: Backend, stores: Stores, bookId: string, revisionId: string) {
		this.#backend = backend;
		this.#stores = stores;
		this.#bookId = bookId;
		this.#revisionId = revisionId;
	}

	/** True once the Book has any pack the reader could turn on. */
	available = $derived(this.packs.some((p) => p.entitled));

	/** `layers`: the Book's Layers from `Backend.layers.list`, of which the packs are used. */
	async load(layers: LayerSummaryDto[]) {
		this.packs = layers.filter((l) => l.kind === 'illustration_pack');
		const saved = await this.#stores.layerSelection.get(this.#bookId);
		this.enabled = saved
			? usableIllustrationPackIds(saved.illustrationPackIds, this.packs)
			: defaultIllustrationPackIds(this.packs);
		await Promise.all(this.enabled.map((id) => this.#open(id)));
	}

	/**
	 * Creator mode (P1-LAY-05): shows one Studio pack as it's being built, in every Illustration
	 * mode, instead of the Book's listed packs. Pictures whose text changed (orphaned) are left out.
	 */
	useDraft(draft: StudioPackDto, creatorName: string) {
		const pack: IllustrationPackSummaryDto = {
			id: draft.id,
			kind: 'illustration_pack',
			bookId: draft.bookId,
			productId: `product-${draft.id}`,
			name: draft.name,
			description: draft.description,
			creatorId: '',
			creatorName,
			isOfficial: draft.isOfficial,
			aiUse: draft.aiUse ?? 'none',
			credit: draft.credit,
			price: draft.price,
			entitled: true,
			illustrationCount: draft.illustrationCount,
			creatorHandle: '',
			endorsed: false,
			rating: null,
			myRating: null
		};
		this.packs = [pack];
		this.enabled = [draft.id];
		this.opened.set(draft.id, {
			pack,
			illustrations: draft.illustrations.filter(
				(i) => i.anchorStatus !== 'orphaned' && i.anchor.revisionId === this.#revisionId
			),
			token: draft.contentToken
		});
	}

	async #open(packId: string): Promise<OpenedPack | undefined> {
		const existing = this.opened.get(packId);
		if (existing) return existing;
		const opened = await this.#backend.layers.openPack(packId);
		// Anchors on another Revision would need migrating first (§6.2); they're left out.
		const illustrations = opened.illustrations.filter(
			(i) => i.anchor.revisionId === this.#revisionId
		);
		const pack: OpenedPack = { pack: opened.pack, illustrations, token: opened.contentToken };
		if (this.#destroyed) return pack;
		this.opened.set(packId, pack);
		return pack;
	}

	/** Each enabled pack's current Illustration at `last` (the last visible Word), by priority. */
	currentAt(last: PointAnchor | null): Current[] {
		if (!last) return [];
		const out: Current[] = [];
		for (const id of this.enabled) {
			const opened = this.opened.get(id);
			if (!opened) continue;
			const illustration = latestAtOrBefore(opened.illustrations, last, (i) => i.anchor);
			if (!illustration) continue;
			const index = opened.illustrations.indexOf(illustration);
			out.push({
				pack: opened.pack,
				illustration,
				previous: index > 0 ? opened.illustrations[index - 1]! : null
			});
		}
		return out;
	}

	/** Every enabled Illustration, for `in-text` mode, by priority (duplicates at one place skipped). */
	all(): { pack: OpenedPack; illustration: IllustrationDto }[] {
		return this.enabled.flatMap((id) => {
			const pack = this.opened.get(id);
			return pack ? pack.illustrations.map((illustration) => ({ pack, illustration })) : [];
		});
	}

	packOf(illustrationId: string): OpenedPack | undefined {
		for (const pack of this.opened.values()) {
			if (pack.illustrations.some((i) => i.id === illustrationId)) return pack;
		}
		return undefined;
	}

	/** A blob URL for the image at about `width` CSS px (device pixels taken into account). */
	url(packId: string, illustration: IllustrationDto, width: number): Promise<string | null> {
		const want = width * (globalThis.devicePixelRatio || 1);
		const variants = illustration.image.variants;
		const variant = variants.find((v) => v.width >= want) ?? variants.at(-1)!;
		const key = `${packId}/${variant.path}`;
		this.#urls[key] ??= this.#read(packId, variant.path).then((blob) =>
			blob && !this.#destroyed ? URL.createObjectURL(blob) : null
		);
		return this.#urls[key];
	}

	async #read(packId: string, path: string): Promise<Blob | null> {
		const pack = this.opened.get(packId);
		if (!pack) return null;
		try {
			return await this.#backend.content.read(pack.token, path);
		} catch (error) {
			if (!isBackendError(error, 'UNAUTHENTICATED')) throw error;
			// The token expired (an hour, §10.3): open the pack again once.
			this.opened.delete(packId);
			const reopened = await this.#open(packId);
			return reopened ? this.#backend.content.read(reopened.token, path) : null;
		}
	}

	async setEnabled(packId: string, on: boolean) {
		this.enabled = on
			? [...this.enabled.filter((id) => id !== packId), packId]
			: this.enabled.filter((id) => id !== packId);
		if (on) await this.#open(packId);
		await this.#save();
	}

	/** Moves an enabled pack up (-1) or down (+1) in priority. */
	async move(packId: string, by: -1 | 1) {
		const order = [...this.enabled];
		const i = order.indexOf(packId);
		const j = i + by;
		if (i < 0 || j < 0 || j >= order.length) return;
		[order[i], order[j]] = [order[j]!, order[i]!];
		this.enabled = order;
		await this.#save();
	}

	async #save() {
		const saved = await this.#stores.layerSelection.get(this.#bookId);
		await this.#stores.layerSelection.save({
			bookId: this.#bookId,
			illustrationPackIds: this.enabled,
			narrationTrackId: saved?.narrationTrackId ?? null
		});
	}

	destroy() {
		this.#destroyed = true;
		for (const url of Object.values(this.#urls)) {
			void url.then((u) => u && URL.revokeObjectURL(u));
		}
	}
}
