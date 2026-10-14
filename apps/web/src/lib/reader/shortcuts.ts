/**
 * The keyboard map (DESIGN.md §11.7: full keyboard use with documented shortcuts). The reader's
 * `?` dialog and Help both show it (P1-QA-02).
 */
export type Shortcut = [keys: string, action: string];

export const READER_SHORTCUTS: Shortcut[] = [
	['→  or  Page Down  or  Space', 'Next page'],
	['←  or  Page Up  or  Shift+Space', 'Previous page'],
	['Home  /  End', 'Start or end of the chapter'],
	['Ctrl +  /  Ctrl −  /  Ctrl 0', 'Larger, smaller or default text'],
	['Esc', 'Show or hide the reading controls; close a panel'],
	['Tab', 'Show the reading controls and move through them'],
	['Shift+→  /  Shift+←', 'Select words on the page, one at a time'],
	['Tab, then ←  →', 'With a selection: move through highlight colours, note and copy'],
	['H', 'Highlight the selection in the last colour used'],
	['B', 'Bookmark this page, or remove its bookmark'],
	['N', 'Notes and highlights'],
	['?', 'This list']
];

export const APP_SHORTCUTS: Shortcut[] = [
	['Tab  /  Shift+Tab', 'Move to the next or previous control'],
	['Tab, first on a page', '“Skip to content”, past the navigation'],
	['Enter  or  Space', 'Use the control that has focus'],
	['←  →  ↑  ↓', 'Move within tabs, choices, menus and sliders'],
	['Esc', 'Close a dialog, sheet or menu']
];
