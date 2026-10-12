// The ReaderEngine interface (DESIGN.md §9.1) and its foliate-js adapter (ADR-001). This is the
// only package that may import the engine (Invariant 8).
export * from './types';
export { ChapterWords, DocWordMap } from './word-map';
export { BASE_CSS, MARGINS, themeCss, typographyCss } from './styles';

/** The engine loads lazily, so the reader route's first paint doesn't wait for it (§12.3). */
export async function createEngine(): Promise<import('./types').ReaderEngine> {
	const { FoliateEngine } = await import('./foliate-engine');
	return new FoliateEngine();
}
