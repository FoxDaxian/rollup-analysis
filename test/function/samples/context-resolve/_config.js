const path = require('path');
const assert = require('assert');

const tests = [
	{
		source: './existing',
		expected: {
			id: path.resolve(__dirname, 'existing.js'),
			external: false,
			moduleSideEffects: true,
			syntheticNamedExports: false
		}
	},
	{
		source: './missing-relative',
		expected: null
	},
	{
		source: 'missing-absolute',
		expected: null
	},
	{
		source: './marked-directly-external-relative',
		expected: {
			id: path.resolve(__dirname, 'marked-directly-external-relative'),
			external: true,
			moduleSideEffects: true,
			syntheticNamedExports: false
		}
	},
	{
		source: './marked-external-relative',
		expected: {
			id: path.resolve(__dirname, 'marked-external-relative'),
			external: true,
			moduleSideEffects: true,
			syntheticNamedExports: false
		}
	},
	{
		source: 'marked-external-absolute',
		expected: {
			id: 'marked-external-absolute',
			external: true,
			moduleSideEffects: true,
			syntheticNamedExports: false
		}
	},
	{
		source: 'resolved-name',
		expected: {
			id: 'resolved:resolved-name',
			external: false,
			moduleSideEffects: true,
			syntheticNamedExports: false
		}
	},
	{
		source: 'resolved-false',
		expected: {
			id: 'resolved-false',
			external: true,
			moduleSideEffects: true,
			syntheticNamedExports: false
		}
	},
	{
		source: 'resolved-object',
		expected: {
			id: 'resolved:resolved-object',
			external: false,
			moduleSideEffects: true,
			syntheticNamedExports: false
		}
	},
	{
		source: 'resolved-object-non-external',
		expected: {
			id: 'resolved:resolved-object-non-external',
			external: false,
			moduleSideEffects: true,
			syntheticNamedExports: false
		}
	},
	{
		source: 'resolved-object-external',
		expected: {
			id: 'resolved:resolved-object-external',
			external: true,
			moduleSideEffects: true,
			syntheticNamedExports: false
		}
	}
];

module.exports = {
	description: 'returns the correct results for the context resolve helper',
	options: {
		external: [
			'marked-external-absolute',
			'./marked-directly-external-relative',
			path.resolve(__dirname, 'marked-external-relative')
		],
		plugins: [
			{
				resolveId(id) {
					if (id === 'resolutions') {
						return id;
					}
				},
				load(id) {
					if (id === 'resolutions') {
						return Promise.all(
							tests.map(({ source, expected }) =>
								this.resolve(source, path.resolve(__dirname, 'main.js')).then(resolution =>
									assert.deepStrictEqual(resolution, expected)
								)
							)
						).then(result => `export default ${result.length}`);
					}
				}
			},
			{
				resolveId(id) {
					switch (id) {
						case 'resolved-name':
							return 'resolved:resolved-name';
						case 'resolved-false':
							return false;
						case 'resolved-object':
							return { id: 'resolved:resolved-object' };
						case 'resolved-object-non-external':
							return { id: 'resolved:resolved-object-non-external', external: false };
						case 'resolved-object-external':
							return { id: 'resolved:resolved-object-external', external: true };
					}
				}
			}
		]
	}
};
