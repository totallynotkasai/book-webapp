/**
 * Copies text. The async Clipboard API first; the old `execCommand` route where it's missing or
 * refused (some WebViews), with a hidden field so the reader's own selection isn't touched.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const field = document.createElement('textarea');
		field.value = text;
		field.setAttribute('readonly', '');
		field.style.position = 'fixed';
		field.style.opacity = '0';
		document.body.append(field);
		field.select();
		try {
			return document.execCommand('copy');
		} catch {
			return false;
		} finally {
			field.remove();
		}
	}
}
