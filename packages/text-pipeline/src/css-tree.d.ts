// css-tree's subpath modules (parser, walker and generator without the lexer and its large
// property database, which the sanitiser doesn't need). They export the same functions as the
// package root, typed by @types/css-tree.
declare module 'css-tree/parser' {
	import type { parse } from 'css-tree';
	const parser: typeof parse;
	export default parser;
}

declare module 'css-tree/walker' {
	import type { walk } from 'css-tree';
	const walker: typeof walk;
	export default walker;
}

declare module 'css-tree/generator' {
	import type { generate } from 'css-tree';
	const generator: typeof generate;
	export default generator;
}
