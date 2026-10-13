/**
 * Modal surfaces close when the pointer goes down outside them, but not for the snackbar: its
 * "Undo" belongs to what was just done inside the sheet or dialog (e.g. deleting a note), so
 * pressing it must neither close the surface nor reach the page behind.
 */
export const SNACKBAR_HOST_ATTRIBUTE = 'data-snackbar-host';

export function keepOpenForSnackbar(event: Event): void {
	const target = event.target;
	if (target instanceof Element && target.closest(`[${SNACKBAR_HOST_ATTRIBUTE}]`)) {
		event.preventDefault();
	}
}
