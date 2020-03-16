import { EventEmitter } from 'events';
import { version as rollupVersion } from 'package.json';
import ExternalModule from '../ExternalModule';
import Graph from '../Graph';
import Module from '../Module';
import {
	Plugin,
	PluginCache,
	PluginContext,
	RollupWarning,
	RollupWatcher,
	SerializablePluginCache
} from '../rollup/types';
import { BuildPhase } from './buildPhase';
import { errInvalidRollupPhaseForAddWatchFile } from './error';
import { FileEmitter } from './FileEmitter';
import { createPluginCache, getCacheForUncacheablePlugin, NO_CACHE } from './PluginCache';
import {
	ANONYMOUS_OUTPUT_PLUGIN_PREFIX,
	ANONYMOUS_PLUGIN_PREFIX,
	throwPluginError
} from './pluginUtils';

function getDeprecatedContextHandler<H extends Function>(
	handler: H,
	handlerName: string,
	newHandlerName: string,
	pluginName: string,
	activeDeprecation: boolean,
	graph: Graph
): H {
	let deprecationWarningShown = false;
	return (((...args: any[]) => {
		if (!deprecationWarningShown) {
			deprecationWarningShown = true;
			graph.warnDeprecation(
				{
					message: `The "this.${handlerName}" plugin context function used by plugin ${pluginName} is deprecated. The "this.${newHandlerName}" plugin context function should be used instead.`,
					plugin: pluginName
				},
				activeDeprecation
			);
		}
		return handler(...args);
	}) as unknown) as H;
}

export function getPluginContexts(
	pluginCache: Record<string, SerializablePluginCache> | void,
	graph: Graph,
	fileEmitter: FileEmitter,
	watcher: RollupWatcher | undefined
): (plugin: Plugin, pluginIndex: number) => PluginContext {
	const existingPluginNames = new Set<string>();
	// 闭包函数
	return (plugin, pidx) => {
		// 判断当前plugin是否缓存
		let cacheable = true; // 如果不在existingPluginNames中，那么依然为true: 可缓存
		// 刚开始是没有cacheKey的，除了第一次只有携带cache的再次进入的时候设置为上一次的cacheKey或者当前插件名
		if (typeof plugin.cacheKey !== 'string') {
			if (
				// 处理rollup格式化的插件名的情况
				// 不可缓存的情况
				plugin.name.startsWith(ANONYMOUS_PLUGIN_PREFIX) ||
				plugin.name.startsWith(ANONYMOUS_OUTPUT_PLUGIN_PREFIX) ||
				existingPluginNames.has(plugin.name) // 是否已存在该插件
			) {
				cacheable = false;
			} else {
				existingPluginNames.add(plugin.name);
			}
		}

		// 设置缓存实例 cacheInstance
		let cacheInstance: PluginCache;
		if (!pluginCache) {
			cacheInstance = NO_CACHE;
		} else if (cacheable) {
			const cacheKey = plugin.cacheKey || plugin.name;
			cacheInstance = createPluginCache(
				// 在这设置的呀，第一次设置为空对象，之后就可以set了
				pluginCache[cacheKey] || (pluginCache[cacheKey] = Object.create(null)) // 如果在缓存中，否则为{}
			);
		} else {
			cacheInstance = getCacheForUncacheablePlugin(plugin.name);
		}

		// 返回上下文环境
		// 调用插件的时候会将这个上下文注入到this => someHook.call(context, ...);
		const context: PluginContext = {
			addWatchFile(id) {
				if (graph.phase >= BuildPhase.GENERATE) {
					return this.error(errInvalidRollupPhaseForAddWatchFile());
				}
				graph.watchFiles[id] = true;
			},
			// 缓存实例
			cache: cacheInstance,
			emitAsset: getDeprecatedContextHandler(
				(name: string, source?: string | Buffer) =>
					fileEmitter.emitFile({ type: 'asset', name, source }),
				'emitAsset',
				'emitFile',
				plugin.name,
				false,
				graph
			),
			emitChunk: getDeprecatedContextHandler(
				(id: string, options?: { name?: string }) =>
					fileEmitter.emitFile({ type: 'chunk', id, name: options && options.name }),
				'emitChunk',
				'emitFile',
				plugin.name,
				false,
				graph
			),
			emitFile: fileEmitter.emitFile,
			error(err): never {
				return throwPluginError(err, plugin.name);
			},
			getAssetFileName: getDeprecatedContextHandler(
				fileEmitter.getFileName,
				'getAssetFileName',
				'getFileName',
				plugin.name,
				false,
				graph
			),
			getChunkFileName: getDeprecatedContextHandler(
				fileEmitter.getFileName,
				'getChunkFileName',
				'getFileName',
				plugin.name,
				false,
				graph
			),
			getFileName: fileEmitter.getFileName,
			getModuleInfo(moduleId) {
				const foundModule = graph.moduleById.get(moduleId);
				if (foundModule == null) {
					throw new Error(`Unable to find module ${moduleId}`);
				}

				return {
					hasModuleSideEffects: foundModule.moduleSideEffects,
					id: foundModule.id,
					importedIds:
						foundModule instanceof ExternalModule
							? []
							: Array.from(foundModule.sources).map(id => foundModule.resolvedIds[id].id),
					isEntry: foundModule instanceof Module && foundModule.isEntryPoint,
					isExternal: foundModule instanceof ExternalModule
				};
			},
			isExternal: getDeprecatedContextHandler(
				(id: string, parentId: string, isResolved = false) =>
					graph.moduleLoader.isExternal(id, parentId, isResolved),
				'isExternal',
				'resolve',
				plugin.name,
				false,
				graph
			),
			meta: {
				rollupVersion
			},
			get moduleIds() {
				return graph.moduleById.keys();
			},
			parse: graph.contextParse,
			resolve(source, importer, options?: { skipSelf: boolean }) {
				return graph.moduleLoader.resolveId(
					source,
					importer,
					options && options.skipSelf ? pidx : null
				);
			},
			resolveId: getDeprecatedContextHandler(
				(source: string, importer: string) =>
					graph.moduleLoader
						.resolveId(source, importer)
						.then(resolveId => resolveId && resolveId.id),
				'resolveId',
				'resolve',
				plugin.name,
				false,
				graph
			),
			setAssetSource: fileEmitter.setAssetSource,
			warn(warning) {
				if (typeof warning === 'string') warning = { message: warning } as RollupWarning;
				if (warning.code) warning.pluginCode = warning.code;
				warning.code = 'PLUGIN_WARNING';
				warning.plugin = plugin.name;
				graph.warn(warning);
			},
			watcher: watcher
				? (() => {
						let deprecationWarningShown = false;

						function deprecatedWatchListener(event: string, handler: () => void): EventEmitter {
							if (!deprecationWarningShown) {
								context.warn({
									code: 'PLUGIN_WATCHER_DEPRECATED',
									message: `this.watcher usage is deprecated in plugins. Use the watchChange plugin hook and this.addWatchFile() instead.`
								});
								deprecationWarningShown = true;
							}
							return watcher!.on(event as any, handler);
						}

						return {
							...(watcher as EventEmitter),
							addListener: deprecatedWatchListener,
							on: deprecatedWatchListener
						};
				  })()
				: (undefined as any)
		};
		return context;
	};
}
