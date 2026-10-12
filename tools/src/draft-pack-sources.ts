/**
 * Drafts the demo Illustration Pack sources (P1-LAY-06) in `fixtures/layers/`: for each picture,
 * a short quote that appears exactly once in the catalogue *Alice*, found from the picture's
 * caption or the text beside it in its source edition. Run once; the committed sources are
 * hand-checked, and `build-packs` (strict) is what turns them into Anchors.
 *
 *   npx tsx src/draft-pack-sources.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { normaliseToken, tokenise } from '@book/text-pipeline';
import { loadBook, ROOT, type LoadedBook } from './book';

interface IndexImage {
	file: string;
	caption: string | null;
	alt: string | null;
	chapter: number | null;
	kind?: string;
	source?: string;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const tokensOf = (text: string) =>
	tokenise(text).map((t) => normaliseToken(text.slice(t.start, t.end)));

function chapterSpan(book: LoadedBook, chapter: number | null): [number, number] {
	if (chapter === null) return [0, book.index.wordCount - 1];
	const entries = book.manifest.toc.filter((t) => /^CHAPTER [IVX]+\./.test(t.label));
	const at = entries.findIndex((t) => t.label.startsWith(`CHAPTER ${ROMAN[chapter - 1]}.`));
	const start = entries[at]!.ordinal;
	const end = entries[at + 1] ? entries[at + 1]!.ordinal - 1 : book.index.wordCount - 1;
	return [start, end];
}

/** The longest run of `q` that appears in the span, as [start in book, length]. */
function longestRun(book: LoadedBook, q: string[], span: [number, number]): [number, number] {
	const tokens = book.index.tokens;
	let best: [number, number] = [-1, 0];
	let previous = new Array<number>(q.length + 1).fill(0);
	for (let o = span[0]; o <= span[1]; o++) {
		const row = new Array<number>(q.length + 1).fill(0);
		for (let k = 1; k <= q.length; k++) {
			if (tokens[o] === q[k - 1]) {
				row[k] = previous[k - 1]! + 1;
				if (row[k]! > best[1]) best = [o - row[k]! + 1, row[k]!];
			}
		}
		previous = row;
	}
	return best;
}

function occurrences(book: LoadedBook, start: number, length: number): number {
	const tokens = book.index.tokens;
	let count = 0;
	for (let s = 0; s + length <= tokens.length; s++) {
		let k = 0;
		while (k < length && tokens[s + k] === tokens[start + k]) k++;
		if (k === length) count++;
	}
	return count;
}

/** Up to 14 Words of the run, extended until it's unique in the Book. */
function quoteFrom(book: LoadedBook, start: number, length: number): string | null {
	let n = Math.min(length, 14);
	while (n <= length && occurrences(book, start, n) > 1) n++;
	if (n > length) return null;
	return book.index.quote(start, start + n - 1).exact;
}

/** Plain text before and after an image in an EPUB's XHTML, for pictures without a caption. */
function textAround(archive: Record<string, Uint8Array>, image: string, words = 40) {
	const name = image.split('/').pop()!;
	for (const [path, data] of Object.entries(archive)) {
		if (!/\.x?html?$/.test(path)) continue;
		const xhtml = strFromU8(data);
		const at = xhtml.indexOf(name);
		if (at < 0) continue;
		const plain = (s: string) =>
			s
				.replace(/<[^>]+>/g, ' ')
				.replace(/&[a-z]+;|&#\d+;/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
				.split(' ');
		return {
			after: plain(xhtml.slice(at))
				.slice(1, words + 1)
				.join(' '),
			before: plain(xhtml.slice(0, at)).slice(-words).join(' ')
		};
	}
	return { after: '', before: '' };
}

const RACKHAM_ALT: Record<string, string> = {
	'01-alice.jpg':
		'Alice stands facing us in a knee-length patterned dress, striped stockings and boots, her hands behind her back.',
	'02-down-the-rabbit-hole.jpg':
		'The White Rabbit, in a waistcoat, runs past the dark mouth of a rabbit-hole under a bank of brambles and long grass.',
	'03-curiouser-and-curiouser.jpg':
		'Alice, grown very tall and thin, stands stiffly with her arms held away from her sides.',
	'04-the-pool-of-tears.jpg':
		'Alice swims in the pool of tears among a crowd of creatures: a duck, a dodo, a mouse, a crab and other birds and beasts.',
	'05-but-who-has-won.jpg':
		'The Dodo, a duck and a crowd of birds and small animals press round Alice, all asking who has won.',
	'06-alice-and-the-mouse.jpg':
		'The Mouse sits up on its haunches with its long tail curled, facing Alice, who sits cross-legged on the ground.',
	'07-why-mary-ann.jpg':
		'Under a tall bare tree the White Rabbit leans forward, calling to Alice, who stands small among the stones.',
	'08-advice-from-a-caterpillar.jpg':
		'Alice stands beside a huge mushroom, looking up at the blue Caterpillar sitting on top of it, smoking a hookah.',
	'09-she-was-frightened.jpg':
		'Alice, shrunk so suddenly that her chin is pressed against her feet, peers out from under her flying hair.',
	'10-the-pigeon.jpg':
		'Alice’s head rises above the treetops on her long neck as a pigeon flies at her through the tangled branches.',
	'11-the-footman-and-alice.jpg':
		'The Frog-Footman sits on the step by a closed door, gazing up at the sky, while Alice stands beside him pointing at the door.',
	'12-saucepan-flew-close-by.jpg':
		'In the Duchess’s smoky kitchen, plates and a saucepan fly through the air at the Duchess and the baby, while Alice throws up her hands.',
	'13-it-grunted-again.jpg':
		'Alice stands in long grass holding the baby, which has turned into a little pig.',
	'14-cheshire-cat-in-a-tree.jpg':
		'The Cheshire Cat lies stretched along the branches of a tree, grinning.',
	'15-cheshire-cat-again.jpg':
		'Alice stands small at the foot of a gnarled tree, looking up at the Cheshire Cat in its branches.',
	'16-a-mad-tea-party.jpg':
		'The Hatter and the March Hare sit at a long table laid with cups and teapots, with Alice in a large armchair at the far end.',
	'17-turn-them-over.jpg':
		'Playing-card gardeners hurriedly paint the white roses of a rose tree red while more cards look on.',
	'18-playing-croquet.jpg':
		'Alice tucks a flamingo under her arm, its long neck held straight to use as a croquet mallet.',
	'19-the-cat.jpg': 'The Cheshire Cat’s grinning head floats on a little cloud, with no body.',
	'20-the-executioner.jpg':
		'The executioner, a playing card of clubs in a checked hood, leans on a long axe.',
	'21-off-with-his-head.jpg':
		'The King and Queen of Hearts stand with their court beside a rose tree, the Queen shouting, as a hedgehog crosses the ground.',
	'22-gryphon.jpg': 'The Gryphon lies asleep in the sun at the foot of a gnarled tree.',
	'23-thats-very-curious.jpg':
		'Alice sits on a rock by the sea between the Gryphon and the Mock Turtle.',
	'24-mock-turtle.jpg':
		'The Mock Turtle, with a calf’s head on a turtle’s body, rears up on its hind flippers.',
	'25-who-stole-the-tarts.jpg':
		'The court in session: the King and Queen of Hearts on their thrones, the White Rabbit with a trumpet, the jury and the cards below.',
	'26-the-cook.jpg': 'The Duchess’s cook, a large woman, strides along carrying a pepper-box.',
	'27-the-whole-pack-rose-up.jpg':
		'Alice throws up her arms as the whole pack of cards flies up into the air around her.'
};

const book = await loadBook();

function draft(
	images: IndexImage[],
	candidates: (img: IndexImage) => string[],
	shape: (img: IndexImage, i: number) => Record<string, unknown>
) {
	return images.map((img, i) => {
		const span = chapterSpan(book, img.chapter);
		let best: { start: number; length: number; from: string } | null = null;
		for (const [c, text] of candidates(img).entries()) {
			if (!text) continue;
			const [start, length] = longestRun(book, tokensOf(text), span);
			if (length >= 5 && (!best || length > best.length)) {
				best = { start, length, from: ['caption', 'after', 'before'][c] ?? 'text' };
			}
		}
		const quote = best ? quoteFrom(book, best.start, best.length) : null;
		console.log(
			`${img.file.padEnd(36)} ch${String(img.chapter ?? '-').padStart(2)} ${best?.from ?? 'NONE'} ${best?.length ?? 0}w  ${quote ?? '!! no unique quote'}`
		);
		return { ...shape(img, i), quote: quote ?? 'TODO' };
	});
}

const tenniel = JSON.parse(readFileSync(`${ROOT}/fixtures/images/tenniel/index.json`, 'utf8')) as {
	images: IndexImage[];
};
const tennielIllustrations = draft(
	tenniel.images,
	(img) => [img.caption ?? ''],
	(img, i) => ({
		id: `tenniel-${String(i + 1).padStart(2, '0')}`,
		file: img.file,
		alt: img.alt,
		caption: img.caption,
		placement: 'inline',
		span: 'single',
		spoilerSafe: img.chapter !== null && img.chapter <= 2
	})
);

const rackhamArchive = unzipSync(
	new Uint8Array(readFileSync(`${ROOT}/fixtures/epub/alice-rackham-gutenberg.epub`))
);
const rackham = JSON.parse(readFileSync(`${ROOT}/fixtures/images/rackham/index.json`, 'utf8')) as {
	images: IndexImage[];
};
const rackhamIllustrations = draft(
	rackham.images.map((img) => (img.chapter === null ? { ...img, chapter: 1 } : img)),
	(img) => {
		const around = textAround(rackhamArchive, img.source ?? img.file);
		return [img.caption ?? '', around.after, around.before];
	},
	(img, i) => ({
		id: `rackham-${String(i + 1).padStart(2, '0')}`,
		file: img.file,
		alt: RACKHAM_ALT[img.file],
		caption: img.caption ?? undefined,
		placement: img.kind?.startsWith('colour plate') ? 'full_page' : 'inline',
		span: 'single',
		spoilerSafe: img.chapter !== null && img.chapter <= 2
	})
);

const common = { bookId: 'book-alice', epub: 'apps/web/static/books/alice.epub' };
writeFileSync(
	`${ROOT}/fixtures/layers/tenniel.source.json`,
	JSON.stringify(
		{
			id: 'pack-alice-tenniel',
			...common,
			creatorId: 'creator-lewis-carroll',
			name: 'John Tenniel’s illustrations',
			description:
				'The 42 wood engravings from the first edition (1865), placed where Carroll’s text describes them.',
			isOfficial: true,
			aiUse: 'none',
			credit: 'Illustrations by John Tenniel (1865), public domain. Images: Standard Ebooks, CC0.',
			images: 'fixtures/images/tenniel',
			illustrations: tennielIllustrations
		},
		null,
		'\t'
	) + '\n'
);
writeFileSync(
	`${ROOT}/fixtures/layers/rackham.source.json`,
	JSON.stringify(
		{
			id: 'pack-alice-rackham',
			...common,
			creatorId: 'creator-ink-and-quill',
			name: 'Arthur Rackham’s illustrations',
			description:
				'Rackham’s 1907 colour plates and drawings, curated for this edition by Ink & Quill.',
			isOfficial: false,
			aiUse: 'none',
			credit:
				'Illustrations by Arthur Rackham (1907), public domain, from Project Gutenberg #28885. Curated by Ink & Quill.',
			images: 'fixtures/images/rackham',
			illustrations: rackhamIllustrations
		},
		null,
		'\t'
	) + '\n'
);
