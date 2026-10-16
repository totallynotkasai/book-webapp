/**
 * The story so far in the browser (DESIGN.md §4.9, §7.4 without the AI drafts; P1-STU-05,
 * P1-RDR-13): each Book's recaps and glossary, as a draft the author edits in the Studio and the
 * copy readers get once it's published. Phase 6 keeps them on the server.
 *
 * Every name's first appearance is found in the text (`RevisionWordTexts` in `@book/domain`) and
 * kept as a RangeAnchor on the Revision it was found in. When the Book's Revision changes, they're
 * found again in the new one rather than migrated by WordIds: the first appearance is wherever the
 * name now first occurs, so a mention added earlier moves it earlier (§6.2's re-anchoring, for a
 * position defined by the text). A seeded story is found the first time it's read.
 */
import {
	BackendError,
	revisionManifestSchema,
	revisionPaths,
	type AiUse,
	type BackendTopic,
	type Clock,
	type GlossaryEntryInput,
	type GlossaryPictureDto,
	type ImageUpload,
	type RangeAnchor,
	type RecapInput,
	type RevisionManifest,
	type StoryGlossaryEntryDto,
	type StorySoFarDto,
	type StudioGlossaryEntryDto,
	type StudioStoryDto
} from '@book/core';
import {
	nameWords,
	publishStoryProblems,
	revisionChanges,
	RevisionWordTexts,
	storyProblems
} from '@book/domain';
import { newId } from './checkout';
import type { BackendDatabase } from './db';
import type { StoredFiles } from './files';
import { extensionOf, MAX_IMAGE_BYTES, sniffImage } from './images';
import type { Pipeline } from './pipeline';
import type { BookRecord, SeedStoryRecord } from './seed';

/** Where a name first appears: its Anchor, its Chapter and the Words around it. */
interface Appearance {
	anchor: RangeAnchor;
	chapterId: string;
	context: string;
}

export interface GlossaryEntryRecord {
	id: string;
	name: string;
	aliases: string[];
	description: string;
	picture: {
		/** In `layerFiles` under `story:<bookId>`. */
		path: string;
		alt: string;
		width: number;
		height: number;
		dominant: string;
	} | null;
	/** Per name (its own, then each alias): its first occurrence on the content's Revision. */
	appearances: (Appearance | null)[];
}

export interface StoryContent {
	/** The Revision the first appearances are on; null until they're found (a seeded story). */
	revisionId: string | null;
	recaps: {
		chapterId: string;
		text: string;
		/** The Revision it was written on, to tell the author when its Chapter has changed since. */
		revisionId: string | null;
	}[];
	glossary: GlossaryEntryRecord[];
}

/** One per Book, keyed by `bookId`. */
export interface StoryRecord {
	bookId: string;
	draft: StoryContent;
	published: StoryContent | null;
	publishedAt: string | null;
	/** The answer published with it, or the last one given (§10.6). */
	aiUse: AiUse | null;
}

export interface StoryModule {
	/** The Studio's view of a Book's story, its draft on `revisionId`. */
	studio(book: BookRecord, revisionId: string): Promise<StudioStoryDto>;
	saveRecap(book: BookRecord, revisionId: string, input: RecapInput): Promise<StudioStoryDto>;
	saveEntry(
		book: BookRecord,
		revisionId: string,
		entryId: string | null,
		input: GlossaryEntryInput
	): Promise<StudioStoryDto>;
	removeEntry(book: BookRecord, revisionId: string, entryId: string): Promise<StudioStoryDto>;
	publish(book: BookRecord, revisionId: string, aiUse: AiUse | undefined): Promise<StudioStoryDto>;
	/** A newly published Revision: the draft and the published copy find their names in it. */
	moveTo(bookId: string, revisionId: string): Promise<void>;
	/**
	 * The published story on `revisionId` for a reader who can open the Chapters `readable` says
	 * yes to; null when there's none.
	 */
	forReader(
		book: BookRecord,
		revisionId: string,
		readable: (chapterId: string) => boolean
	): Promise<StorySoFarDto | null>;
}

/** A seeded story, published as its author wrote it; its names are found when it's first read. */
export function seededStory(seed: SeedStoryRecord): StoryRecord {
	const content = (): StoryContent => ({
		revisionId: null,
		recaps: seed.recaps.map((r) => ({ ...r, revisionId: null })),
		glossary: seed.glossary.map((e) => ({ ...e, picture: null, appearances: [] }))
	});
	return {
		bookId: seed.bookId,
		draft: content(),
		published: content(),
		publishedAt: seed.publishedAt,
		aiUse: seed.aiUse
	};
}

const filesId = (bookId: string) => `story:${bookId}`;
const validation = (message: string) => new BackendError('VALIDATION_FAILED', message);
const sameName = (a: string, b: string) =>
	nameWords(a).join(' ').toLowerCase() === nameWords(b).join(' ').toLowerCase();

function emptyContent(): StoryContent {
	return { revisionId: null, recaps: [], glossary: [] };
}

/** What readers would see of it, for telling whether the draft has changed since publishing. */
function comparable(content: StoryContent | null): string {
	if (!content) return '';
	return JSON.stringify({
		recaps: content.recaps
			.filter((r) => r.text)
			.map((r) => [r.chapterId, r.text])
			.sort(),
		glossary: content.glossary
			.map((e) => [e.id, e.name, e.aliases, e.description, e.picture?.path, e.picture?.alt])
			.sort()
	});
}

const hasContent = (content: StoryContent) =>
	content.recaps.some((r) => r.text) || content.glossary.length > 0;

export function createStoryModule(deps: {
	db: BackendDatabase;
	clock: Clock;
	pipeline: Pipeline;
	files: StoredFiles;
	changed: (...topics: BackendTopic[]) => void;
}): StoryModule {
	const { db, clock, files } = deps;
	const textCache = new Map<
		string,
		Promise<{ manifest: RevisionManifest; words: RevisionWordTexts }>
	>();
	const chapterIdsCache = new Map<string, Promise<Map<string, number[]>>>();
	/** One change to a Book's story at a time, so two saves can't lose each other's work. */
	const queues = new Map<string, Promise<unknown>>();

	function serially<T>(bookId: string, run: () => Promise<T>): Promise<T> {
		const next = (queues.get(bookId) ?? Promise.resolve()).then(run, run);
		queues.set(
			bookId,
			next.catch(() => {})
		);
		return next;
	}

	async function manifestOf(revisionId: string): Promise<RevisionManifest> {
		const file = await db.get('content', [revisionId, revisionPaths.manifest]);
		if (!file) throw new BackendError('SERVER_ERROR', 'This book’s manifest is missing.');
		return revisionManifestSchema.parse(JSON.parse(new TextDecoder().decode(file.bytes)));
	}

	/** A Revision's Words, to find names in. Revisions never change, so it's kept. */
	function textOf(revisionId: string) {
		let cached = textCache.get(revisionId);
		if (!cached) {
			cached = (async () => {
				const manifest = await manifestOf(revisionId);
				const chapters = await deps.pipeline.words(await files.revisionText(revisionId));
				const first = new Map(manifest.chapters.map((c) => [c.chapterId, c.firstOrdinal]));
				const words = new RevisionWordTexts(
					manifest.bookId,
					revisionId,
					chapters.map((c) => ({ ...c, firstOrdinal: first.get(c.chapterId) ?? 0 }))
				);
				return { manifest, words };
			})();
			cached.catch(() => textCache.delete(revisionId));
			textCache.set(revisionId, cached);
		}
		return cached;
	}

	/** Each Chapter's WordIds, to see which Chapters a new Revision changed. */
	function chapterIdsOf(revisionId: string) {
		let cached = chapterIdsCache.get(revisionId);
		if (!cached) {
			cached = (async () => {
				const chapters = await deps.pipeline.words(await files.revisionText(revisionId));
				return new Map(chapters.map((c) => [c.chapterId, c.wordIds]));
			})();
			cached.catch(() => chapterIdsCache.delete(revisionId));
			chapterIdsCache.set(revisionId, cached);
		}
		return cached;
	}

	/** Chapters whose Words differ between two Revisions (a removed Chapter counts). */
	async function changedChapters(from: string, to: string): Promise<Set<string>> {
		if (from === to) return new Set();
		try {
			const [before, after] = await Promise.all([chapterIdsOf(from), chapterIdsOf(to)]);
			const diff = revisionChanges(
				[...before].map(([chapterId, wordIds]) => ({ chapterId, wordIds })),
				[...after].map(([chapterId, wordIds]) => ({ chapterId, wordIds }))
			);
			return new Set([...diff.changedChapterIds, ...diff.removedChapterIds]);
		} catch {
			// The older Revision's text is gone: say nothing rather than guess.
			return new Set();
		}
	}

	async function appearancesOf(
		revisionId: string,
		entry: Pick<GlossaryEntryRecord, 'name' | 'aliases'>
	): Promise<(Appearance | null)[]> {
		const { words } = await textOf(revisionId);
		return [entry.name, ...entry.aliases].map((name) => words.find(name));
	}

	/** The content with its names found on `revisionId` (unchanged if they already are). */
	async function on(content: StoryContent, revisionId: string): Promise<StoryContent> {
		if (content.revisionId === revisionId) return content;
		const glossary = [];
		for (const entry of content.glossary) {
			glossary.push({ ...entry, appearances: await appearancesOf(revisionId, entry) });
		}
		return { ...content, revisionId, glossary };
	}

	async function load(bookId: string): Promise<StoryRecord> {
		return (
			(await db.get('stories', bookId)) ?? {
				bookId,
				draft: emptyContent(),
				published: null,
				publishedAt: null,
				aiUse: null
			}
		);
	}

	/** The record with its draft on `revisionId`, saved if that moved it. */
	async function current(bookId: string, revisionId: string): Promise<StoryRecord> {
		const record = await load(bookId);
		const draft = await on(record.draft, revisionId);
		if (draft === record.draft) return record;
		const next = { ...record, draft };
		await db.put('stories', next);
		return next;
	}

	async function pictureOf(
		bookId: string,
		picture: GlossaryEntryRecord['picture']
	): Promise<GlossaryPictureDto | null> {
		if (!picture) return null;
		const url = await files.url({ store: 'layerFiles', id: filesId(bookId), path: picture.path });
		if (!url) return null;
		const { alt, width, height, dominant } = picture;
		return { url, alt, width, height, dominant };
	}

	async function studioDto(record: StoryRecord, revisionId: string): Promise<StudioStoryDto> {
		const { manifest } = await textOf(revisionId);
		// As the reader's contents name it, else the Chapter's own title.
		const tocTitle = (chapterId: string) =>
			manifest.toc.find((t) => t.chapterId === chapterId)?.label ||
			manifest.chapters.find((c) => c.chapterId === chapterId)?.title ||
			'';
		const recaps = new Map(record.draft.recaps.map((r) => [r.chapterId, r]));
		const changedSince = new Map<string, Set<string>>();
		async function changed(chapterId: string): Promise<boolean> {
			const recap = recaps.get(chapterId);
			if (!recap?.text || !recap.revisionId || recap.revisionId === revisionId) return false;
			let set = changedSince.get(recap.revisionId);
			if (!set) {
				set = await changedChapters(recap.revisionId, revisionId);
				changedSince.set(recap.revisionId, set);
			}
			return set.has(chapterId);
		}
		const glossary: StudioGlossaryEntryDto[] = [];
		for (const entry of record.draft.glossary) {
			glossary.push({
				id: entry.id,
				name: entry.name,
				aliases: entry.aliases,
				description: entry.description,
				picture: await pictureOf(record.bookId, entry.picture),
				names: [entry.name, ...entry.aliases].map((name, i) => {
					const found = entry.appearances[i] ?? null;
					return {
						name,
						firstAppearance: found?.anchor ?? null,
						chapterId: found?.chapterId ?? null,
						chapterTitle: found ? tocTitle(found.chapterId) : null,
						context: found?.context ?? ''
					};
				})
			});
		}
		const firstAt = (e: StudioGlossaryEntryDto) =>
			Math.min(...e.names.map((n) => n.firstAppearance?.startOrdinal ?? Number.POSITIVE_INFINITY));
		glossary.sort((a, b) => firstAt(a) - firstAt(b) || a.name.localeCompare(b.name));
		return {
			bookId: record.bookId,
			revisionId,
			recaps: await Promise.all(
				manifest.chapters
					.filter((c) => c.linear && c.wordCount > 0)
					.map(async (c) => ({
						chapterId: c.chapterId,
						title: tocTitle(c.chapterId),
						wordCount: c.wordCount,
						text: recaps.get(c.chapterId)?.text ?? '',
						changed: await changed(c.chapterId)
					}))
			),
			glossary,
			aiUse: record.aiUse,
			publishedAt: record.publishedAt,
			unpublishedChanges: record.published
				? comparable(record.draft) !== comparable(record.published)
				: hasContent(record.draft),
			problems: storyProblems(contentSummary(record.draft))
		};
	}

	function contentSummary(content: StoryContent) {
		return {
			recaps: content.recaps.filter((r) => r.text).length,
			entries: content.glossary.map((e) => ({ name: e.name, inText: !!e.appearances[0] }))
		};
	}

	/** Pictures neither the draft nor the published copy uses any more. */
	async function prunePictures(record: StoryRecord): Promise<void> {
		const used = new Set(
			[...record.draft.glossary, ...(record.published?.glossary ?? [])]
				.map((e) => e.picture?.path)
				.filter((p): p is string => !!p)
		);
		const all = await db.getAll(
			'layerFiles',
			IDBKeyRange.bound([filesId(record.bookId), ''], [filesId(record.bookId), '￿'])
		);
		for (const file of all) {
			if (!used.has(file.path)) await files.remove(filesId(record.bookId), file.path);
		}
	}

	async function storePicture(bookId: string, entryId: string, image: ImageUpload) {
		// The widest variant up to a phone's width is plenty for a glossary card.
		const variants = [...image.variants].sort((a, b) => a.width - b.width);
		const variant = variants.filter((v) => v.width <= 1280).at(-1) ?? variants[0]!;
		if (variant.file.size > MAX_IMAGE_BYTES) {
			throw new BackendError('UPLOAD_TOO_LARGE', 'Pictures can be up to 25 MB.');
		}
		const bytes = new Uint8Array(await variant.file.arrayBuffer());
		const type = sniffImage(bytes);
		if (!type) throw validation('That file isn’t a picture we can show (use JPEG, PNG or WebP).');
		const path = `glossary/${entryId}-${clock.now().getTime()}.${extensionOf(type)}`;
		await files.put(filesId(bookId), path, bytes, type);
		const height = Math.round((image.height * variant.width) / image.width);
		return { path, width: variant.width, height, dominant: image.dominant };
	}

	async function save(record: StoryRecord, revisionId: string): Promise<StudioStoryDto> {
		await db.put('stories', record);
		deps.changed('studio');
		return studioDto(record, revisionId);
	}

	return {
		async studio(book, revisionId) {
			return studioDto(await current(book.id, revisionId), revisionId);
		},

		saveRecap(book, revisionId, input) {
			return serially(book.id, async () => {
				const record = await current(book.id, revisionId);
				const { manifest } = await textOf(revisionId);
				const chapter = manifest.chapters.find((c) => c.chapterId === input.chapterId);
				if (!chapter || chapter.wordCount === 0) {
					throw new BackendError('NOT_FOUND', 'That chapter isn’t in this version of the book.');
				}
				const text = input.text.trim();
				const recaps = record.draft.recaps.filter((r) => r.chapterId !== input.chapterId);
				if (text) recaps.push({ chapterId: input.chapterId, text, revisionId });
				return save({ ...record, draft: { ...record.draft, recaps } }, revisionId);
			});
		},

		saveEntry(book, revisionId, entryId, input) {
			return serially(book.id, async () => {
				const record = await current(book.id, revisionId);
				const existing = entryId ? record.draft.glossary.find((e) => e.id === entryId) : undefined;
				if (entryId && !existing) {
					throw new BackendError('NOT_FOUND', 'That entry isn’t in the glossary.');
				}
				const name = input.name.trim();
				// Other names: none twice, and not the entry's own name again.
				const aliases: string[] = [];
				for (const alias of input.aliases.map((a) => a.trim()).filter(Boolean)) {
					if (!sameName(alias, name) && !aliases.some((a) => sameName(a, alias))) {
						aliases.push(alias);
					}
				}
				for (const other of record.draft.glossary) {
					if (other.id === entryId) continue;
					const clash = [name, ...aliases].find((n) =>
						[other.name, ...other.aliases].some((o) => sameName(n, o))
					);
					if (clash) {
						throw validation(
							`“${other.name}” is already called “${clash}”. Each name can be in one entry only.`
						);
					}
				}
				const id = existing?.id ?? newId('entry');
				let picture = input.picture === null ? null : (existing?.picture ?? null);
				// Alt text is checked before anything is stored (§11.7: every picture has one).
				const alt = input.pictureAlt?.trim() ?? picture?.alt ?? '';
				if ((input.picture || picture) && !alt) {
					throw validation(
						'Describe the picture (alt text), so readers using a screen reader know what it shows.'
					);
				}
				if (input.picture) picture = { ...(await storePicture(book.id, id, input.picture)), alt };
				else if (picture) picture = { ...picture, alt };
				const entry: GlossaryEntryRecord = {
					id,
					name,
					aliases,
					description: input.description.trim(),
					picture,
					appearances: await appearancesOf(revisionId, { name, aliases })
				};
				const glossary = existing
					? record.draft.glossary.map((e) => (e.id === id ? entry : e))
					: [...record.draft.glossary, entry];
				const next = { ...record, draft: { ...record.draft, glossary } };
				const dto = await save(next, revisionId);
				await prunePictures(next);
				return dto;
			});
		},

		removeEntry(book, revisionId, entryId) {
			return serially(book.id, async () => {
				const record = await current(book.id, revisionId);
				if (!record.draft.glossary.some((e) => e.id === entryId)) {
					throw new BackendError('NOT_FOUND', 'That entry isn’t in the glossary.');
				}
				const glossary = record.draft.glossary.filter((e) => e.id !== entryId);
				const next = { ...record, draft: { ...record.draft, glossary } };
				const dto = await save(next, revisionId);
				await prunePictures(next);
				return dto;
			});
		},

		publish(book, revisionId, aiUse) {
			return serially(book.id, async () => {
				const record = await current(book.id, revisionId);
				const problems = publishStoryProblems(contentSummary(record.draft), aiUse);
				if (problems.length) throw validation(problems.join(' '));
				const next: StoryRecord = {
					...record,
					published: structuredClone(record.draft),
					publishedAt: clock.now().toISOString(),
					aiUse: aiUse!
				};
				const dto = await save(next, revisionId);
				await prunePictures(next);
				return dto;
			});
		},

		moveTo(bookId, revisionId) {
			return serially(bookId, async () => {
				const record = await db.get('stories', bookId);
				if (!record) return;
				await db.put('stories', {
					...record,
					draft: await on(record.draft, revisionId),
					published: record.published ? await on(record.published, revisionId) : null
				});
			});
		},

		async forReader(book, revisionId, readable) {
			const record = await db.get('stories', book.id);
			if (!record?.published || !record.publishedAt) return null;
			let published = record.published;
			if (published.revisionId !== revisionId) {
				published = await serially(book.id, async () => {
					const latest = (await db.get('stories', book.id))!;
					const moved = await on(latest.published!, revisionId);
					await db.put('stories', { ...latest, published: moved });
					return moved;
				});
			}
			const { manifest } = await textOf(revisionId);
			const order = new Map(manifest.chapters.map((c) => [c.chapterId, c.firstOrdinal]));
			const glossary: StoryGlossaryEntryDto[] = [];
			for (const entry of published.glossary) {
				const names = [entry.name, ...entry.aliases]
					.map((name, i) => ({ name, found: entry.appearances[i] }))
					.filter(({ found }) => !!found && readable(found.chapterId))
					.map(({ name, found }) => ({ name, firstAppearance: found!.anchor }));
				if (!names.length) continue;
				glossary.push({
					id: entry.id,
					names,
					description: entry.description,
					picture: await pictureOf(book.id, entry.picture)
				});
			}
			return {
				bookId: book.id,
				revisionId,
				aiUse: record.aiUse ?? 'none',
				publishedAt: record.publishedAt,
				recaps: published.recaps
					.filter((r) => r.text && order.has(r.chapterId) && readable(r.chapterId))
					.sort((a, b) => order.get(a.chapterId)! - order.get(b.chapterId)!)
					.map(({ chapterId, text }) => ({ chapterId, text })),
				glossary
			};
		}
	};
}
