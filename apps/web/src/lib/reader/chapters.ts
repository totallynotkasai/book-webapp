import { chapterForOrdinal, type RevisionManifest } from '@book/core';

/**
 * The title of the part of the Book an Ordinal is in: the last TOC entry at or before it (so
 * sections inside a Chapter count), else the Chapter's own title.
 */
export function chapterTitleAt(manifest: RevisionManifest, ordinal: number): string {
	let label = '';
	for (const entry of manifest.toc) if (entry.ordinal <= ordinal) label = entry.label;
	return label || chapterForOrdinal(manifest.chapters, ordinal)?.title || 'Untitled';
}
