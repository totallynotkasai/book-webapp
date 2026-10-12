import type {
	DeepLinksAdapter,
	FilesAdapter,
	HapticsAdapter,
	Platform,
	ShareAdapter
} from './types';
import { webAudio } from './web-audio';

export { webAudio };

export const webFiles: FilesAdapter = {
	pickFiles({ accept, multiple = false }) {
		return new Promise((resolve) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = accept.join(',');
			input.multiple = multiple;
			input.addEventListener('change', () => resolve([...(input.files ?? [])]));
			input.addEventListener('cancel', () => resolve([]));
			input.click();
		});
	},
	async saveFile({ name, mimeType, data }) {
		const blob = typeof data === 'string' ? new Blob([data], { type: mimeType }) : data;
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = name;
		link.rel = 'noopener';
		document.body.append(link);
		link.click();
		link.remove();
		// Give the download a moment to start before the URL goes away.
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
		return 'saved';
	}
};

export const webShare: ShareAdapter = {
	get supported() {
		return typeof navigator.share === 'function';
	},
	async share(content) {
		if (typeof navigator.share !== 'function') return 'unsupported';
		try {
			await navigator.share(content);
			return 'shared';
		} catch {
			return 'cancelled';
		}
	}
};

const VIBRATION_MS = { light: 10, medium: 20, heavy: 35 } as const;

export const webHaptics: HapticsAdapter = {
	impact(strength) {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		navigator.vibrate?.(VIBRATION_MS[strength]);
	}
};

/** On the web a "deep link" is just the URL the app was opened at; nothing arrives later. */
export const webDeepLinks: DeepLinksAdapter = {
	onOpen: () => () => {}
};

export function webPlatform(): Platform {
	return {
		kind: 'web',
		audio: webAudio(),
		files: webFiles,
		share: webShare,
		haptics: webHaptics,
		deepLinks: webDeepLinks
	};
}
