import type { Role } from '@book/core';

/**
 * Who may do what (§10.6). Enforced inside the backend, not only by hiding UI: `backend-local`
 * rejects with `FORBIDDEN` exactly as the Phase 2 API must.
 */
export const permissions = {
	/** Creator Studio: own Books, packs, tracks, plans. */
	studio: ['creator', 'admin'],
	/** The admin review queue, Flags and moderation actions. */
	moderation: ['moderator', 'admin']
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof permissions;

export function can(role: Role | undefined, permission: Permission): boolean {
	return role !== undefined && (permissions[permission] as readonly Role[]).includes(role);
}
