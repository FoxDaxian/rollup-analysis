const path = require('path');
const assert = require('assert');
const sander = require('sander');
const { loader } = require('../utils.js');
const rollup = require('../../dist/rollup.js');

const TEMP_DIR = path.join(__dirname, 'tmp');

describe('hooks', () => {
	it('allows to read and modify options in the options hook', () =>
		rollup
			.rollup({
				input: 'input',
				treeshake: false,
				plugins: [
					loader({ newInput: `alert('hello')` }),
					{
						buildStart(options) {
							assert.strictEqual(options.input, 'newInput');
							assert.strictEqual(options.treeshake, false);
						},
						options(options) {
							assert.strictEqual(options.input, 'input');
							assert.strictEqual(options.treeshake, false);
							assert.ok(/^\d+\.\d+\.\d+/.test(this.meta.rollupVersion));
							return Object.assign({}, options, { input: 'newInput' });
						}
					}
				]
			})
			.then(bundle => {}));

	it('allows to read and modify output options in the outputOptions hook', () =>
		rollup
			.rollup({
				input: 'input',
				treeshake: false,
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						renderChunk(code, chunk, options) {
							assert.strictEqual(options.banner, 'new banner');
							assert.strictEqual(options.format, 'cjs');
						},
						outputOptions(options) {
							assert.strictEqual(options.banner, 'banner');
							assert.strictEqual(options.format, 'cjs');
							assert.ok(/^\d+\.\d+\.\d+/.test(this.meta.rollupVersion));
							return Object.assign({}, options, { banner: 'new banner' });
						}
					}
				]
			})
			.then(bundle =>
				bundle.generate({
					format: 'cjs',
					banner: 'banner'
				})
			)
			.then(({ output }) => {
				assert.strictEqual(output[0].code, `new banner\n'use strict';\n\nalert('hello');\n`);
			}));

	it('allows to replace file with dir in the outputOptions hook', () =>
		rollup
			.rollup({
				input: 'input',
				treeshake: false,
				plugins: [
					loader({
						input: `console.log('input');import('other');`,
						other: `console.log('other');`
					}),
					{
						outputOptions(options) {
							const newOptions = Object.assign({}, options, {
								dir: TEMP_DIR,
								chunkFileNames: 'chunk.js'
							});
							delete newOptions.file;
							return newOptions;
						}
					}
				]
			})
			.then(bundle =>
				bundle.write({
					file: path.join(TEMP_DIR, 'bundle.js'),
					format: 'esm'
				})
			)
			.then(() => {
				const fileNames = sander.readdirSync(TEMP_DIR).sort();
				assert.deepStrictEqual(fileNames, ['chunk.js', 'input.js']);
				return sander.rimraf(TEMP_DIR);
			}));

	it('supports buildStart and buildEnd hooks', () => {
		let buildStartCnt = 0;
		let buildEndCnt = 0;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						buildStart() {
							buildStartCnt++;
							assert(this.meta);
							assert(this.meta.rollupVersion);
						},
						buildEnd() {
							buildEndCnt++;
							assert(this.meta);
							assert(this.meta.rollupVersion);
						}
					}
				]
			})
			.then(bundle => {
				assert.strictEqual(buildStartCnt, 1);
				assert.strictEqual(buildEndCnt, 1);

				return rollup.rollup({
					input: 'input',
					plugins: [
						loader({ input: `invalid_source - @#$%^&*` }),
						{
							buildStart() {
								buildStartCnt++;
							},
							buildEnd() {
								buildEndCnt++;
							}
						}
					]
				});
			})
			.catch(err => {
				assert.ok(err);
			})
			.then(() => {
				assert.strictEqual(buildStartCnt, 2);
				assert.strictEqual(buildEndCnt, 2);
			});
	});

	it('supports warnings in buildStart and buildEnd hooks', () => {
		let callCnt = 0;
		return rollup
			.rollup({
				input: 'input',
				onwarn(warning) {
					if (callCnt === 0) {
						assert.strictEqual(warning.message, 'build start');
						callCnt++;
					} else if (callCnt === 1) {
						assert.strictEqual(warning.message, 'build end');
						callCnt++;
					}
				},
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						buildStart() {
							this.warn('build start');
						},
						buildEnd() {
							this.warn('build end');
						}
					}
				]
			})
			.then(() => {
				assert.strictEqual(callCnt, 2);
			});
	});

	it('passes errors to the buildEnd hook', () => {
		let handledError = false;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						buildStart() {
							this.error('build start error');
						},
						buildEnd(error) {
							assert.strictEqual(error.message, 'build start error');
							handledError = true;
						}
					}
				]
			})
			.catch(error => {
				assert.ok(handledError);
				assert.strictEqual(error.message, 'build start error');
			})
			.then(() => {
				assert.ok(handledError);
			});
	});

	it('supports isExternal on plugin context', () =>
		rollup.rollup({
			input: 'input',
			external: ['test'],
			plugins: [
				loader({ input: `alert('hello')` }),
				{
					buildStart() {
						assert.strictEqual(this.isExternal('test'), true);
						assert.strictEqual(this.isExternal('another'), false);
					}
				}
			]
		}));

	it('supports resolveId on plugin context', () =>
		rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({
						input: `import 'test'`,
						dep1: `import 'next'`,
						dep2: `alert('hello')`
					}),
					{
						resolveId(id) {
							if (id === 'test') return 'dep1';
							if (id === 'next') return this.resolveId('final');
							if (id === 'final') return 'dep2';
						}
					}
				]
			})
			.then(bundle => bundle.generate({ format: 'es' }))
			.then(({ output: [output] }) => {
				assert.strictEqual(output.code, `alert('hello');\n`);
			}));

	it('caches chunk emission in transform hook', () => {
		let cache;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: '', chunk: "console.log('chunk');" }),
					{
						transform(code, id) {
							if (id === 'input') {
								return `export default import.meta.ROLLUP_FILE_URL_${this.emitFile({
									type: 'chunk',
									id: 'chunk'
								})};`;
							}
						}
					}
				]
			})
			.then(bundle => {
				cache = bundle.cache;
				return bundle.generate({ format: 'es' });
			})
			.then(({ output }) => {
				assert.strictEqual(
					output[0].code,
					`var input = new URL('chunk-928cb70b.js', import.meta.url).href;\n\nexport default input;\n`
				);
				assert.strictEqual(output[1].fileName, 'chunk-928cb70b.js');
				assert.strictEqual(output[1].code, `console.log('chunk');\n`);

				return rollup.rollup({
					cache,
					input: 'input',
					plugins: [
						loader({ input: '', chunk: "console.log('chunk');" }),
						{
							transform() {
								assert.fail('Should cache transform');
							}
						}
					]
				});
			})
			.then(bundle => {
				cache = bundle.cache;
				return bundle.generate({ format: 'es' });
			})
			.then(({ output }) => {
				assert.strictEqual(
					output[0].code,
					`var input = new URL('chunk-928cb70b.js', import.meta.url).href;\n\nexport default input;\n`
				);
				assert.strictEqual(output[1].fileName, 'chunk-928cb70b.js');
				assert.strictEqual(output[1].code, `console.log('chunk');\n`);

				return rollup.rollup({
					cache,
					input: 'input',
					plugins: [
						loader({ input: '', chunk: "console.log('chunk');" }),
						{
							transform() {
								assert.fail('Should cache transform');
							}
						}
					]
				});
			})
			.then(bundle => bundle.generate({ format: 'es' }))
			.then(({ output }) => {
				assert.strictEqual(
					output[0].code,
					`var input = new URL('chunk-928cb70b.js', import.meta.url).href;\n\nexport default input;\n`
				);
				assert.strictEqual(output[1].fileName, 'chunk-928cb70b.js');
				assert.strictEqual(output[1].code, `console.log('chunk');\n`);
			});
	});

	it('does not overwrite files in other outputs when emitting assets during generate', () => {
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: 'export default 42;' }),
					{
						generateBundle(outputOptions) {
							this.emitFile({ type: 'asset', source: outputOptions.format });
						}
					}
				]
			})
			.then(bundle =>
				Promise.all([
					bundle.generate({ format: 'es', assetFileNames: 'asset' }),
					bundle.generate({ format: 'cjs', assetFileNames: 'asset' })
				])
			)
			.then(([{ output: output1 }, { output: output2 }]) => {
				assert.strictEqual(output1.length, 2, 'output1');
				assert.strictEqual(output1[1].fileName, 'asset');
				assert.strictEqual(output1[1].source, 'es');
				assert.strictEqual(output2.length, 2, 'output2');
				assert.strictEqual(output2[1].fileName, 'asset');
				assert.strictEqual(output2[1].source, 'cjs');
			});
	});

	it('caches asset emission in transform hook', () => {
		let cache;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: '' }),
					{
						transform() {
							return `export default import.meta.ROLLUP_FILE_URL_${this.emitFile({
								type: 'asset',
								name: 'test.ext',
								source: 'hello world'
							})};`;
						}
					}
				]
			})
			.then(bundle => {
				cache = bundle.cache;
				return bundle.generate({ format: 'es' });
			})
			.then(({ output }) => {
				assert.strictEqual(
					output[0].code,
					`var input = new URL('assets/test-0a676135.ext', import.meta.url).href;\n\nexport default input;\n`
				);
				assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
				assert.strictEqual(output[1].source, 'hello world');

				return rollup.rollup({
					cache,
					input: 'input',
					plugins: [
						loader({ input: '' }),
						{
							transform() {
								assert.fail('Should cache transform');
							}
						}
					]
				});
			})
			.then(bundle => {
				cache = bundle.cache;
				return bundle.generate({ format: 'es' });
			})
			.then(({ output }) => {
				assert.strictEqual(
					output[0].code,
					`var input = new URL('assets/test-0a676135.ext', import.meta.url).href;\n\nexport default input;\n`
				);
				assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
				assert.strictEqual(output[1].source, 'hello world');

				return rollup.rollup({
					cache,
					input: 'input',
					plugins: [
						loader({ input: '' }),
						{
							transform() {
								assert.fail('Should cache transform');
							}
						}
					]
				});
			})
			.then(bundle => bundle.generate({ format: 'es' }))
			.then(({ output }) => {
				assert.strictEqual(
					output[0].code,
					`var input = new URL('assets/test-0a676135.ext', import.meta.url).href;\n\nexport default input;\n`
				);
				assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
				assert.strictEqual(output[1].source, 'hello world');
			});
	});

	it('keeps emitted ids stable between runs', () => {
		let cache;
		let emittedFile;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					{
						resolveId(id) {
							return id;
						},
						load(id) {
							if (id === 'input') {
								return '';
							}
							this.setAssetSource(emittedFile, 'first run');
							return `console.log('imported')`;
						},
						transform(code, id) {
							if (id === 'input') {
								emittedFile = this.emitFile({
									type: 'asset',
									name: 'test.ext'
								});
								return (
									`import 'imported';\n` +
									`export default import.meta.ROLLUP_FILE_URL_${emittedFile};`
								);
							}
						}
					}
				]
			})
			.then(bundle => {
				cache = bundle.cache;
				return bundle.generate({ format: 'es' });
			})
			.then(({ output }) => {
				assert.strictEqual(
					output[0].code,
					`console.log('imported');\n\n` +
						`var input = new URL('assets/test-09aeb845.ext', import.meta.url).href;\n\n` +
						`export default input;\n`
				);
				assert.strictEqual(output[1].fileName, 'assets/test-09aeb845.ext');
				assert.strictEqual(output[1].source, 'first run');

				return rollup.rollup({
					cache,
					input: 'input',
					plugins: [
						{
							resolveId(id) {
								return id;
							},
							load(id) {
								if (id === 'input') {
									return '';
								}
								this.setAssetSource(emittedFile, 'second run');
								return `console.log('imported')`;
							},
							transform() {
								assert.fail('Should cache transform');
							}
						}
					]
				});
			})
			.then(bundle => bundle.generate({ format: 'es' }))
			.then(({ output }) => {
				assert.strictEqual(
					output[0].code,
					`console.log('imported');\n\n` +
						`var input = new URL('assets/test-ce5fc71b.ext', import.meta.url).href;\n\n` +
						`export default input;\n`
				);
				assert.strictEqual(output[1].fileName, 'assets/test-ce5fc71b.ext');
				assert.strictEqual(output[1].source, 'second run');
			});
	});

	it('opts-out transform hook cache for custom cache', () => {
		let runs = 0;
		let cache;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: '' }),
					{
						name: 'x',
						transform() {
							this.cache.set('asdf', 'asdf');
							runs++;
							const assetId = this.emitFile({
								type: 'asset',
								name: 'test.ext',
								source: 'hello world'
							});
							return `export default import.meta.ROLLUP_FILE_URL_${assetId};`;
						}
					}
				]
			})
			.then(bundle => {
				cache = bundle.cache;
				return bundle.generate({ format: 'es' });
			})
			.then(({ output }) => {
				assert.strictEqual(
					output[0].code,
					`var input = new URL('assets/test-0a676135.ext', import.meta.url).href;\n\nexport default input;\n`
				);
				assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
				assert.strictEqual(output[1].source, 'hello world');
				assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
				assert.strictEqual(output[1].source, 'hello world');

				return rollup.rollup({
					cache,
					input: 'input',
					plugins: [
						loader({ input: '' }),
						{
							name: 'x',
							transform() {
								runs++;
								return `alert('hello world')`;
							}
						}
					]
				});
			})
			.then(bundle => bundle.generate({ format: 'es' }))
			.then(({ output }) => {
				assert.strictEqual(runs, 2);
				assert.strictEqual(output[0].code.trim(), `alert('hello world');`);
				assert.strictEqual(output.length, 1);
			});
	});

	it('supports generateBundle hook including reporting rendered exports and source length', () =>
		rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({
						input: `export { a as default } from 'dep';`,
						dep: `export var a = 1; export var b = 2;`
					}),
					{
						generateBundle(options, outputBundle, isWrite) {
							assert.strictEqual(isWrite, false);
							const chunk = outputBundle['input.js'];

							// can detect that b has been tree-shaken this way
							assert.strictEqual(chunk.modules['dep'].renderedExports[0], 'a');
							assert.strictEqual(chunk.modules['dep'].renderedExports.length, 1);

							assert.strictEqual(chunk.modules['dep'].removedExports[0], 'b');
							assert.strictEqual(chunk.modules['dep'].removedExports.length, 1);

							assert.strictEqual(chunk.modules['dep'].renderedLength, 10);
							assert.strictEqual(chunk.modules['dep'].originalLength, 35);
						}
					}
				]
			})
			.then(bundle => bundle.generate({ format: 'es' })));

	it('supports writeBundle hook', () => {
		const file = path.join(TEMP_DIR, 'bundle.js');
		let bundle;
		let callCount = 0;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({
						input: `export { a as default } from 'dep';`,
						dep: `export var a = 1; export var b = 2;`
					}),
					{
						generateBundle(options, outputBundle, isWrite) {
							bundle = outputBundle;
							assert.strictEqual(isWrite, true);
						}
					},
					{
						writeBundle(outputBundle) {
							assert.deepStrictEqual(outputBundle, bundle);
							callCount++;
						}
					}
				]
			})
			.then(bundle => bundle.write({ format: 'esm', file }))
			.then(() => {
				assert.strictEqual(callCount, 1);
				return sander.rimraf(TEMP_DIR);
			});
	});

	it('supports this.cache for plugins', () =>
		rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						name: 'cachePlugin',
						buildStart() {
							this.cache.set('asdf', 'asdf');
						}
					}
				]
			})
			.then(bundle =>
				rollup.rollup({
					input: 'input',
					cache: bundle.cache,
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							name: 'cachePlugin',
							buildStart() {
								assert.ok(this.cache.has('asdf'));
								assert.strictEqual(this.cache.get('asdf'), 'asdf');
								assert.strictEqual(this.cache.delete('asdf'), true);
								assert.ok(!this.cache.has('asdf'));
							}
						}
					]
				})
			));

	it('Allows plugins with any names using a shared cacheKey', () =>
		rollup.rollup({
			input: 'input',
			plugins: [
				loader({ input: `alert('hello')` }),
				{
					name: 'a',
					cacheKey: 'a9b6',
					buildStart() {
						this.cache.set('asdf', 'asdf');
					}
				},
				{
					name: 'a',
					cacheKey: 'a9b6',
					buildEnd() {
						assert.strictEqual(this.cache.get('asdf'), 'asdf');
					}
				},
				{
					name: 'b',
					cacheKey: 'a9b6',
					buildEnd() {
						assert.strictEqual(this.cache.get('asdf'), 'asdf');
					}
				}
			]
		}));

	it('Evicts cache entries after cacheExpiry runs with no usage', () =>
		rollup
			.rollup({
				input: 'input',
				experimentalCacheExpiry: 5,
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						name: 'x',
						buildStart() {
							this.cache.set('first', 'first');
							this.cache.set('second', 'second');
						}
					}
				]
			})
			.then(bundle => {
				let promise = Promise.resolve();
				for (let i = 0; i < 5; i++)
					promise = promise.then(() =>
						rollup.rollup({
							cache: bundle.cache,
							input: 'input',
							experimentalCacheExpiry: 5,
							plugins: [
								loader({ input: `alert('hello')` }),
								{
									name: 'x',
									buildStart() {
										if (i === 4) assert.strictEqual(this.cache.has('second'), true);
									}
								}
							]
						})
					);
				return promise;
			})
			.then(bundle =>
				rollup.rollup({
					cache: bundle.cache,
					input: 'input',
					experimentalCacheExpiry: 5,
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							name: 'x',
							buildStart() {
								assert.strictEqual(this.cache.has('first'), false);
								assert.strictEqual(this.cache.get('first'), undefined);
								assert.strictEqual(this.cache.get('second'), 'second');
							}
						}
					]
				})
			));

	it('Supports disabling the cache with cache: false', () =>
		rollup
			.rollup({
				input: 'input',
				cache: false,
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						name: 'x',
						buildStart() {
							this.cache.set('x', 'x');
							assert.ok(!this.cache.has('x'));
							assert.strictEqual(this.cache.get('x'), undefined);
							this.cache.delete('x');
						}
					}
				]
			})
			.then(bundle => {
				assert.strictEqual(bundle.cache, undefined);
			}));

	it('Disables the default transform cache when using cache in transform only', () =>
		rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						name: 'x',
						transform() {
							this.cache.set('asdf', 'asdf');
							return `alert('hello world')`;
						}
					}
				]
			})
			.then(bundle =>
				rollup.rollup({
					input: 'input',
					cache: bundle.cache,
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							name: 'x',
							transform() {
								assert.ok(this.cache.has('asdf'));
								assert.strictEqual(this.cache.get('asdf'), 'asdf');
								this.cache.delete('asdf');
								assert.ok(!this.cache.has('asdf'));
								return `alert('hello')`;
							}
						}
					]
				})
			)
			.then(bundle =>
				bundle.generate({
					format: 'es'
				})
			)
			.then(({ output }) => {
				assert.strictEqual(output[0].code.trim(), `alert('hello');`);
			}));

	it('supports renderStart hook', () => {
		let renderStartCount = 0;
		let generateBundleCount = 0;
		let renderErrorCount = 0;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						renderStart() {
							renderStartCount++;
							assert.strictEqual(generateBundleCount, 0);
							assert.strictEqual(renderErrorCount, 0);
						},
						generateBundle() {
							generateBundleCount++;
							assert.strictEqual(renderStartCount, 1);
							assert.strictEqual(renderErrorCount, 0);
						},
						renderError() {
							renderErrorCount++;
						}
					}
				]
			})
			.then(bundle => bundle.generate({ format: 'esm' }))
			.then(() => {
				assert.strictEqual(renderStartCount, 1, 'renderStart count');
				assert.strictEqual(generateBundleCount, 1, 'generateBundle count');
				assert.strictEqual(renderErrorCount, 0, 'renderError count');
			});
	});

	it('supports renderError hook', () => {
		let renderStartCount = 0;
		let generateBundleCount = 0;
		let renderErrorCount = 0;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({ input: `alert('hello')` }),
					{
						renderStart() {
							renderStartCount++;
						},
						renderChunk() {
							throw Error('renderChunk error');
						},
						generateBundle() {
							generateBundleCount++;
						},
						renderError(error) {
							assert(error);
							assert.strictEqual(error.message, 'renderChunk error');
							assert.strictEqual(renderStartCount, 1);
							renderErrorCount++;
						}
					}
				]
			})
			.then(bundle => bundle.generate({ format: 'esm' }))
			.catch(err => {
				assert.ok(err);
			})
			.then(() => {
				assert.strictEqual(renderStartCount, 1, 'renderStart count');
				assert.strictEqual(generateBundleCount, 0, 'generateBundle count');
				assert.strictEqual(renderErrorCount, 1, 'renderError count');
			});
	});

	it('Warns once when using deprecated this.watcher in plugins', () => {
		const warnings = [];
		const watcher = rollup.watch({
			input: 'input',
			onwarn(warning) {
				warnings.push(warning);
			},
			output: {
				format: 'esm'
			},
			plugins: [
				loader({ input: `alert('hello')` }),
				{
					name: 'x',
					buildStart() {
						this.watcher.on('change', () => {});
						this.watcher.on('change', () => {});
					}
				}
			]
		});
		return new Promise((resolve, reject) => {
			watcher.on('event', event => {
				if (event.code === 'BUNDLE_END') resolve();
				else if (event.code === 'ERROR') reject(event.error);
			});
		}).catch(err => {
			assert.strictEqual(
				err.message,
				'You must specify "output.file" or "output.dir" for the build.'
			);
			assert.strictEqual(warnings.length, 1);
			const warning = warnings[0];
			assert.strictEqual(warning.code, 'PLUGIN_WARNING');
			assert.strictEqual(warning.pluginCode, 'PLUGIN_WATCHER_DEPRECATED');
			assert.strictEqual(
				warning.message,
				'this.watcher usage is deprecated in plugins. Use the watchChange plugin hook and this.addWatchFile() instead.'
			);
		});
	});

	it('Throws when not specifying "file" or "dir"', () => {
		const watcher = rollup.watch({
			input: 'input',
			output: {
				format: 'esm'
			},
			plugins: [loader({ input: `alert('hello')` })]
		});
		return new Promise((resolve, reject) => {
			watcher.on('event', event => {
				if (event.code === 'BUNDLE_END') reject(new Error('Expected an error'));
				else if (event.code === 'ERROR') reject(event.error);
			});
		}).catch(err => {
			assert.strictEqual(
				err.message,
				'You must specify "output.file" or "output.dir" for the build.'
			);
		});
	});

	it('Throws when using the "file"" option for multiple chunks', () => {
		const watcher = rollup.watch({
			input: 'input',
			output: {
				format: 'esm',
				file: 'bundle.js'
			},
			plugins: [loader({ input: `import('dep')`, dep: `console.log('dep')` })]
		});
		return new Promise((resolve, reject) => {
			watcher.on('event', event => {
				if (event.code === 'BUNDLE_END') reject(new Error('Expected an error'));
				else if (event.code === 'ERROR') reject(event.error);
			});
		}).catch(err => {
			assert.strictEqual(
				err.message,
				'You must set "output.dir" instead of "output.file" when generating multiple chunks.'
			);
		});
	});

	it('Throws when using the "sourcemapFile" option for multiple chunks', () => {
		const watcher = rollup.watch({
			input: 'input',
			output: {
				format: 'esm',
				sourcemapFile: 'bundle.map',
				dir: 'ignored'
			},
			plugins: [loader({ input: `import('dep')`, dep: `console.log('dep')` })]
		});
		return new Promise((resolve, reject) => {
			watcher.on('event', event => {
				if (event.code === 'BUNDLE_END') reject(new Error('Expected an error'));
				else if (event.code === 'ERROR') reject(event.error);
			});
		}).catch(err => {
			assert.strictEqual(
				err.message,
				'"output.sourcemapFile" is only supported for single-file builds.'
			);
		});
	});

	it('assigns chunk IDs before creating outputBundle chunks', () => {
		const chunks = [];
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({
						input: `export default [import('a'), import('b')];`,
						a: `import d from 'd'; import c from 'c'; export default () => c();`,
						b: `import c from 'c'; export default () => c();`,
						c: `export default () => console.log('c');`,
						d: `export default {};`
					}),
					{
						renderChunk(code, chunk, options) {
							chunks.push({
								fileName: chunk.fileName,
								imports: chunk.imports,
								modules: Object.keys(chunk.modules)
							});
						}
					}
				]
			})
			.then(bundle =>
				bundle.generate({
					entryFileNames: '[name].js',
					chunkFileNames: 'generated-[name].js',
					format: 'esm'
				})
			)
			.then(() => {
				assert.deepEqual(chunks, [
					{
						fileName: 'input.js',
						imports: [],
						modules: ['input']
					},
					{
						fileName: 'generated-a.js',
						imports: ['generated-c.js'],
						modules: ['d', 'a']
					},
					{
						fileName: 'generated-c.js',
						imports: [],
						modules: ['c']
					},
					{
						fileName: 'generated-b.js',
						imports: ['generated-c.js'],
						modules: ['b']
					}
				]);
			});
	});

	it('supports augmentChunkHash hook', () => {
		let augmentChunkHashCalls = 0;
		return rollup
			.rollup({
				input: 'input',
				plugins: [
					loader({
						input: `alert('hello')`
					}),
					{
						augmentChunkHash(update) {
							augmentChunkHashCalls++;
							assert(this.meta);
							assert(this.meta.rollupVersion);
						}
					}
				]
			})
			.then(bundle =>
				bundle.generate({
					format: 'esm',
					dir: 'dist',
					entryFileNames: '[name]-[hash].js'
				})
			)
			.then(output => {
				assert.strictEqual(augmentChunkHashCalls, 1);
			});
	});

	describe('deprecated', () => {
		it('passes bundle & output object to ongenerate & onwrite hooks, with deprecation warnings', () => {
			let deprecationCnt = 0;

			return rollup
				.rollup({
					input: 'input',
					onwarn(warning) {
						deprecationCnt++;
						if (deprecationCnt === 1) {
							assert.strictEqual(warning.code, 'DEPRECATED_FEATURE');
							assert.strictEqual(
								warning.message,
								'The "ongenerate" hook used by plugin at position 2 is deprecated. The "generateBundle" hook should be used instead.'
							);
						} else {
							assert.strictEqual(warning.code, 'DEPRECATED_FEATURE');
							assert.strictEqual(
								warning.message,
								'The "onwrite" hook used by plugin at position 2 is deprecated. The "generateBundle/writeBundle" hook should be used instead.'
							);
						}
					},
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							ongenerate(bundle, out) {
								out.ongenerate = true;
							},

							onwrite(bundle, out) {
								assert.strictEqual(out.ongenerate, true);
							}
						}
					]
				})
				.then(bundle =>
					bundle.write({
						file: path.join(TEMP_DIR, 'bundle.js'),
						format: 'es'
					})
				)
				.then(() => {
					assert.strictEqual(deprecationCnt, 2);
					return sander.rimraf(TEMP_DIR);
				});
		});

		it('calls ongenerate hooks in sequence', () => {
			const result = [];

			return rollup
				.rollup({
					input: 'input',
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							ongenerate(info) {
								result.push({ a: info.format });
							}
						},
						{
							ongenerate(info) {
								result.push({ b: info.format });
							}
						}
					]
				})
				.then(bundle => bundle.generate({ format: 'cjs' }))
				.then(() => {
					assert.deepEqual(result, [{ a: 'cjs' }, { b: 'cjs' }]);
				});
		});

		it('calls onwrite hooks in sequence', () => {
			const result = [];
			const file = path.join(TEMP_DIR, 'bundle.js');

			return rollup
				.rollup({
					input: 'input',
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							onwrite(info) {
								return new Promise(fulfil => {
									setTimeout(() => {
										result.push({ a: info.file, format: info.format });
										fulfil();
									}, 10);
								});
							}
						},
						{
							onwrite(info) {
								result.push({ b: info.file, format: info.format });
							}
						}
					]
				})
				.then(bundle =>
					bundle.write({
						file,
						format: 'cjs'
					})
				)
				.then(() => {
					assert.deepEqual(result, [
						{ a: file, format: 'cjs' },
						{ b: file, format: 'cjs' }
					]);
					return sander.rimraf(TEMP_DIR);
				});
		});

		it('supports transformChunk in place of transformBundle, with deprecation warning', () => {
			let calledHook = false;
			let deprecationCnt = 0;
			return rollup
				.rollup({
					input: 'input',
					onwarn(warning) {
						deprecationCnt++;
						assert.strictEqual(warning.code, 'DEPRECATED_FEATURE');
						assert.strictEqual(
							warning.message,
							'The "transformChunk" hook used by plugin at position 2 is deprecated. The "renderChunk" hook should be used instead.'
						);
					},
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							transformChunk(code, id) {
								calledHook = true;
								try {
									this.emitAsset('test.ext', 'hello world');
								} catch (e) {
									assert.strictEqual(e.code, 'ASSETS_ALREADY_FINALISED');
								}
							}
						}
					]
				})
				.then(bundle =>
					bundle.generate({
						format: 'es',
						assetFileNames: '[name][extname]'
					})
				)
				.then(() => {
					assert.strictEqual(deprecationCnt, 1);
					assert.strictEqual(calledHook, true);
				});
		});

		it('passes bundle object to generateBundle hook', () =>
			rollup
				.rollup({
					input: 'input',
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							transform() {
								const assetId = this.emitAsset('test.ext', 'hello world');
								return `export default import.meta.ROLLUP_ASSET_URL_${assetId};`;
							},
							generateBundle(options, outputBundle, isWrite) {
								assert.strictEqual(outputBundle['assets/test-0a676135.ext'].source, 'hello world');
								assert.strictEqual(
									outputBundle['input.js'].code,
									`var input = new URL('assets/test-0a676135.ext', import.meta.url).href;\n\nexport default input;\n`
								);
							}
						}
					]
				})
				.then(bundle => bundle.generate({ format: 'es' })));

		it('caches chunk emission in transform hook', () => {
			let cache;
			return rollup
				.rollup({
					input: 'input',
					plugins: [
						loader({ input: '', chunk: "console.log('chunk');" }),
						{
							transform(code, id) {
								if (id === 'input') {
									return `export default import.meta.ROLLUP_CHUNK_URL_${this.emitChunk('chunk')};`;
								}
							}
						}
					]
				})
				.then(bundle => {
					cache = bundle.cache;
					return bundle.generate({ format: 'es' });
				})
				.then(({ output }) => {
					assert.strictEqual(
						output[0].code,
						`var input = new URL('chunk-928cb70b.js', import.meta.url).href;\n\nexport default input;\n`
					);
					assert.strictEqual(output[1].fileName, 'chunk-928cb70b.js');
					assert.strictEqual(output[1].code, `console.log('chunk');\n`);

					return rollup.rollup({
						cache,
						input: 'input',
						plugins: [
							loader({ input: '', chunk: "console.log('chunk');" }),
							{
								transform() {
									assert.fail('Should cache transform');
								}
							}
						]
					});
				})
				.then(bundle => {
					cache = bundle.cache;
					return bundle.generate({ format: 'es' });
				})
				.then(({ output }) => {
					assert.strictEqual(
						output[0].code,
						`var input = new URL('chunk-928cb70b.js', import.meta.url).href;\n\nexport default input;\n`
					);
					assert.strictEqual(output[1].fileName, 'chunk-928cb70b.js');
					assert.strictEqual(output[1].code, `console.log('chunk');\n`);

					return rollup.rollup({
						cache,
						input: 'input',
						plugins: [
							loader({ input: '', chunk: "console.log('chunk');" }),
							{
								transform() {
									assert.fail('Should cache transform');
								}
							}
						]
					});
				})
				.then(bundle => bundle.generate({ format: 'es' }))
				.then(({ output }) => {
					assert.strictEqual(
						output[0].code,
						`var input = new URL('chunk-928cb70b.js', import.meta.url).href;\n\nexport default input;\n`
					);
					assert.strictEqual(output[1].fileName, 'chunk-928cb70b.js');
					assert.strictEqual(output[1].code, `console.log('chunk');\n`);
				});
		});

		it('caches asset emission in transform hook', () => {
			let cache;
			return rollup
				.rollup({
					input: 'input',
					plugins: [
						loader({ input: '' }),
						{
							transform() {
								const assetId = this.emitAsset('test.ext', 'hello world');
								return `export default import.meta.ROLLUP_ASSET_URL_${assetId};`;
							}
						}
					]
				})
				.then(bundle => {
					cache = bundle.cache;
					return bundle.generate({ format: 'es' });
				})
				.then(({ output }) => {
					assert.strictEqual(
						output[0].code,
						`var input = new URL('assets/test-0a676135.ext', import.meta.url).href;\n\nexport default input;\n`
					);
					assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
					assert.strictEqual(output[1].source, 'hello world');
					assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
					assert.strictEqual(output[1].source, 'hello world');

					return rollup.rollup({
						cache,
						input: 'input',
						plugins: [
							loader({ input: '' }),
							{
								transform() {
									assert.fail('Should cache transform');
								}
							}
						]
					});
				})
				.then(bundle => {
					cache = bundle.cache;
					return bundle.generate({ format: 'es' });
				})
				.then(({ output }) => {
					assert.strictEqual(
						output[0].code,
						`var input = new URL('assets/test-0a676135.ext', import.meta.url).href;\n\nexport default input;\n`
					);
					assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
					assert.strictEqual(output[1].source, 'hello world');
					assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
					assert.strictEqual(output[1].source, 'hello world');

					return rollup.rollup({
						cache,
						input: 'input',
						plugins: [
							loader({ input: '' }),
							{
								transform() {
									assert.fail('Should cache transform');
								}
							}
						]
					});
				})
				.then(bundle => bundle.generate({ format: 'es' }))
				.then(({ output }) => {
					assert.strictEqual(
						output[0].code,
						`var input = new URL('assets/test-0a676135.ext', import.meta.url).href;\n\nexport default input;\n`
					);
					assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
					assert.strictEqual(output[1].source, 'hello world');
					assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
					assert.strictEqual(output[1].source, 'hello world');
				});
		});

		it('opts-out transform hook cache for custom cache', () => {
			let runs = 0;
			let cache;
			return rollup
				.rollup({
					input: 'input',
					plugins: [
						loader({ input: '' }),
						{
							name: 'x',
							transform() {
								this.cache.set('asdf', 'asdf');
								runs++;
								const assetId = this.emitAsset('test.ext', 'hello world');
								return `export default import.meta.ROLLUP_ASSET_URL_${assetId};`;
							}
						}
					]
				})
				.then(bundle => {
					cache = bundle.cache;
					return bundle.generate({ format: 'es' });
				})
				.then(({ output }) => {
					assert.strictEqual(
						output[0].code,
						`var input = new URL('assets/test-0a676135.ext', import.meta.url).href;\n\nexport default input;\n`
					);
					assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
					assert.strictEqual(output[1].source, 'hello world');
					assert.strictEqual(output[1].fileName, 'assets/test-0a676135.ext');
					assert.strictEqual(output[1].source, 'hello world');

					return rollup.rollup({
						cache,
						input: 'input',
						plugins: [
							loader({ input: '' }),
							{
								name: 'x',
								transform() {
									runs++;
									return `alert('hello world')`;
								}
							}
						]
					});
				})
				.then(bundle => bundle.generate({ format: 'es' }))
				.then(({ output }) => {
					assert.strictEqual(runs, 2);
					assert.strictEqual(output[0].code.trim(), `alert('hello world');`);
					assert.strictEqual(output.length, 1);
				});
		});

		it('allows setting asset source at generateBundle', () => {
			let assetId;
			return rollup
				.rollup({
					input: 'input',
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							transform() {
								return '';
							},
							generateBundle() {
								assetId = this.emitAsset('test.ext');
								this.setAssetSource(assetId, 'hello world');
							}
						}
					]
				})
				.then(bundle => bundle.generate({ format: 'es' }))
				.then(({ output: [, output] }) => {
					assert.strictEqual(output.source, 'hello world');
				});
		});

		it('allows setting asset source separately', () => {
			let assetId;
			return rollup
				.rollup({
					input: 'input',
					plugins: [
						loader({ input: `alert('hello')` }),
						{
							transform() {
								assetId = this.emitAsset('test.ext');
								return '';
							},
							generateBundle() {
								this.setAssetSource(assetId, 'hello world');
							}
						}
					]
				})
				.then(bundle => bundle.generate({ format: 'es' }))
				.then(({ output: [, output] }) => {
					assert.strictEqual(output.fileName, 'assets/test-0a676135.ext');
					assert.strictEqual(output.source, 'hello world');
				});
		});
	});
});
