import { version as rollupVersion } from 'package.json';
import Chunk from '../Chunk'; // 一个大类
import { optimizeChunks } from '../chunk-optimization';
import Graph from '../Graph';
import { createAddons } from '../utils/addons';
import { assignChunkIds } from '../utils/assignChunkIds';
import commondir from '../utils/commondir';
import {
	errCannotEmitFromOptionsHook,
	errDeprecation,
	errInvalidExportOptionValue,
	error
} from '../utils/error';
import { writeFile } from '../utils/fs';
import getExportMode from '../utils/getExportMode';
import mergeOptions, { ensureArray, GenericConfigObject } from '../utils/mergeOptions';
import { basename, dirname, isAbsolute, resolve } from '../utils/path';
import { PluginDriver } from '../utils/PluginDriver';
import { ANONYMOUS_OUTPUT_PLUGIN_PREFIX, ANONYMOUS_PLUGIN_PREFIX } from '../utils/pluginUtils';
import { SOURCEMAPPING_URL } from '../utils/sourceMappingURL';
import { getTimings, initialiseTimers, timeEnd, timeStart } from '../utils/timers';
import {
	InputOptions,
	OutputAsset,
	OutputBundle,
	OutputBundleWithPlaceholders,
	OutputChunk,
	OutputOptions,
	Plugin,
	RollupBuild,
	RollupOutput,
	RollupWatcher,
	WarningHandler
} from './types';

function checkOutputOptions(options: OutputOptions) {
	if ((options.format as string) === 'es6') {
		return error(
			errDeprecation({
				message: 'The "es6" output format is deprecated – use "esm" instead',
				url: `https://rollupjs.org/guide/en/#output-format`
			})
		);
	}

	if (['amd', 'cjs', 'system', 'es', 'iife', 'umd'].indexOf(options.format as string) < 0) {
		return error({
			message: `You must specify "output.format", which can be one of "amd", "cjs", "system", "esm", "iife" or "umd".`,
			url: `https://rollupjs.org/guide/en/#output-format`
		});
	}

	if (options.exports && !['default', 'named', 'none', 'auto'].includes(options.exports)) {
		return error(errInvalidExportOptionValue(options.exports));
	}
}

function getAbsoluteEntryModulePaths(chunks: Chunk[]): string[] {
	const absoluteEntryModulePaths: string[] = [];
	for (const chunk of chunks) {
		for (const entryModule of chunk.entryModules) {
			if (isAbsolute(entryModule.id)) {
				absoluteEntryModulePaths.push(entryModule.id);
			}
		}
	}
	return absoluteEntryModulePaths;
}

const throwAsyncGenerateError = {
	get() {
		throw new Error(`bundle.generate(...) now returns a Promise instead of a { code, map } object`);
	}
};

function applyOptionHook(inputOptions: InputOptions, plugin: Plugin) {
	// 适配插件的options钩子函数
	if (plugin.options)
		return plugin.options.call({ meta: { rollupVersion } }, inputOptions) || inputOptions;

	return inputOptions;
}

function normalizePlugins(rawPlugins: any, anonymousPrefix: string): Plugin[] {
	// 转换操作进而肯定得到plugins数组
	const plugins = ensureArray(rawPlugins);
	// 如果当前plugin没有name属性，那么主动设置改plugin在所有插件中的位置和一个前缀
	for (let pluginIndex = 0; pluginIndex < plugins.length; pluginIndex++) {
		const plugin = plugins[pluginIndex];
		if (!plugin.name) {
			// 设置plugin的名字为 匿名字首 + 当前插件的索引
			plugin.name = `${anonymousPrefix}${pluginIndex + 1}`;
		}
	}
	return plugins;
}

function getInputOptions(rawInputOptions: GenericConfigObject): InputOptions {
	if (!rawInputOptions) {
		throw new Error('You must supply an options object to rollup');
	}
	// mergeOptions 返回 input 和 output 配置信息，和一个传递非合法属性的error
	let { inputOptions, optionError } = mergeOptions({
		config: rawInputOptions
	});

	// input配置中的onwran用于抛出rollup获取的非法配置信息
	if (optionError)
		(inputOptions.onwarn as WarningHandler)({ message: optionError, code: 'UNKNOWN_OPTION' });

	// xxx! 叹号断言前面的属性非null或者非undefined
	// 如果插件中有options钩子函数，并且返回非空，那么用options的结果覆盖当前的未完全配置完毕input配置
	// 市面上的某些插件用来修改input配置：比如
	// https://github.com/rollup/plugins/blob/825ef02252cd8fc64adf88473107d9d44404a2fb/packages/multi-entry/src/index.js
	// 但是官网推荐使用buildStart
	inputOptions = inputOptions.plugins!.reduce(applyOptionHook, inputOptions);

	// 给所有没有name属性的plugin设置 前缀(ANONYMOUS_PLUGIN_PREFIX) + 在所有plugin中的索引值
	inputOptions.plugins = normalizePlugins(inputOptions.plugins!, ANONYMOUS_PLUGIN_PREFIX);

	// 将动态导入的依赖(import | require.ensure() | other)内嵌到一个chunk而不创建独立的包，相关的代码逻辑如下
	if (inputOptions.inlineDynamicImports) {
		// preserveModules: 尽可能的保留模块，而不是混合起来，创建更少的chunks，默认为false，不开启
		if (inputOptions.preserveModules) // 如果开启了，就与内嵌冲突了
			return error({
				code: 'INVALID_OPTION',
				message: `"preserveModules" does not support the "inlineDynamicImports" option.`
			});
		// manualChunks：手动管理如何打包，比如公共包，react相关包，vue相关包等等，和webpack4的SplitChunks类似
		if (inputOptions.manualChunks) // 同上，冲突了
			return error({
				code: 'INVALID_OPTION',
				message: '"manualChunks" option is not supported for "inlineDynamicImports".'
			});

		// 实验性的优化打包chunk的功能，如果chunk太大，会按照规则优化，文档没找到，反正也是不能一起用啊
		if (inputOptions.experimentalOptimizeChunks)
			return error({
				code: 'INVALID_OPTION',
				message: '"experimentalOptimizeChunks" option is not supported for "inlineDynamicImports".'
			});

		// 只能在单入口的时候使用
		if (
			(inputOptions.input instanceof Array && inputOptions.input.length > 1) ||
			(typeof inputOptions.input === 'object' && Object.keys(inputOptions.input).length > 1)
		)
			return error({
				code: 'INVALID_OPTION',
				message: 'Multiple inputs are not supported for "inlineDynamicImports".'
			});
	} else if (inputOptions.preserveModules) {
		// 又对 以原始文件命名，不综合打包 的功能进行排异处理
		if (inputOptions.manualChunks)
			return error({
				code: 'INVALID_OPTION',
				message: '"preserveModules" does not support the "manualChunks" option.'
			});
		if (inputOptions.experimentalOptimizeChunks)
			return error({
				code: 'INVALID_OPTION',
				message: '"preserveModules" does not support the "experimentalOptimizeChunks" option.'
			});
	}

	// 返回input配置
	return inputOptions;
}

let curWatcher: RollupWatcher;
export function setWatcher(watcher: RollupWatcher) {
	curWatcher = watcher;
}

function assignChunksToBundle(
	chunks: Chunk[],
	outputBundle: OutputBundleWithPlaceholders
): OutputBundle {
	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		const facadeModule = chunk.facadeModule;

		outputBundle[chunk.id!] = {
			code: undefined as any,
			dynamicImports: chunk.getDynamicImportIds(),
			exports: chunk.getExportNames(),
			facadeModuleId: facadeModule && facadeModule.id,
			fileName: chunk.id,
			imports: chunk.getImportIds(),
			isDynamicEntry: facadeModule !== null && facadeModule.dynamicallyImportedBy.length > 0,
			isEntry: facadeModule !== null && facadeModule.isEntryPoint,
			map: undefined,
			modules: chunk.renderedModules,
			get name() {
				return chunk.getChunkName();
			},
			type: 'chunk'
		} as OutputChunk;
	}
	return outputBundle as OutputBundle;
}

// Promise<RollupBuild> => 函数的返回值是promise，promise的返回值是：RollupBuild
export default async function rollup(rawInputOptions: GenericConfigObject): Promise<RollupBuild> {
	// 返回input配置
	const inputOptions = getInputOptions(rawInputOptions);

	// 如果指定了pref，那么打包的时候回返回花费时间，内部会将计算时间的函数从noop改为真正有逻辑的时间计算函数
	initialiseTimers(inputOptions);

	// TODO:核心图表，其中细节有待深入
	const graph = new Graph(inputOptions, curWatcher);

	curWatcher = undefined as any;

	// 创建图表后，移除cache选项，因为不再使用
	// remove the cache option from the memory after graph creation (cache is not used anymore)
	const useCache = rawInputOptions.cache !== false;
	delete inputOptions.cache;
	delete rawInputOptions.cache;

	timeStart('BUILD', 1);

	let chunks: Chunk[];

	try {
		// buildStart钩子函数触发
		await graph.pluginDriver.hookParallel('buildStart', [inputOptions]);
		// TODO: 构建打包，这个需要具体分析了，这个是核心
		// 这一步通过id，深度分析拓扑关系，去除无用块，进而生成我们的chunks
		chunks = await graph.build( // 这个chunks是闭包，所以generate和write可以用到
			inputOptions.input as string | string[] | Record<string, string>,
			inputOptions.manualChunks,
			inputOptions.inlineDynamicImports!
		);
	} catch (err) {
		const watchFiles = Object.keys(graph.watchFiles);
		if (watchFiles.length > 0) {
			err.watchFiles = watchFiles;
		}
		await graph.pluginDriver.hookParallel('buildEnd', [err]);
		throw err;
	}

	// buildEnd钩子函数触发
	await graph.pluginDriver.hookParallel('buildEnd', []);

	timeEnd('BUILD', 1);

	// ensure we only do one optimization pass per build
	let optimized = false;

	function getOutputOptionsAndPluginDriver(
		rawOutputOptions: GenericConfigObject
	): { outputOptions: OutputOptions; outputPluginDriver: PluginDriver } {
		if (!rawOutputOptions) {
			throw new Error('You must supply an options object');
		}
		// 又创建了一个插件驱动器
		const outputPluginDriver = graph.pluginDriver.createOutputPluginDriver(
			// 统一化插件
			normalizePlugins(rawOutputOptions.plugins, ANONYMOUS_OUTPUT_PLUGIN_PREFIX)
		);

		// 返回标准化之后的output配置，和插件驱动器
		return {
			outputOptions: normalizeOutputOptions(
				// 入口配置
				inputOptions as GenericConfigObject,
				// 原始输出配置
				rawOutputOptions,
				// 是否有多个块
				chunks.length > 1,
				// 插件驱动器
				outputPluginDriver
			),
			// 插件驱动器
			outputPluginDriver
		};
	}

	async function generate(
		outputOptions: OutputOptions, // 输出配置
		isWrite: boolean, // 是否写入
		outputPluginDriver: PluginDriver // 输出的插件驱动器
	): Promise<OutputBundle> {
		// GENERATE阶段
		timeStart('GENERATE', 1);

		// assetFileNames定义资源路径和文件名 生成的output主文件，其他都是被依赖文件
		const assetFileNames = outputOptions.assetFileNames || 'assets/[name]-[hash][extname]';
		// getAbsoluteEntryModulePaths: 如果是绝对路径，那么添加到数组，将这个数组返回
		// commondir: 计算出这些目录的相同根目录，也就是交集
		// inputBase: 计算出这些目录的相同根目录，也就是交集
		const inputBase = commondir(getAbsoluteEntryModulePaths(chunks));

		// 打包输出。如果对象含有type: placeholders，那么就是默认的
		// outputBundleWithPlaceholders是全部chunks和assets的集合
		const outputBundleWithPlaceholders: OutputBundleWithPlaceholders = Object.create(null);

		// 如果传递了之前打包的结果，视是否命中缓存条件进行缓存，在该方法中会进行提取
		outputPluginDriver.setOutputBundle(outputBundleWithPlaceholders, assetFileNames);

		let outputBundle;

		try {
			// 执行renderStart钩子函数，该钩子主要用来获取和更改input和output配置
			await outputPluginDriver.hookParallel('renderStart', [outputOptions, inputOptions]);

			// 返回 footer banner intro outro钩子函数
			const addons = await createAddons(outputOptions, outputPluginDriver);

			for (const chunk of chunks) {
				// 尽可能少的打包模块
				// 设置chunk的exportNames
				if (!inputOptions.preserveModules) chunk.generateInternalExports(outputOptions);

				// 尽可能多的打包模块
				if (inputOptions.preserveModules || (chunk.facadeModule && chunk.facadeModule.isEntryPoint))
					// 根据导出，去推断chunk的导出模式
					chunk.exportMode = getExportMode(chunk, outputOptions, chunk.facadeModule!.id);
			}

			// ast 转换为 真实的代码
			for (const chunk of chunks) {
				chunk.preRender(outputOptions, inputBase);
			}

			// 实验性质的接口，文档未体现，优化chunk
			if (!optimized && inputOptions.experimentalOptimizeChunks) {
				optimizeChunks(chunks, outputOptions, inputOptions.chunkGroupingSize!, inputBase);
				optimized = true;
			}
			// 生成chunks的id，也就是打包出来的文件名
			assignChunkIds(
				chunks,
				inputOptions,
				outputOptions,
				inputBase,
				addons,
				outputBundleWithPlaceholders,
				outputPluginDriver
			);
			// 挂载到outputBundleWithPlaceholders上
			outputBundle = assignChunksToBundle(chunks, outputBundleWithPlaceholders);

			// 到这里了，下面应该是写入文件的操作
			// 语法树render操作
			await Promise.all(
				chunks.map(chunk => {
					// 通过id获取之前设置到outputBundleWithPlaceholders上的一些属性
					const outputChunk = outputBundleWithPlaceholders[chunk.id!] as OutputChunk;
					return chunk
						.render(outputOptions, addons, outputChunk, outputPluginDriver)
						.then(rendered => {
							// 引用类型，outputBundleWithPlaceholders上的也变化了，所以outputBundle也变化了，最后返回outputBundle
							// 在这里给outputBundle挂载上了code和map，后面直接返回 outputBundle 了
							outputChunk.code = rendered.code;
							outputChunk.map = rendered.map;

							// 调用生成的钩子函数
							return outputPluginDriver.hookParallel('ongenerate', [
								{ bundle: outputChunk, ...outputOptions },
								outputChunk
							]);
						});
				})
			);
		} catch (error) {
			await outputPluginDriver.hookParallel('renderError', [error]);
			throw error;
		}
		// generateBundle钩子函数
		await outputPluginDriver.hookSeq('generateBundle', [outputOptions, outputBundle, isWrite]);
		for (const key of Object.keys(outputBundle)) {
			const file = outputBundle[key] as any;
			if (!file.type) {
				graph.warnDeprecation(
					'A plugin is directly adding properties to the bundle object in the "generateBundle" hook. This is deprecated and will be removed in a future Rollup version, please use "this.emitFile" instead.',
					false
				);
				file.type = 'asset';
			}
		}
		outputPluginDriver.finaliseAssets();

		timeEnd('GENERATE', 1);
		return outputBundle;
	}

	const cache = useCache ? graph.getCache() : undefined;
	const result: RollupBuild = {
		cache: cache!,
		generate: ((rawOutputOptions: GenericConfigObject) => {
			// 过滤output配置选项，并创建output的插件驱动器
			const { outputOptions, outputPluginDriver } = getOutputOptionsAndPluginDriver(
				rawOutputOptions
			);
			const promise = generate(outputOptions, false, outputPluginDriver).then(result =>
				createOutput(result)
			);
			// 丢弃老版本字段
			Object.defineProperty(promise, 'code', throwAsyncGenerateError);
			Object.defineProperty(promise, 'map', throwAsyncGenerateError);
			return promise;
		}) as any,
		watchFiles: Object.keys(graph.watchFiles),
		write: ((rawOutputOptions: GenericConfigObject) => {
			const { outputOptions, outputPluginDriver } = getOutputOptionsAndPluginDriver(
				rawOutputOptions
			);
			if (!outputOptions.dir && !outputOptions.file) {
				return error({
					code: 'MISSING_OPTION',
					message: 'You must specify "output.file" or "output.dir" for the build.'
				});
			}

			// code: undefined as any, ==> 生成的代码
			// dynamicImports: chunk.getDynamicImportIds(),
			// exports: chunk.getExportNames(),
			// facadeModuleId: facadeModule && facadeModule.id,
			// fileName: chunk.id,
			// imports: chunk.getImportIds(),
			// isDynamicEntry: facadeModule !== null && facadeModule.dynamicallyImportedBy.length > 0,
			// isEntry: facadeModule !== null && facadeModule.isEntryPoint,
			// map: undefined, ==> 生成的sourcemap
			// modules: chunk.renderedModules,
			// get name() {
			// 	return chunk.getChunkName();
			// },
			// type: 'chunk'

			return generate(outputOptions, true, outputPluginDriver).then(async bundle => {
				let chunkCount = 0;
				for (const fileName of Object.keys(bundle)) {
					const file = bundle[fileName];
					if (file.type === 'asset') continue;
					chunkCount++;
					if (chunkCount > 1) break;
				}
				if (chunkCount > 1) {
					if (outputOptions.sourcemapFile)
						return error({
							code: 'INVALID_OPTION',
							message: '"output.sourcemapFile" is only supported for single-file builds.'
						});
					if (typeof outputOptions.file === 'string')
						return error({
							code: 'INVALID_OPTION',
							message:
								'When building multiple chunks, the "output.dir" option must be used, not "output.file".' +
								(typeof inputOptions.input !== 'string' ||
								inputOptions.inlineDynamicImports === true
									? ''
									: ' To inline dynamic imports, set the "inlineDynamicImports" option.')
						});
				}
				await Promise.all(
					Object.keys(bundle).map(chunkId =>
						writeOutputFile(result, bundle[chunkId], outputOptions, outputPluginDriver) // => 写入操作
					)
				);
				// 修改生成后的代码
				await outputPluginDriver.hookParallel('writeBundle', [bundle]);
				// 目前看来是供之后缓存用，提高构建速度
				return createOutput(bundle);
			});
		}) as any
	};
	if (inputOptions.perf === true) result.getTimings = getTimings;
	return result;
}

enum SortingFileType {
	ENTRY_CHUNK = 0,
	SECONDARY_CHUNK = 1,
	ASSET = 2
}

function getSortingFileType(file: OutputAsset | OutputChunk): SortingFileType {
	if (file.type === 'asset') {
		return SortingFileType.ASSET;
	}
	if (file.isEntry) {
		return SortingFileType.ENTRY_CHUNK;
	}
	return SortingFileType.SECONDARY_CHUNK;
}

function createOutput(outputBundle: Record<string, OutputChunk | OutputAsset | {}>): RollupOutput {
	return {
		output: (Object.keys(outputBundle)
			.map(fileName => outputBundle[fileName])
			.filter(outputFile => Object.keys(outputFile).length > 0) as (
			| OutputChunk
			| OutputAsset
		)[]).sort((outputFileA, outputFileB) => {
			const fileTypeA = getSortingFileType(outputFileA);
			const fileTypeB = getSortingFileType(outputFileB);
			if (fileTypeA === fileTypeB) return 0;
			return fileTypeA < fileTypeB ? -1 : 1;
		}) as [OutputChunk, ...(OutputChunk | OutputAsset)[]]
	};
}

function writeOutputFile(
	build: RollupBuild,
	outputFile: OutputAsset | OutputChunk,
	outputOptions: OutputOptions,
	outputPluginDriver: PluginDriver
): Promise<void> {
	const fileName = resolve(outputOptions.dir || dirname(outputOptions.file!), outputFile.fileName);
	let writeSourceMapPromise: Promise<void>;
	let source: string | Buffer;
	if (outputFile.type === 'asset') {
		source = outputFile.source;
	} else {
		source = outputFile.code;
		if (outputOptions.sourcemap && outputFile.map) {
			let url: string;
			if (outputOptions.sourcemap === 'inline') {
				url = outputFile.map.toUrl();
			} else {
				url = `${basename(outputFile.fileName)}.map`;
				writeSourceMapPromise = writeFile(`${fileName}.map`, outputFile.map.toString());
			}
			if (outputOptions.sourcemap !== 'hidden') {
				source += `//# ${SOURCEMAPPING_URL}=${url}\n`;
			}
		}
	}

	return writeFile(fileName, source)
		.then(() => writeSourceMapPromise)
		.then(
			(): any =>
				outputFile.type === 'chunk' &&
				outputPluginDriver.hookSeq('onwrite', [
					{
						bundle: build,
						...outputOptions
					},
					outputFile
				])
		)
		.then(() => {});
}

// 其中之一传入的参数
// 入口配置
// inputOptions,
// 原始输出配置
// rawOutputOptions,
// 是否有多个块
// chunks.length > 1,
// 插件驱动器
// outputPluginDriver

// 标准化操作
function normalizeOutputOptions(
	inputOptions: GenericConfigObject,
	rawOutputOptions: GenericConfigObject,
	hasMultipleChunks: boolean,
	outputPluginDriver: PluginDriver
): OutputOptions {
	const mergedOptions = mergeOptions({
		config: {
			output: {
				...rawOutputOptions,
				// 可以用output里的覆盖
				...(rawOutputOptions.output as object),
				// 不过input里的output优先级最高，但是不是每个地方都返回，有的不会使用
				...(inputOptions.output as object)
			}
		}
	});

	// 如果merge过程中出错了
	if (mergedOptions.optionError) throw new Error(mergedOptions.optionError);

	// now outputOptions is an array, but rollup.rollup API doesn't support arrays
	// 获取output第一项
	const mergedOutputOptions = mergedOptions.outputOptions[0];

	const outputOptionsReducer = (outputOptions: OutputOptions, result: OutputOptions) =>
		result || outputOptions;

	// 触发钩子函数
	const outputOptions = outputPluginDriver.hookReduceArg0Sync(
		'outputOptions',
		[mergedOutputOptions],
		outputOptionsReducer,
		pluginContext => {
			const emitError = () => pluginContext.error(errCannotEmitFromOptionsHook());
			return {
				...pluginContext,
				emitFile: emitError,
				setAssetSource: emitError
			};
		}
	);

	// 检查经过插件处理过的output配置
	checkOutputOptions(outputOptions);

	// output.file 和 output.dir是互斥的
	if (typeof outputOptions.file === 'string') {
		if (typeof outputOptions.dir === 'string')
			return error({
				code: 'INVALID_OPTION',
				message:
					'You must set either "output.file" for a single-file build or "output.dir" when generating multiple chunks.'
			});
		if (inputOptions.preserveModules) {
			return error({
				code: 'INVALID_OPTION',
				message:
					'You must set "output.dir" instead of "output.file" when using the "preserveModules" option.'
			});
		}
		if (typeof inputOptions.input === 'object' && !Array.isArray(inputOptions.input))
			return error({
				code: 'INVALID_OPTION',
				message: 'You must set "output.dir" instead of "output.file" when providing named inputs.'
			});
	}

	if (hasMultipleChunks) {
		if (outputOptions.format === 'umd' || outputOptions.format === 'iife')
			return error({
				code: 'INVALID_OPTION',
				message: 'UMD and IIFE output formats are not supported for code-splitting builds.'
			});
		if (typeof outputOptions.file === 'string')
			return error({
				code: 'INVALID_OPTION',
				message:
					'You must set "output.dir" instead of "output.file" when generating multiple chunks.'
			});
	}

	return outputOptions;
}
