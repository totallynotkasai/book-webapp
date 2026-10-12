import type { IconName } from './icons';

/** An entry in a `Menu`. */
export interface MenuItem {
	label: string;
	icon?: IconName;
	onselect: () => void;
	disabled?: boolean;
	danger?: boolean;
}

/** A destination in the navigation bar or rail (IMPLEMENTATION-PLAN.md §5.1). */
export interface NavItem {
	href: string;
	label: string;
	icon: IconName;
	/** Shown while the destination is current. */
	activeIcon?: IconName;
	active: boolean;
}

/** A tab in `Tabs`. */
export interface TabItem<V extends string = string> {
	value: V;
	label: string;
	icon?: IconName;
	/** A count shown beside the label. */
	count?: number;
}
