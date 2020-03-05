export default {
	input: 'main.js',
	output: [
		{
			format: 'cjs',
			file: '_actual/cjs.js',
			sourcemap: true
		},
		{
			format: 'es',
			file: '_actual/es.js',
			sourcemap: true
		}
	]
};
