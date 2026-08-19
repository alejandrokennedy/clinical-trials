// `@rollup/plugin-dsv` (see vite.config.js) turns a .csv import into a parsed
// array of row objects, one per line, keyed by header. Every value is a string.
declare module "*.csv" {
	const rows: Record<string, string>[];
	export default rows;
}
