import type { Frame, Page } from '@playwright/test';
import {
	expect,
	openPreferences,
	openReader,
	selectPhrase,
	settled,
	showChrome,
	switchPersona,
	test
} from './fixtures';

// Phase 1.20 (IMPLEMENTATION-PLAN.md §6): its Try-it items and the acceptance of P1-COM-03
// (paragraph comments) and P1-COM-04 (popular highlights), with the owner's choices (D-044):
// owners comment, a "Contains spoilers" switch, the author's switch, and "Comment" in the
// selection toolbar. Comments surviving a new Revision is a contract case (together.ts), where
// the Studio fixtures are.

/** The frame showing the Book's text. */
function bookFrame(page: Page): Frame {
	const frame = page.frames().find((f) => f.url().startsWith('blob:'));
	if (!frame) throw new Error('The reader has no Book frame');
	return frame;
}

const markers = (page: Page) => bookFrame(page).locator('[data-rd-marker]');
const sheet = (page: Page) => page.getByTestId('comments-sheet');

/** Reading preferences → Readers: one of its switches, on or off, then back to the Book. */
async function setReaders(
	page: Page,
	name: 'Readers’ comments' | 'Popular highlights',
	on: boolean
) {
	await openPreferences(page, 'Readers');
	const toggle = page.getByRole('switch', { name });
	if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', String(on));
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Reading preferences' })).toBeHidden();
}

/** The count beside the paragraph that starts with these words. */
function markerAfter(page: Page, paragraphStart: string) {
	return bookFrame(page)
		.locator('[data-b]', { hasText: paragraphStart })
		.last()
		.locator('[data-rd-marker]');
}

test.describe('paragraph comments (P1-COM-03)', () => {
	test('off by default; on in Alice, read Chapter I’s, reply, and report one to the Moderator', async ({
		page
	}) => {
		await openReader(page, 'book-alice');
		await expect(markers(page)).toHaveCount(0);
		await openPreferences(page, 'Readers');
		await expect(page.getByRole('switch', { name: 'Readers’ comments' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		await expect(page.getByRole('switch', { name: 'Popular highlights' })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		await page.keyboard.press('Escape');

		await setReaders(page, 'Readers’ comments', true);
		// The first paragraph: two comments (on two of its passages) and three replies.
		const first = markerAfter(page, 'Alice was beginning to get very tired');
		await expect(first).toHaveAccessibleName('5 comments on this paragraph');
		await expect(first).toHaveAttribute('data-rd-count', '5');
		// The count is drawn, so it adds no words to the Book (copying, quotes, search).
		expect(await first.evaluate((el) => el.textContent)).toBe('');

		await first.click();
		await expect(sheet(page)).toBeVisible();
		const comment = sheet(page).getByTestId('comment').filter({ hasText: 'same, Alice. Same.' });
		await expect(comment).toContainText('Priya N.');
		await expect(comment.getByTestId('reply')).toHaveCount(2);
		await expect(comment.getByTestId('reply').first()).toContainText('Ink & Quill');

		// Reply.
		await comment.getByRole('button', { name: 'Reply', exact: true }).click();
		await page.getByRole('textbox', { name: 'Your reply' }).fill('Same here, every time.');
		await comment.getByRole('button', { name: 'Reply', exact: true }).last().click();
		await expect(comment.getByTestId('reply')).toHaveCount(3);
		await expect(comment.getByTestId('reply').last()).toContainText('You');
		await expect(comment.getByTestId('reply').last()).toContainText('Same here, every time.');
		await page.keyboard.press('Escape');
		await expect(first).toHaveAccessibleName('6 comments on this paragraph');

		// Report another reader's comment.
		await markerAfter(page, 'Alice was beginning to get very tired').click();
		await sheet(page)
			.getByTestId('reply')
			.filter({ hasText: 'Try it with the narration on' })
			.getByRole('button', { name: 'Report' })
			.click();
		const dialog = page.getByRole('dialog', { name: /Report/ });
		await dialog.getByRole('radio', { name: /Spam/ }).check({ force: true });
		await dialog.getByRole('button', { name: 'Report', exact: true }).click();
		await expect(page.getByText('Reported. A moderator will look at it.')).toBeVisible();

		await switchPersona(page, 'Moderator');
		await page.goto('/admin');
		await page
			.getByRole('link', { name: /Reply on “Alice's Adventures in Wonderland” by Tom Baxter/ })
			.click();
		await expect(page.getByTestId('flag-excerpt')).toContainText('Try it with the narration on');
		await expect(page.getByTestId('flag-excerpt')).toContainText('On the passage');
		await expect(page.getByRole('button', { name: 'Suspend account' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Hide', exact: true }).click();
		await page.getByRole('textbox', { name: 'Reason' }).fill('Hidden for the test.');
		await page.getByRole('dialog').getByRole('button', { name: 'Hide' }).click();
		await expect(page.getByText('Hide: done. The commenter has been told.')).toBeVisible();

		// Hidden: gone for other readers.
		await switchPersona(page, 'Illustrator');
		await openReader(page, 'book-alice');
		await setReaders(page, 'Readers’ comments', true);
		await markerAfter(page, 'Alice was beginning to get very tired').click();
		await expect(sheet(page)).toContainText('same, Alice. Same.');
		await expect(sheet(page)).not.toContainText('Try it with the narration on');
	});

	test('“Comment” in the selection toolbar; spoilers stay behind “Show comment” for others; delete', async ({
		page
	}) => {
		await openReader(page, 'book-alice');
		await setReaders(page, 'Readers’ comments', true);
		await expect(markers(page).first()).toBeAttached();
		await selectPhrase(page, 'very sleepy and stupid');
		await page.getByRole('button', { name: 'Comment', exact: true }).click();
		await expect(sheet(page)).toBeVisible();
		await expect(sheet(page)).toContainText('On “very sleepy and stupid”');
		const box = page.getByRole('textbox', { name: 'Your comment' });
		await expect(box).toBeFocused();
		await box.fill('The heat matters: everything after this feels like a dream. Remember it.');
		await page.getByRole('switch', { name: 'Contains spoilers' }).click();
		await page.getByRole('button', { name: 'Post' }).click();
		const mine = sheet(page).getByTestId('comment').filter({ hasText: 'You' });
		await expect(mine).toContainText('The heat matters');
		await expect(mine).toContainText('Spoilers');
		await page.keyboard.press('Escape');
		const paragraph = markerAfter(page, 'So she was considering in her own mind');
		await expect(paragraph).toHaveAccessibleName('1 comment on this paragraph');

		// Another reader turns comments on for themselves, and sees it behind "Show comment".
		await switchPersona(page, 'Illustrator');
		await openReader(page, 'book-alice');
		await expect(markers(page)).toHaveCount(0);
		await setReaders(page, 'Readers’ comments', true);
		await markerAfter(page, 'So she was considering in her own mind').click();
		const theirs = sheet(page).getByTestId('comment').filter({ hasText: 'Robin Reader' });
		await expect(theirs).toContainText('This gives away some of what happens later.');
		await expect(theirs).not.toContainText('Remember it.');
		await theirs.getByRole('button', { name: 'Show comment' }).click();
		await expect(theirs).toContainText('Remember it.');
		await page.keyboard.press('Escape');

		// Its writer deletes it.
		await switchPersona(page, 'Reader');
		await openReader(page, 'book-alice');
		await markerAfter(page, 'So she was considering in her own mind').click();
		await sheet(page).getByRole('button', { name: 'Delete' }).click();
		await page
			.getByRole('dialog', { name: 'Delete your comment?' })
			.getByRole('button', {
				name: 'Delete'
			})
			.click();
		await expect(sheet(page)).toContainText('No comments on this paragraph yet.');
		await page.keyboard.press('Escape');
		await expect(markerAfter(page, 'So she was considering in her own mind')).toHaveCount(0);
	});

	test('the author turns comments off for their Book; readers see none, and why', async ({
		page
	}) => {
		await switchPersona(page, 'Author');
		await page.goto('/studio/books/book-lamplighters-ledger');
		await page.getByRole('tab', { name: 'Details' }).click();
		const allow = page.getByRole('switch', { name: 'Readers’ comments' });
		await expect(allow).toHaveAttribute('aria-checked', 'true');
		await allow.click();
		await page.getByRole('button', { name: 'Save details' }).click();
		await expect(page.getByText('Saved.')).toBeVisible();

		// The author owns it, so could comment: once their Book is known to be closed, nobody can.
		await openReader(page, 'book-lamplighters-ledger');
		await openPreferences(page, 'Readers');
		const toggle = page.getByRole('switch', { name: 'Readers’ comments' });
		await toggle.click();
		await expect(page.getByText('The author has turned comments off for this book.')).toBeVisible();
		await expect(toggle).toBeDisabled();
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await page.keyboard.press('Escape');
		await expect(markers(page)).toHaveCount(0);

		// On again, the seeded ones are back.
		await page.goto('/studio/books/book-lamplighters-ledger');
		await page.getByRole('tab', { name: 'Details' }).click();
		await page.getByRole('switch', { name: 'Readers’ comments' }).click();
		await page.getByRole('button', { name: 'Save details' }).click();
		await expect(page.getByText('Saved.')).toBeVisible();
		await openReader(page, 'book-lamplighters-ledger');
		await expect(markers(page).first()).toBeAttached();
	});
});

test.describe('popular highlights (P1-COM-04)', () => {
	test('turn them on and find the most highlighted line, only once it’s reached', async ({
		page
	}) => {
		await openReader(page, 'book-alice');
		await showChrome(page);
		await setReaders(page, 'Popular highlights', true);
		await expect
			.poll(() => bookFrame(page).evaluate(() => CSS.highlights.get('rd-popular')?.size ?? 0))
			.toBeGreaterThan(0);

		// Notes: only what's been reached (Invariant 6). The first page has one.
		await page.keyboard.press('n');
		const list = page.getByTestId('popular-list');
		await expect(list).toContainText('17 readers');
		await expect(list).toContainText('what is the use of a book');
		await expect(list).not.toContainText('really impossible');
		await page.keyboard.press('Escape');

		// Read to the end of Chapter I: the most highlighted line there comes first.
		await page.keyboard.press('End');
		await settled(page);
		await page.keyboard.press('n');
		const first = list.getByRole('button').first();
		await expect(first).toContainText('29 readers');
		await expect(first).toContainText('very few things indeed were really impossible');
		// Fewer than the minimum: not shown. Chapter II's isn't reached yet.
		await expect(list).not.toContainText('Do cats eat bats');
		await expect(list).not.toContainText('Curiouser');
		await first.click();
		await settled(page);

		// Its toolbar says how many, and never who.
		await selectPhrase(page, 'very few things indeed');
		await expect(page.getByTestId('popular-readers')).toHaveText('29 readers highlighted this');
	});

	test('off again, the underline goes', async ({ page }) => {
		await openReader(page, 'book-alice');
		await setReaders(page, 'Popular highlights', true);
		await expect
			.poll(() => bookFrame(page).evaluate(() => CSS.highlights.get('rd-popular')?.size ?? 0))
			.toBeGreaterThan(0);
		await setReaders(page, 'Popular highlights', false);
		await expect
			.poll(() => bookFrame(page).evaluate(() => CSS.highlights.has('rd-popular')))
			.toBe(false);
	});
});
