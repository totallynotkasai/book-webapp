/**
 * The first-run welcome (P1-QA-03): shown once per device, the first time the app opens, and
 * again from Help. Like the theme cache, it is a device setting kept in localStorage, not user
 * data, so switching Persona doesn't bring it back.
 */
export const WELCOME_KEY = 'book-welcome';

function seen(): boolean {
	try {
		return localStorage.getItem(WELCOME_KEY) === 'seen';
	} catch {
		// Storage blocked: showing the welcome every time would nag, so don't show it at all.
		return true;
	}
}

class WelcomeState {
	open = $state(false);
	/** True when it opened by itself, on a first visit, rather than from Help. */
	firstRun = $state(false);

	/** Opens the welcome if this device hasn't seen it. */
	start() {
		if (seen()) return;
		this.firstRun = true;
		this.open = true;
	}

	show() {
		this.firstRun = false;
		this.open = true;
	}

	/** Closes it for good on this device. */
	dismiss() {
		this.open = false;
		try {
			localStorage.setItem(WELCOME_KEY, 'seen');
		} catch {
			// Nothing to remember it in; it closes for now.
		}
	}
}

export const welcome = new WelcomeState();
