// SPIKE (P0-04/P0-05): throwaway code for /spike/reader. Deleted once ADR-001 and ADR-002 are
// accepted (DESIGN.md §13.1). Engines load lazily so each can be measured on its own.
export * from './engine';
export * from './publication';

export type EngineId = 'foliate' | 'readium';

export async function createEngine(id: EngineId) {
	if (id === 'foliate') return new (await import('./foliate')).FoliateEngine();
	return new (await import('./readium')).ReadiumEngine();
}
