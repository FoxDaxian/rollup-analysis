import MagicString, { SourceMap } from 'magic-string';
import Graph from '../Graph';
import Module from '../Module';
import {
	DecodedSourceMapOrMissing,
	EmittedFile,
	Plugin,
	PluginCache,
	PluginContext,
	RollupError,
	RollupWarning,
	TransformModuleJSON,
	TransformResult,
	TransformSourceDescription
} from '../rollup/types';
import { collapseSourcemap } from './collapseSourcemaps';
import { decodedSourcemap } from './decodedSourcemap';
import { augmentCodeLocation } from './error';
import { dirname, resolve } from './path';
import { getTrackedPluginCache } from './PluginCache';
import { throwPluginError } from './pluginUtils';

// 专门用来转化的函数
export default function transform(
	graph: Graph,
	source: TransformSourceDescription, // 对象格式的模块信息
	module: Module
): Promise<TransformModuleJSON> {
	const id = module.id;
	const sourcemapChain: DecodedSourceMapOrMissing[] = [];

	// sourcemap相关操作，单独的一块，暂时不用管
	let originalSourcemap = source.map === null ? null : decodedSourcemap(source.map);
	// 获取文件内容，不管是真实的文件内容还是经过插件处理的
	const originalCode = source.code;
	// TODO: 从逻辑上来看目前还未发现ast是哪里设置的
	// 猜想1：是插件返回的ast，但是也可能没有ast
	let ast = source.ast;

	const transformDependencies: string[] = [];
	const emittedFiles: EmittedFile[] = [];
	let customTransformCache = false;
	let moduleSideEffects: boolean | null = null;
	let syntheticNamedExports: boolean | null = null;
	let trackedPluginCache: { cache: PluginCache; used: boolean };
	let curPlugin: Plugin;
	// 赋值文件内容
	const curSource: string = source.code;

	function transformReducer(
		this: PluginContext,
		code: string,
		result: TransformResult,
		plugin: Plugin
	) {
		// 首先处理模块的相关依赖！！

		// track which plugins use the custom this.cache to opt-out of transform caching
		if (!customTransformCache && trackedPluginCache.used) customTransformCache = true;
		if (customTransformCache) {
			// TODO:不知道是从哪里来的依赖，感觉是内部处理的，看命名应该是后续处理之后的结果被缓存了，然后这次直接取的缓存，所以才有dependencies
			if (result && typeof result === 'object' && Array.isArray(result.dependencies)) {
				for (const dep of result.dependencies) {
					// 监听这些依赖文件
					graph.watchFiles[resolve(dirname(id), dep)] = true;
				}
			}
		} else {
			// files emitted by a transform hook need to be emitted again if the hook is skipped
			if (emittedFiles.length) module.transformFiles = emittedFiles;
			if (result && typeof result === 'object' && Array.isArray(result.dependencies)) {
				// not great, but a useful way to track this without assuming WeakMap
				// 当用户依然使用transform钩子函数，返回带有依赖的对象的时候，提醒且仅提示一次
				if (!(curPlugin as any).warnedTransformDependencies)
					graph.warnDeprecation(
						`Returning "dependencies" from the "transform" hook as done by plugin ${plugin.name} is deprecated. The "this.addWatchFile" plugin context function should be used instead.`,
						true
					);
				(curPlugin as any).warnedTransformDependencies = true;
				for (const dep of result.dependencies)
					// 这个是当前模块的依赖，addWatchFile方法也是类似的操作
					transformDependencies.push(resolve(dirname(id), dep));
			}
		}

		// 参数格式处理
		if (typeof result === 'string') {
			result = {
				ast: undefined,
				code: result,
				map: undefined
			};
		} else if (result && typeof result === 'object') {
			if (typeof result.map === 'string') {
				result.map = JSON.parse(result.map);
			}
			if (typeof result.moduleSideEffects === 'boolean') {
				moduleSideEffects = result.moduleSideEffects;
			}
			if (typeof result.syntheticNamedExports === 'boolean') {
				syntheticNamedExports = result.syntheticNamedExports;
			}
		} else {
			return code;
		}

		// strict null check allows 'null' maps to not be pushed to the chain, while 'undefined' gets the missing map warning
		// map可以为null之外的任意值
		if (result.map !== null) {
			const map = decodedSourcemap(result.map);
			sourcemapChain.push(map || { missing: true, plugin: plugin.name });
		}

		// 这里覆盖了原本的ast，采用插件处理过的ast
		ast = result.ast;

		return result.code;
	}

	let setAssetSourceErr: any;

	// 传入调用的钩子函数名，参数，xx，替换的插件上下文
	return graph.pluginDriver
		.hookReduceArg0<any, string>(
			'transform',
			[curSource, id], // source.code 和 模块id
			transformReducer,
			(pluginContext, plugin) => {
				// 这一大堆是插件利用的，通过this.xxx调用
				curPlugin = plugin;
				if (curPlugin.cacheKey) customTransformCache = true;
				else trackedPluginCache = getTrackedPluginCache(pluginContext.cache);
				return {
					...pluginContext,
					cache: trackedPluginCache ? trackedPluginCache.cache : pluginContext.cache,
					warn(warning: RollupWarning | string, pos?: number | { column: number; line: number }) {
						if (typeof warning === 'string') warning = { message: warning } as RollupWarning;
						if (pos) augmentCodeLocation(warning, pos, curSource, id);
						warning.id = id;
						warning.hook = 'transform';
						pluginContext.warn(warning);
					},
					error(err: RollupError | string, pos?: number | { column: number; line: number }): never {
						if (typeof err === 'string') err = { message: err };
						if (pos) augmentCodeLocation(err, pos, curSource, id);
						err.id = id;
						err.hook = 'transform';
						return pluginContext.error(err);
					},
					emitAsset(name: string, source?: string | Buffer) {
						const emittedFile = { type: 'asset' as const, name, source };
						emittedFiles.push({ ...emittedFile });
						return graph.pluginDriver.emitFile(emittedFile);
					},
					emitChunk(id, options) {
						const emittedFile = { type: 'chunk' as const, id, name: options && options.name };
						emittedFiles.push({ ...emittedFile });
						return graph.pluginDriver.emitFile(emittedFile);
					},
					emitFile(emittedFile: EmittedFile) {
						emittedFiles.push(emittedFile);
						return graph.pluginDriver.emitFile(emittedFile);
					},
					addWatchFile(id: string) {
						transformDependencies.push(id);
						pluginContext.addWatchFile(id);
					},
					setAssetSource(assetReferenceId, source) {
						pluginContext.setAssetSource(assetReferenceId, source);
						if (!customTransformCache && !setAssetSourceErr) {
							try {
								return this.error({
									code: 'INVALID_SETASSETSOURCE',
									message: `setAssetSource cannot be called in transform for caching reasons. Use emitFile with a source, or call setAssetSource in another hook.`
								});
							} catch (err) {
								setAssetSourceErr = err;
							}
						}
					},
					getCombinedSourcemap() {
						const combinedMap = collapseSourcemap(
							graph,
							id,
							originalCode,
							originalSourcemap,
							sourcemapChain
						);
						if (!combinedMap) {
							const magicString = new MagicString(originalCode);
							return magicString.generateMap({ includeContent: true, hires: true, source: id });
						}
						if (originalSourcemap !== combinedMap) {
							originalSourcemap = combinedMap;
							sourcemapChain.length = 0;
						}
						return new SourceMap({
							...combinedMap,
							file: null as any,
							sourcesContent: combinedMap.sourcesContent!
						});
					}
				};
			}
		)
		.catch(err => throwPluginError(err, curPlugin.name, { hook: 'transform', id }))
		.then(code => {
			if (!customTransformCache && setAssetSourceErr) throw setAssetSourceErr;

			return {
				ast: ast!,
				code,
				customTransformCache,
				moduleSideEffects,
				originalCode,
				originalSourcemap,
				sourcemapChain,
				syntheticNamedExports,
				transformDependencies
			};
		});
}
