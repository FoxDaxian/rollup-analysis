import * as acorn from 'acorn';
import injectExportNsFrom from 'acorn-export-ns-from';
import injectImportMeta from 'acorn-import-meta';
import * as ESTree from 'estree';
import GlobalScope from './ast/scopes/GlobalScope';
import { PathTracker } from './ast/utils/PathTracker';
import Chunk, { isChunkRendered } from './Chunk';
import ExternalModule from './ExternalModule';
import Module, { defaultAcornOptions } from './Module';
import { ModuleLoader, UnresolvedModule } from './ModuleLoader';
import {
	GetManualChunk,
	InputOptions,
	ManualChunksOption,
	ModuleJSON,
	RollupCache,
	RollupWarning,
	RollupWatcher,
	SerializablePluginCache,
	TreeshakingOptions,
	WarningHandler
} from './rollup/types';
import { BuildPhase } from './utils/buildPhase';
import { assignChunkColouringHashes } from './utils/chunkColouring';
import { Uint8ArrayToHexString } from './utils/entryHashing';
import { errDeprecation, error } from './utils/error';
import { analyseModuleExecution, sortByExecutionOrder } from './utils/executionOrder';
import { resolve } from './utils/path';
import { PluginDriver } from './utils/PluginDriver';
import relativeId from './utils/relativeId';
import { timeEnd, timeStart } from './utils/timers';

function makeOnwarn() {
	const warned = Object.create(null);

	return (warning: any) => {
		const str = warning.toString();
		if (str in warned) return;
		console.error(str);
		warned[str] = true;
	};
}

function normalizeEntryModules(
	entryModules: string | string[] | Record<string, string>
): UnresolvedModule[] {
	// rollup用文件(相对或绝对)路径为id
	// 以key为name
	// 当前函数没有定义fileName，fileName和另外两个参数的区别在哪？
	if (typeof entryModules === 'string') {
		return [{ fileName: null, name: null, id: entryModules }];
	}
	if (Array.isArray(entryModules)) {
		return entryModules.map(id => ({ fileName: null, name: null, id }));
	}
	return Object.keys(entryModules).map(name => ({
		fileName: null,
		id: entryModules[name],
		name
	}));
}

export default class Graph {
	acornOptions: acorn.Options;
	acornParser: typeof acorn.Parser;
	cachedModules: Map<string, ModuleJSON>;
	contextParse: (code: string, acornOptions?: acorn.Options) => ESTree.Program;
	deoptimizationTracker: PathTracker;
	getModuleContext: (id: string) => string;
	moduleById = new Map<string, Module | ExternalModule>();
	moduleLoader: ModuleLoader;
	needsTreeshakingPass = false;
	phase: BuildPhase = BuildPhase.LOAD_AND_PARSE;
	pluginDriver: PluginDriver;
	preserveModules: boolean;
	scope: GlobalScope;
	shimMissingExports: boolean;
	treeshakingOptions?: TreeshakingOptions;
	watchFiles: Record<string, true> = Object.create(null);

	private cacheExpiry: number;
	private context: string;
	private externalModules: ExternalModule[] = [];
	private modules: Module[] = [];
	private onwarn: WarningHandler;
	private pluginCache?: Record<string, SerializablePluginCache>;
	private strictDeprecations: boolean;

	constructor(options: InputOptions, watcher?: RollupWatcher) {
		// 警告函数
		this.onwarn = (options.onwarn as WarningHandler) || makeOnwarn();
		// (依赖)路径追踪
		// 是一个由path组成的set对象，每多一个路径，层级就深一层
		this.deoptimizationTracker = new PathTracker();
		// 创建map
		this.cachedModules = new Map();
		// 缓存相关，用于提升监听模式下的构建速度
		// https://rollupjs.org/guide/en/#advanced-functionality
		if (options.cache) {
			if (options.cache.modules)
				for (const module of options.cache.modules) this.cachedModules.set(module.id, module);
		}

		// 缓存插件结果
		if (options.cache !== false) {
			this.pluginCache = (options.cache && options.cache.plugins) || Object.create(null);

			// TODO: 这块的plugin cache是什么格式的？虽然看ts类型定义能明白，但是还是想眼见为实
			// 增加插件访问的次数
			// increment access counter
			for (const name in this.pluginCache) {
				const cache = this.pluginCache[name];
				for (const key of Object.keys(cache)) cache[key][0]++;
			}
		}

		this.preserveModules = options.preserveModules!;
		// 启动后，若再使用弃用的属性将会抛出错误，而不是警告
		this.strictDeprecations = options.strictDeprecations!;

		this.cacheExpiry = options.experimentalCacheExpiry!;

		// treeShaking相关配置，详见文档
		if (options.treeshake !== false) {
			this.treeshakingOptions =
				options.treeshake && options.treeshake !== true
					? {
							annotations: options.treeshake.annotations !== false,
							moduleSideEffects: options.treeshake.moduleSideEffects,
							propertyReadSideEffects: options.treeshake.propertyReadSideEffects !== false,
							pureExternalModules: options.treeshake.pureExternalModules,
							tryCatchDeoptimization: options.treeshake.tryCatchDeoptimization !== false,
							unknownGlobalSideEffects: options.treeshake.unknownGlobalSideEffects !== false
					  }
					: {
							annotations: true,
							moduleSideEffects: true,
							propertyReadSideEffects: true,
							tryCatchDeoptimization: true,
							unknownGlobalSideEffects: true
					  };
			if (typeof this.treeshakingOptions.pureExternalModules !== 'undefined') {
				this.warnDeprecation(
					`The "treeshake.pureExternalModules" option is deprecated. The "treeshake.moduleSideEffects" option should be used instead. "treeshake.pureExternalModules: true" is equivalent to "treeshake.moduleSideEffects: 'no-external'"`,
					false
				);
			}
		}

		// 使用acorn进行代码解析，acorn是一个纯js实现的js解析器
		// https://github.com/acornjs/acorn
		this.contextParse = (code: string, options: acorn.Options = {}) =>
			this.acornParser.parse(code, {
				...defaultAcornOptions,
				...options,
				...this.acornOptions
			}) as any;

		// 就是插件驱动器，包括注入文件操作方法，插件环境上下文等操作
		this.pluginDriver = new PluginDriver(
			this,
			options.plugins!,
			this.pluginCache,
			// 处理软连文件的时候，是否以为软连所在地址作为上下文，false为是，true为不是。
			options.preserveSymlinks === true,
			watcher
		);

		// 如果传递了设置了watch，那么对改变进行监听
		// watcher好像是rollup.watcher的时候才会进入
		if (watcher) {
			const handleChange = (id: string) => this.pluginDriver.hookSeqSync('watchChange', [id]);
			watcher.on('change', handleChange);
			watcher.once('restart', () => {
				watcher.removeListener('change', handleChange);
			});
		}

		this.shimMissingExports = options.shimMissingExports as boolean;

		// TODO：一个操作Map的类，具体干啥的？
		this.scope = new GlobalScope();
		this.context = String(options.context);

		// 用户是否自定义了上下文环境
		const optionsModuleContext = options.moduleContext;
		if (typeof optionsModuleContext === 'function') {
			this.getModuleContext = id => optionsModuleContext(id) || this.context;
		} else if (typeof optionsModuleContext === 'object') {
			const moduleContext = new Map();
			for (const key in optionsModuleContext) {
				moduleContext.set(resolve(key), optionsModuleContext[key]);
			}
			this.getModuleContext = id => moduleContext.get(id) || this.context;
		} else {
			this.getModuleContext = () => this.context;
		}

		// 传递acorn提供的参数
		this.acornOptions = options.acorn ? { ...options.acorn } : {};
		const acornPluginsToInject = [];

		// injectImportMeta: 支持 import.meta， 用于 script标签 type 为module的情况
		// injectExportNsFrom: 支持 export * as xxx语句
		acornPluginsToInject.push(injectImportMeta, injectExportNsFrom);

		(this.acornOptions as any).allowAwaitOutsideFunction = true;

		const acornInjectPlugins = options.acornInjectPlugins;
		acornPluginsToInject.push(
			...(Array.isArray(acornInjectPlugins)
				? acornInjectPlugins
				: acornInjectPlugins
				? [acornInjectPlugins]
				: [])
		);
		// 设置acorn插件
		this.acornParser = acorn.Parser.extend(...acornPluginsToInject);

		// TODO：初始化moduleLoader实例，这又是干嘛的？
		this.moduleLoader = new ModuleLoader(
			this,
			this.moduleById,
			this.pluginDriver,
			options.external!,
			(typeof options.manualChunks === 'function' && options.manualChunks) as GetManualChunk | null,
			(this.treeshakingOptions ? this.treeshakingOptions.moduleSideEffects : null)!,
			(this.treeshakingOptions ? this.treeshakingOptions.pureExternalModules : false)!
		);
	}

	build(
		entryModules: string | string[] | Record<string, string>,
		manualChunks: ManualChunksOption | void,
		inlineDynamicImports: boolean
	): Promise<Chunk[]> {
		// Phase 1 – discovery. We load the entry module and find which
		// modules it imports, and import those, until we have all
		// of the entry module's dependencies

		timeStart('parse modules', 2);

		// normalizeEntryModules返回同一个格式:
		// fileName: string | null; => 目前未知
    // id: string; => 路径
    // name: string | null; => 用户定义的key
		return Promise.all([
			// 会返回这样一个对象
			// {
			// 	entryModules: this.indexedEntryModules.map(({ module }) => module),
			// 	manualChunkModulesByAlias: this.manualChunkModules,
			// 	newEntryModules
			// }
			this.moduleLoader.addEntryModules(normalizeEntryModules(entryModules), true),
			// 下面的将chunk自定义转换成函数
			(manualChunks &&
				typeof manualChunks === 'object' &&
				this.moduleLoader.addManualChunks(manualChunks)) as Promise<void>
		]).then(([{ entryModules, manualChunkModulesByAlias }]) => {
			// entryModules为经过一系列转换后的rollup入口模块

			// 不能不指定入口
			if (entryModules.length === 0) {
				throw new Error('You must supply options.input to rollup');
			}
			for (const module of this.moduleById.values()) {
				// moduleById是 id => module 的存储

				// 获取所有Module，根据类型添加到不同的容器中
				if (module instanceof Module) {
					this.modules.push(module);
				} else {
					this.externalModules.push(module);
				}
			}
			timeEnd('parse modules', 2);

			// 进入第二阶段：分析，第一阶段为加载和解析
			this.phase = BuildPhase.ANALYSE;

			// Phase 2 - linking. We populate the module dependency links and
			// determine the topological execution order for the bundle
			timeStart('analyse dependency graph', 2);

			// 从这里开始看=========
			// entryModules 入口的rollup模块
			this.link(entryModules);

			timeEnd('analyse dependency graph', 2);

			// Phase 3 – marking. We include all statements that should be included
			timeStart('mark included statements', 2);

			// 动态导入内联化 只能有一个入口
			if (inlineDynamicImports) {
				if (entryModules.length > 1) {
					throw new Error(
						'Internal Error: can only inline dynamic imports for single-file builds.'
					);
				}
			}
			for (const module of entryModules) {
				// 包括所有入口？
				module.includeAllExports();
			}
			this.includeMarked(this.modules);

			// check for unused external imports
			for (const externalModule of this.externalModules) externalModule.warnUnusedImports();

			timeEnd('mark included statements', 2);

			// Phase 4 – we construct the chunks, working out the optimal chunking using
			// entry point graph colouring, before generating the import and export facades
			timeStart('generate chunks', 2);

			if (!this.preserveModules && !inlineDynamicImports) {
				assignChunkColouringHashes(entryModules, manualChunkModulesByAlias);
			}

			// TODO: there is one special edge case unhandled here and that is that any module
			//       exposed as an unresolvable export * (to a graph external export *,
			//       either as a namespace import reexported or top-level export *)
			//       should be made to be its own entry point module before chunking
			let chunks: Chunk[] = [];
			if (this.preserveModules) {
				for (const module of this.modules) {
					const chunk = new Chunk(this, [module]);
					if (module.isEntryPoint || !chunk.isEmpty) {
						chunk.entryModules = [module];
					}
					chunks.push(chunk);
				}
			} else {
				const chunkModules: { [entryHashSum: string]: Module[] } = {};
				for (const module of this.modules) {
					const entryPointsHashStr = Uint8ArrayToHexString(module.entryPointsHash);
					const curChunk = chunkModules[entryPointsHashStr];
					if (curChunk) {
						curChunk.push(module);
					} else {
						chunkModules[entryPointsHashStr] = [module];
					}
				}

				for (const entryHashSum in chunkModules) {
					const chunkModulesOrdered = chunkModules[entryHashSum];
					sortByExecutionOrder(chunkModulesOrdered);
					const chunk = new Chunk(this, chunkModulesOrdered);
					chunks.push(chunk);
				}
			}

			for (const chunk of chunks) {
				chunk.link();
			}
			chunks = chunks.filter(isChunkRendered);
			const facades: Chunk[] = [];
			for (const chunk of chunks) {
				facades.push(...chunk.generateFacades());
			}

			timeEnd('generate chunks', 2);

			this.phase = BuildPhase.GENERATE;
			return chunks.concat(facades);
		});
	}

	getCache(): RollupCache {
		// handle plugin cache eviction
		for (const name in this.pluginCache) {
			const cache = this.pluginCache[name];
			let allDeleted = true;
			for (const key of Object.keys(cache)) {
				if (cache[key][0] >= this.cacheExpiry) delete cache[key];
				else allDeleted = false;
			}
			if (allDeleted) delete this.pluginCache[name];
		}

		return {
			modules: this.modules.map(module => module.toJSON()),
			plugins: this.pluginCache
		};
	}

	includeMarked(modules: Module[]) {
		if (this.treeshakingOptions) {
			let treeshakingPass = 1;
			do {
				timeStart(`treeshaking pass ${treeshakingPass}`, 3);
				this.needsTreeshakingPass = false;
				for (const module of modules) {
					if (module.isExecuted) module.include();
				}
				timeEnd(`treeshaking pass ${treeshakingPass++}`, 3);
			} while (this.needsTreeshakingPass);
		} else {
			// Necessary to properly replace namespace imports
			for (const module of modules) module.includeAllInBundle();
		}
	}

	warn(warning: RollupWarning) {
		warning.toString = () => {
			let str = '';

			if (warning.plugin) str += `(${warning.plugin} plugin) `;
			if (warning.loc)
				str += `${relativeId(warning.loc.file!)} (${warning.loc.line}:${warning.loc.column}) `;
			str += warning.message;

			return str;
		};

		this.onwarn(warning);
	}

	warnDeprecation(deprecation: string | RollupWarning, activeDeprecation: boolean): void {
		if (activeDeprecation || this.strictDeprecations) {
			const warning = errDeprecation(deprecation);
			if (this.strictDeprecations) {
				return error(warning);
			}
			this.warn(warning);
		}
	}

	private link(entryModules: Module[]) {
		for (const module of this.modules) {
			// 找到依赖？
			module.linkDependencies();
		}
		// 入口模块依赖解析
		const { orderedModules, cyclePaths } = analyseModuleExecution(entryModules);
		for (const cyclePath of cyclePaths) {
			this.warn({
				code: 'CIRCULAR_DEPENDENCY',
				cycle: cyclePath,
				importer: cyclePath[0],
				message: `Circular dependency: ${cyclePath.join(' -> ')}`
			});
		}
		this.modules = orderedModules;
		for (const module of this.modules) {
			// 这个是干啥的？
			module.bindReferences();
		}
		this.warnForMissingExports();
	}

	private warnForMissingExports() {
		for (const module of this.modules) {
			for (const importName of Object.keys(module.importDescriptions)) {
				const importDescription = module.importDescriptions[importName];
				if (
					importDescription.name !== '*' &&
					!(importDescription.module as Module).getVariableForExportName(importDescription.name)
				) {
					module.warn(
						{
							code: 'NON_EXISTENT_EXPORT',
							message: `Non-existent export '${
								importDescription.name
							}' is imported from ${relativeId((importDescription.module as Module).id)}`,
							name: importDescription.name,
							source: (importDescription.module as Module).id
						},
						importDescription.start
					);
				}
			}
		}
	}
}
