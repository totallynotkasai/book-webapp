import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, expectNoViolations, openDevPanel, settled, switchPersona, test } from './fixtures';

// Phase 1.8 Try-it list (IMPLEMENTATION-PLAN.md §6): a community pack under the serial's
// `approval` policy, approved, endorsed, got and rated; `closed` stops submissions; a reader's
// report worked through the queue (relabel, then approve); the stub AI detector holding
// unlabelled work; and the dev panel's bulk upload firing `upload_volume`.

test.use({ viewport: { width: 1280, height: 800 } });

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PICTURE = join(ROOT, 'fixtures/src/status-window/OEBPS/images/sigil.png');
const SERIAL = { id: 'book-lamplighters-ledger', slug: 'the-lamplighters-ledger' };
const ALICE = { id: 'book-alice', slug: 'alices-adventures-in-wonderland' };

const dialog = (page: Page) => page.getByRole('dialog');

/** As the Illustrator: a new pack for a Book from its community hub, one picture, submitted. */
async function submitPack(page: Page, book: { slug: string }, name: string, aiAnswer = 'No') {
	await switchPersona(page, 'Illustrator');
	await page.goto(`/book/${book.slug}/community`);
	await page.getByRole('button', { name: 'New illustration pack' }).click();
	await dialog(page).getByLabel('Name').fill(name);
	await dialog(page).getByRole('radio', { name: aiAnswer }).click();
	await dialog(page).getByRole('button', { name: 'Create' }).click();
	await expect(page.getByTestId('creator-bar')).toContainText(`Creator mode · ${name}`);
	await expect(page.getByTestId('reader')).toHaveAttribute('data-ready', 'true', {
		timeout: 30_000
	});
	await settled(page);
	for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
	await page
		.getByRole('toolbar', { name: 'Selection' })
		.getByRole('button', { name: 'Attach picture' })
		.click();
	await dialog(page).locator('input[type=file]').setInputFiles(PICTURE);
	await expect(dialog(page).locator('img.preview')).toBeVisible();
	await dialog(page).getByLabel('Alt text').fill('An inked sketch');
	await dialog(page).getByRole('button', { name: 'Attach' }).click();
	await expect(page.getByText('Picture attached.').last()).toBeVisible();
	await page.getByRole('button', { name: 'Submit pack' }).click();
}

test('a community pack: submitted, approved and endorsed, then got and rated (P1-COM-01, P1-COM-02)', async ({
	page
}) => {
	test.slow();
	await submitPack(page, SERIAL, 'Lamplight sketches');
	await expect(page.getByText(/Sent to the author/)).toBeVisible();
	await expect(page.getByTestId('creator-bar')).toContainText('Waiting for the author');

	await switchPersona(page, 'Author');
	await page.goto('/you/inbox');
	await expect(page.getByTestId('inbox-message').first()).toContainText(
		/A community illustration pack for “The Lamplighter.s Ledger”/
	);
	await page.goto(`/studio/books/${SERIAL.id}`);
	await page.getByRole('tab', { name: 'Community' }).click();
	const pending = page.getByTestId('pending-layer');
	await expect(pending).toContainText('Lamplight sketches');
	await expectNoViolations(page);
	await pending.getByRole('button', { name: 'Approve' }).click();
	await dialog(page)
		.getByLabel(/note for the creator/)
		.fill('Lovely lanterns.');
	await dialog(page).getByRole('button', { name: 'Approve' }).click();
	const curated = page.getByTestId('curated-layer').filter({ hasText: 'Lamplight sketches' });
	await expect(curated).toContainText('Published');
	await curated.getByRole('switch', { name: 'Author-endorsed' }).click();
	await expect(page.getByText('Endorsed.')).toBeVisible();

	await switchPersona(page, 'Illustrator');
	await page.goto('/you/inbox');
	await expect(page.getByText('“Lamplight sketches” is listed')).toBeVisible();
	await expect(page.getByText('The author endorsed “Lamplight sketches”')).toBeVisible();

	await switchPersona(page, 'Reader');
	await page.goto(`/book/${SERIAL.slug}/community`);
	const layer = page.getByTestId('community-layer').filter({ hasText: 'Lamplight sketches' });
	await expect(layer).toContainText('Author-endorsed');
	await expect(layer.getByRole('button', { name: /Rate/ })).toHaveCount(0);
	await layer.getByRole('button', { name: 'Get' }).click();
	await dialog(page).getByRole('button', { name: 'Add to library' }).click();
	await expect(dialog(page)).toContainText('is in your library');
	await page.keyboard.press('Escape');
	await layer.getByRole('button', { name: 'Rate 5 stars' }).click();
	await expect(layer).toContainText('5.0 (1 rating)');
	await expect(layer.getByRole('button', { name: 'Rate 5 stars' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expectNoViolations(page);

	// The Creator's profile: follow them, and the pack is in their portfolio.
	await layer.getByRole('link', { name: 'Ink & Quill' }).click();
	await expect(page.getByTestId('portfolio')).toContainText('Lamplight sketches');
	const followers = Number((await page.getByTestId('followers').textContent())?.match(/\d+/)?.[0]);
	await page.getByRole('button', { name: 'Follow' }).click();
	await expect(page.getByTestId('followers')).toContainText(`${followers + 1}`);
	await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
});

test('closed: once the author closes the serial, the Illustrator can’t submit', async ({
	page
}) => {
	await switchPersona(page, 'Author');
	await page.goto(`/studio/books/${SERIAL.id}`);
	await page.getByRole('tab', { name: 'Details' }).click();
	await page.getByRole('radio', { name: /Not allowed/ }).click();
	await page.getByRole('button', { name: 'Save details' }).click();
	await expect(page.getByText('Saved.')).toBeVisible();

	await switchPersona(page, 'Illustrator');
	await page.goto(`/book/${SERIAL.slug}/community`);
	await expect(
		page.getByText('The author doesn’t take community illustrations or narration for this book.')
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'New illustration pack' })).toHaveCount(0);
});

test('a reader’s report, worked through the queue: relabel, then approve (P1-ADM-02)', async ({
	page
}) => {
	test.slow();
	await submitPack(page, ALICE, 'Wonderland doodles');
	await expect(page.getByText(/Published\. Readers with this pack/)).toBeVisible();

	await switchPersona(page, 'Reader');
	await page.goto(`/book/${ALICE.slug}/community`);
	const layer = page.getByTestId('community-layer').filter({ hasText: 'Wonderland doodles' });
	await layer.getByRole('button', { name: 'Report' }).click();
	await expect(dialog(page).getByRole('button', { name: 'Report' })).toBeDisabled();
	await dialog(page).getByRole('radio', { name: 'Made with AI but not labelled' }).click();
	await dialog(page)
		.getByLabel(/Details/)
		.fill('The hands look generated.');
	await dialog(page).getByRole('button', { name: 'Report' }).click();
	await expect(page.getByText('Reported. A moderator will look at it.')).toBeVisible();

	await switchPersona(page, 'Moderator');
	await page.goto('/admin');
	await page.getByRole('link', { name: 'Illustration pack: Wonderland doodles' }).click();
	await expect(page.getByText('The hands look generated.').first()).toBeVisible();
	await expectNoViolations(page);
	await page.getByRole('button', { name: 'Require relabelling' }).click();
	await dialog(page).getByLabel('Reason').fill('Please say how AI was used.');
	await dialog(page).getByRole('button', { name: 'Require relabelling' }).click();
	await expect(page.getByText('Relabelling requested')).toBeVisible();

	await switchPersona(page, 'Illustrator');
	await page.goto('/studio');
	const work = page.getByTestId('community-work').filter({ hasText: 'Wonderland doodles' });
	await expect(work).toContainText('Correct its AI label');
	await work.getByRole('link', { name: 'Wonderland doodles' }).click();
	await expect(
		page.getByText(/A moderator asked you to correct this pack’s AI label/)
	).toBeVisible();
	await page.getByTestId('creator-bar').getByRole('button', { name: 'Details' }).click();
	await dialog(page).getByRole('radio', { name: 'AI-assisted' }).click();
	await dialog(page).getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText(/A moderator asked you/)).toHaveCount(0);

	await switchPersona(page, 'Moderator');
	await page.goto('/admin');
	await page.getByRole('link', { name: 'Illustration pack: Wonderland doodles' }).click();
	await page.getByRole('button', { name: 'Approve' }).click();
	await dialog(page).getByLabel('Reason').fill('Relabelled as AI-assisted.');
	await dialog(page).getByRole('button', { name: 'Approve' }).click();
	await expect(page.getByText('Cleared')).toBeVisible();
	await page.goto('/admin/log');
	await expect(page.getByTestId('log-entry').first()).toContainText(
		'Approved “Wonderland doodles”'
	);
	await expect(page.getByTestId('log-entry').nth(1)).toContainText('Asked to relabel');

	await switchPersona(page, 'Reader');
	await page.goto(`/book/${ALICE.slug}/community`);
	await expect(
		page.getByTestId('community-layer').filter({ hasText: 'Wonderland doodles' })
	).toContainText('AI-assisted');
});

test('the AI detector says “suspect”: unlabelled work is held for review (P1-ADM-01)', async ({
	page
}) => {
	test.slow();
	await openDevPanel(page);
	await page.getByLabel('AI detector verdict').selectOption('suspect');
	await expect(page.getByText(/saved/i).first()).toBeVisible();
	await submitPack(page, ALICE, 'Suspicious sketches');
	await expect(page.getByText(/Held for review/).first()).toBeVisible();
	await expect(page.getByTestId('creator-bar')).toContainText('Held for review');

	await switchPersona(page, 'Reader');
	await page.goto(`/book/${ALICE.slug}/community`);
	await expect(page.getByText('Suspicious sketches')).toHaveCount(0);

	await switchPersona(page, 'Moderator');
	await page.goto('/admin');
	await page.getByRole('link', { name: 'Illustration pack: Suspicious sketches' }).click();
	await expect(page.getByText('Possible unlabelled AI').first()).toBeVisible();
	await expect(page.getByText('0.93').first()).toBeVisible();
});

test('the dev panel’s bulk upload fires upload_volume (P1-ADM-01)', async ({ page }) => {
	test.setTimeout(180_000);
	await switchPersona(page, 'Author');
	await openDevPanel(page);
	await page.getByRole('button', { name: 'Bulk upload: publish 10 test books' }).click();
	await expect(page.getByText(/Published 10 books/)).toBeVisible({ timeout: 150_000 });

	await switchPersona(page, 'Moderator');
	await page.goto('/admin');
	const flag = page.getByRole('listitem').filter({ hasText: 'Upload volume' });
	await expect(flag).toContainText('Creator: Wren Ashdown');
	await expect(flag).toContainText('Published 10 Books');
	await expect(page.getByText('Possible unlabelled AI')).toBeVisible();
});

test('a reader reports a Book from its page', async ({ page }) => {
	await page.goto(`/book/${SERIAL.slug}`);
	await page.getByRole('button', { name: 'Report this book' }).click();
	await dialog(page).getByRole('radio', { name: 'Something else' }).click();
	await expect(dialog(page).getByRole('button', { name: 'Report' })).toBeDisabled();
	await dialog(page).getByLabel('Tell us more').fill('Chapter 3 needs a warning.');
	await dialog(page).getByRole('button', { name: 'Report' }).click();
	await expect(page.getByText('Reported. A moderator will look at it.')).toBeVisible();
	await switchPersona(page, 'Moderator');
	await page.goto('/admin');
	await expect(
		page.getByRole('listitem').filter({ hasText: 'Book: The Lamplighter' }).first()
	).toContainText('Chapter 3 needs a warning.');
});
