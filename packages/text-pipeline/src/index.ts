export { IngestError } from './errors';
export {
	ingestEpub,
	MAX_EPUB_BYTES,
	type IngestedFile,
	type IngestOptions,
	type IngestResult
} from './ingest';
export { tokenise, words, type Token } from './tokenise';
export { assignWordIds, type AssignedWordIds } from './carry';
export { matchTokens, normaliseToken } from './diff';
export {
	migrateAnchor,
	migrateAnchors,
	migrateProgress,
	RevisionIndex,
	type Migrated,
	type MigrationStatus
} from './migrate';
export { readRevisionWords, type RevisionChapter, type RevisionWords } from './revision';
