/**
 * `Backend.catalogue` in the browser (P1-APP-01, P1-STO-01, P1-STO-03): listed Books with their
 * badges and whether the reader holds them, the store's shelves and search, Book pages with what
 * they offer (the Complete edition first, priced for what the reader already owns), and the
 * Bookmark Designs. Ownership is decided by `@book/domain` (Invariant 15).
 */
import {
	BackendError,
	type BookmarkDesignDto,
	type BookPageDto,
	type BookSummaryDto,
	type CatalogueApi,
	type Clock,
	type LayersApi,
	type OfferDto,
	type UserDto
} from '@book/core';
import { bundlePriceFor, ownedProductIds } from '@book/domain';
import type { BackendDatabase } from './db';
import { paginate } from './paging';
import type { BookRecord, ProductRecord } from './seed';

export function createCatalogueApi(deps: {
	db: BackendDatabase;
	clock: Clock;
	/** The signed-in user, or null (the catalogue is public). */
	currentUser: () => UserDto | null;
	layers: Pick<LayersApi, 'list'>;
}): CatalogueApi & { summaries(books: BookRecord[]): Promise<BookSummaryDto[]> } {
	const { db, clock } = deps;

	/** What every summary needs, read once per call. */
	async function lookups() {
		const user = deps.currentUser();
		const [products, creators, packs, tracks, entitlements] = await Promise.all([
			db.getAll('products'),
			db.getAll('creators'),
			db.getAll('illustrationPacks'),
			db.getAll('audioTracks'),
			user ? db.getAllFromIndex('entitlements', 'userId', user.id) : Promise.resolve([])
		]);
		return {
			products,
			creators: new Map(creators.map((c) => [c.id, c])),
			illustrated: new Set(packs.filter((p) => p.listingState === 'listed').map((p) => p.bookId)),
			narrated: new Set(tracks.filter((t) => t.listingState === 'listed').map((t) => t.bookId)),
			owned: user ? ownedProductIds(entitlements, user.id, clock.now()) : new Set<string>()
		};
	}
	type Lookups = Awaited<ReturnType<typeof lookups>>;

	function summary(book: BookRecord, l: Lookups): BookSummaryDto {
		const product = l.products.find((p) => p.kind === 'book' && p.refId === book.id);
		if (!product) throw new BackendError('SERVER_ERROR', `Book ${book.id} has no Product.`);
		return {
			id: book.id,
			slug: book.slug,
			title: book.title,
			creatorId: book.creatorId,
			creatorName: l.creators.get(book.creatorId)?.displayName ?? '',
			lang: book.lang,
			aiUse: book.aiUse,
			coverUrl: book.coverUrl,
			price: product.price,
			contentRating: book.contentRating,
			hasIllustrations: l.illustrated.has(book.id),
			hasNarration: l.narrated.has(book.id),
			inLibrary: l.owned.has(product.id)
		};
	}

	async function summaries(books: BookRecord[]): Promise<BookSummaryDto[]> {
		const l = await lookups();
		return books.map((b) => summary(b, l));
	}

	const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title);

	async function listed(): Promise<BookRecord[]> {
		return (await db.getAll('books')).filter((b) => b.listingState === 'listed').sort(byTitle);
	}

	function offers(book: BookRecord, l: Lookups): OfferDto[] {
		const products = new Map(l.products.map((p) => [p.id, p]));
		const own = (p: ProductRecord) => l.owned.has(p.id);
		const bookProduct = l.products.find((p) => p.kind === 'book' && p.refId === book.id)!;
		const bundles = l.products.filter(
			(p) => p.kind === 'bundle' && p.bookId === book.id && p.status === 'active'
		);
		const out: OfferDto[] = bundles.map((bundle) => {
			const children = bundle.childProductIds
				.map((id) => products.get(id))
				.filter((p): p is ProductRecord => !!p);
			const owned = own(bundle) || children.every(own);
			return {
				productId: bundle.id,
				kind: 'bundle',
				label: 'Complete edition',
				includes: children.map((c) => c.id),
				price: bundle.price,
				priceForYou: owned
					? { amountMinor: 0, currency: bundle.price.currency }
					: bundlePriceFor(
							bundle.price,
							children.map((c) => ({ productId: c.id, price: c.price })),
							l.owned
						),
				owned
			};
		});
		const owned = own(bookProduct);
		out.push({
			productId: bookProduct.id,
			kind: 'book',
			label: bundles.length ? 'Book only' : 'The book',
			includes: [bookProduct.id],
			price: bookProduct.price,
			priceForYou: owned
				? { amountMinor: 0, currency: bookProduct.price.currency }
				: bookProduct.price,
			owned
		});
		return out;
	}

	return {
		summaries,

		async listBooks(page) {
			return paginate(await summaries(await listed()), page);
		},

		async listShelves() {
			const shelves = (await db.getAll('shelves')).sort((a, b) => a.order - b.order);
			const listedIds = new Set((await listed()).map((b) => b.id));
			return shelves.map(({ id, title, description, bookIds }) => ({
				id,
				title,
				description,
				bookIds: bookIds.filter((b) => listedIds.has(b))
			}));
		},

		async search(query, page) {
			const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
			const books = await listed();
			const creators = new Map((await db.getAll('creators')).map((c) => [c.id, c]));
			const found = books.filter((b) => {
				const text = [b.title, creators.get(b.creatorId)?.displayName ?? '', b.description]
					.join(' ')
					.toLocaleLowerCase();
				return words.every((w) => text.includes(w));
			});
			return paginate(await summaries(found), page);
		},

		async getBook(slug): Promise<BookPageDto> {
			const book = await db.getFromIndex('books', 'slug', slug);
			if (!book || book.listingState !== 'listed') {
				throw new BackendError('NOT_FOUND', 'That book isn’t in the store.');
			}
			const [l, layers, plans] = await Promise.all([
				lookups(),
				deps.currentUser() ? deps.layers.list(book.id) : Promise.resolve([]),
				db.getAllFromIndex('plans', 'creatorId', book.creatorId)
			]);
			const creator = l.creators.get(book.creatorId);
			if (!creator) throw new BackendError('SERVER_ERROR', `Book ${book.id} has no Creator.`);
			const base = summary(book, l);
			return {
				...base,
				description: book.description,
				creator,
				products: l.products
					.filter((p) => p.bookId === book.id && p.status === 'active' && p.kind !== 'early_access')
					.map(({ id, kind, bookId, creatorId, isOfficial, price }) => ({
						id,
						kind,
						bookId,
						creatorId,
						isOfficial,
						price
					})),
				contentWarnings: book.contentWarnings,
				layers,
				offers: offers(book, l),
				hasSample: !!book.epubUrl && !base.inLibrary,
				planIds: plans.map((p) => p.id),
				isSerial: book.isSerial
			};
		},

		async getCreator(handle) {
			const creator = await db.getFromIndex('creators', 'handle', handle);
			if (!creator) throw new BackendError('NOT_FOUND', 'There is no creator with that name.');
			return creator;
		},

		async listCreatorBooks(handle, page) {
			const creator = await db.getFromIndex('creators', 'handle', handle);
			if (!creator) throw new BackendError('NOT_FOUND', 'There is no creator with that name.');
			const books = (await db.getAllFromIndex('books', 'creatorId', creator.id))
				.filter((b) => b.listingState === 'listed')
				.sort(byTitle);
			return paginate(await summaries(books), page);
		},

		async listBookmarkDesigns(): Promise<BookmarkDesignDto[]> {
			const l = await lookups();
			const designs = await db.getAll('bookmarkDesigns');
			return designs
				.map((design) => {
					const product = l.products.find(
						(p) => p.kind === 'bookmark_design' && p.refId === design.id
					)!;
					return {
						productId: product.id,
						name: design.name,
						description: design.description,
						creatorName: l.creators.get(design.creatorId)?.displayName ?? '',
						price: product.price,
						look: design.look,
						// Everyone has the default from sign-up (§6.5).
						owned: design.isDefault || l.owned.has(product.id),
						isDefault: design.isDefault
					};
				})
				.sort(
					(a, b) =>
						Number(b.isDefault) - Number(a.isDefault) || a.price.amountMinor - b.price.amountMinor
				);
		}
	};
}
