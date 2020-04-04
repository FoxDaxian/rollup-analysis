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
		// ast node的栈，保存内容的？
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
			// 第一次执行的时候，cache肯定为null或者空，所以默认为无原型链的空对象
			this.pluginCache = (options.cache && options.cache.plugins) || Object.create(null);

			// https://rollupjs.org/guide/en/#experimentalcacheexpiry
			// 每次执行rollup.rollup的时候，给传递的缓存插件的插件们的执行次数 加1，后续如果执行超过 experimentalCacheExpiry 设定的次数后，不在缓存
			// increment access counter
			for (const name in this.pluginCache) {
				// cache为插件返回的对象的属性们 TODO: 到这了
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
		// watcher是emitter对象，订阅了change和restart事件，当watcher那边触发的时候，重新绑定钩子函数
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
		// 可设置模块的上下文，默认是undefined，可以设置成window等等
		// 用来设置模块全局上下文(this)的
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

		// input option传递给acorn的参数
		this.acornOptions = options.acorn ? { ...options.acorn } : {};
		// acorn的插件
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
		// https://github.com/acornjs/acorn#plugin-developments  扩展acorn
		// 初始化acorn解析器
		this.acornParser = acorn.Parser.extend(...acornPluginsToInject);

		// 模块(文件)解析加载，内部调用的resolveID和load等钩子，让使用者有更多的自定义控件
		this.moduleLoader = new ModuleLoader(
			this,
			this.moduleById, // 这里是moduleById，到类中就变成了modulesById
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
			// addEntryModules中底层会调用fetchModule，会挂载各种相关数据，并且通过acorn解析ast tree
			// ！！！解析后的ast tree 会从program开始，依次循环遍历，不同的类型实例化出不同的节点，在通过initial方法进行相关ast node type的关键数据挂载，这样就是一个标准的具有文件上下文信息的一个module！！！
			this.moduleLoader.addEntryModules(normalizeEntryModules(entryModules), true),
			// TODO:下面的将chunk自定义转换成函数，并没有在then中读取回调，这块晚点再确认一下
			(manualChunks &&
				typeof manualChunks === 'object' &&
				this.moduleLoader.addManualChunks(manualChunks)) as Promise<void>
				// 注意，下面的参数只和Promise.all的第一个参数相关，和第二个参数无关
		]).then(([{ entryModules, manualChunkModulesByAlias }]) => { // 注意，参数为数组，是一个整体，都是第一个promise的返回，不包括manualChunks的返回！！！

			// manualChunkModulesByAlias => manualChunkModules
			// 里面是这种样子的:
			// {
			// 	[alias key]: module[]
			// }

			// entryModules 是入口模块，this.moduleById 包含所有模块了，比如externalModules
			// 参数的解析: entryModules是包含index的模块对象({module, index})里的module

			// entryModules为经过一系列转换后的rollup入口模块
			// 不能不指定入口
			if (entryModules.length === 0) {
				throw new Error('You must supply options.input to rollup');
			}
			// moduleById是 id => module 的存储， 是所有合法的入口模块
			for (const module of this.moduleById.values()) {
				// 获取所有Module，根据类型添加到不同的容器中
				if (module instanceof Module) {
					this.modules.push(module);
				} else {
					this.externalModules.push(module);
				}
			}
			timeEnd('parse modules', 2);

			// 进入第二阶段：分析，第一阶段为加载、解析和挂载
			this.phase = BuildPhase.ANALYSE;

			// Phase 2 - linking. We populate the module dependency links and
			// determine the topological execution order for the bundle
			timeStart('analyse dependency graph', 2);

			// entryModules => module 入口的rollup模块
			// 找到个依赖的正确的、有效的拓扑关系
			// 获取所有入口，找到入口的依赖，删除无效的依赖，过滤出真正的入口启动rolluop模块
			this.link(entryModules);

			// 依赖拓扑关系分析完成!!!
			timeEnd('analyse dependency graph', 2);

			// 标记所有的引入语法
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
			// 处理export语句的，暂时不看
			for (const module of entryModules) {
				module.includeAllExports();
			}

			// 获取完module后，给引入的模块做标记
			// TODO: 找个例子实验一波
			this.includeMarked(this.modules);

			// 被include的都已经做好标记了，接下来生成chunks

			// 检查所有没使用的模块，进行提示警告，但没有删除
			// check for unused external imports
			for (const externalModule of this.externalModules) externalModule.warnUnusedImports();

			timeEnd('mark included statements', 2);

			// 终于快到最后一步，满脸的心酸，这还仅仅是rollup.rollup方法，不包括生成和写入、、、
			// 构建块，但是在生成导入和导出之前，使用入口点图着色优化块

			// Phase 4 – we construct the chunks, working out the optimal chunking using
			// entry point graph colouring, before generating the import and export facades
			timeStart('generate chunks', 2);

			// preserveModules用(为每个模块创建一个chunk)代替根据关系创建尽可能少的模块，默认为false，不开启
			// inlineDynamicImports将动态导入的模块内敛到一个模块中，默认为false，不开启
			// 如果都是取的默认值的话，进入判断
			if (!this.preserveModules && !inlineDynamicImports) {
				// 获取到了manualchunkmodule，即用户指定的模块组，然后通过生成唯一的hash值，并且迭代module，获取其依赖，给依赖们都添加上和这个唯一的hash，之后可以通过这个唯一的标志，将所有的相关模块都打到一个包里。
				// 那么，如果重复了呢？这块猜测是做了去重。还需要看后面的代码确认
				assignChunkColouringHashes(entryModules, manualChunkModulesByAlias);
			}

			// TODO: there is one special edge case unhandled here and that is that any module
			//       exposed as an unresolvable export * (to a graph external export *,
			//       either as a namespace import reexported or top-level export *)
			//       should be made to be its own entry point module before chunking

			// 到这里了，明天继续分析
			let chunks: Chunk[] = [];

			// 为每个模块都创建chunk
			if (this.preserveModules) {
				// 遍历入口模块
				for (const module of this.modules) {
					// 新建chunk实例对象
					const chunk = new Chunk(this, [module]);
					// 是入口模块，并且非空
					if (module.isEntryPoint || !chunk.isEmpty) {
						chunk.entryModules = [module];
					}
					chunks.push(chunk);
				}
			} else {
				// 创建尽可能少的chunk
				const chunkModules: { [entryHashSum: string]: Module[] } = {};
				for (const module of this.modules) {
					// 将之前设置的hash值转换为string
					const entryPointsHashStr = Uint8ArrayToHexString(module.entryPointsHash);
					const curChunk = chunkModules[entryPointsHashStr];
					// 有的话，添加module，没有的话创建并添加，相同的hash值会添加到一起
					if (curChunk) {
						// 同一类型的添加到一起
						curChunk.push(module);
					} else {
						// 数组
						chunkModules[entryPointsHashStr] = [module];
					}
				}

				// 将同一hash值的chunks们排序后，添加到chunks中
				for (const entryHashSum in chunkModules) {
					const chunkModulesOrdered = chunkModules[entryHashSum];
					// 根据之前的设定的index排序，这个应该代表引入的顺序，或者执行的先后顺序
					sortByExecutionOrder(chunkModulesOrdered);
					// 用排序后的chunkModulesOrdered新建chunk
					const chunk = new Chunk(this, chunkModulesOrdered);
					chunks.push(chunk);
				}
			}

			// 这里要看下 import 和 export 部分
			// 真的开始处理各个chunk了啊
			for (const chunk of chunks) {
				// 将依赖挂载到每个chunk上
				chunk.link();
			}
			// 过滤
			chunks = chunks.filter(isChunkRendered);
			const facades: Chunk[] = [];
			// 生成一个东西
			for (const chunk of chunks) {
				facades.push(...chunk.generateFacades());
			}

			timeEnd('generate chunks', 2);

			this.phase = BuildPhase.GENERATE;
			// 把生成的东西，追加到chunks后面，有啥用捏?
			return chunks.concat(facades);
		});
	}

	getCache(): RollupCache {
		// handle plugin cache eviction
		for (const name in this.pluginCache) {
			// 获取当前插件
			const cache = this.pluginCache[name];
			// 两步操作：
			// 1. 遍历钩子函数，如果执行超过缓存过期次数了，删掉缓存的执行结果，结束，如果都没超过，也结束
			// 2. 如果插件没有配置钩子函数，或者全部都过期了，那么删除这个插件的缓存
			let allDeleted = true;
			// 遍历插件的key，然后获取属性
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
		// 如果有treeshaking不为空
		if (this.treeshakingOptions) {
			// 第一个tree shaking
			let treeshakingPass = 1;
			do {
				timeStart(`treeshaking pass ${treeshakingPass}`, 3);
				this.needsTreeshakingPass = false;
				for (const module of modules) {
					// 标记是需要的，不能shaking
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
		// 遍历入口模块
		for (const module of this.modules) {
			// 将依赖链接(挂载)到当前module上
			module.linkDependencies();
		}
		// 入口模块依赖解析
		// 分析完整的入口模块
		// 返回所有的入口启动模块(也就是非外部模块)，和那些依赖了一圈结果成死循环的模块相对路径
		const { orderedModules, cyclePaths } = analyseModuleExecution(entryModules);
		// 对那些死循环路径进行警告
		for (const cyclePath of cyclePaths) {
			this.warn({
				code: 'CIRCULAR_DEPENDENCY',
				cycle: cyclePath,
				importer: cyclePath[0],
				message: `Circular dependency: ${cyclePath.join(' -> ')}`
			});
		}
		// 过滤出真正的入口启动模块，赋值给modules
		this.modules = orderedModules;

		for (const module of this.modules) {
			// 表达式每个一个节点自己的实现
			module.bindReferences();
		}

		// 获取导出内容，没有的话就报错
		this.warnForMissingExports();
	}

	private warnForMissingExports() {
		for (const module of this.modules) {
			for (const importName of Object.keys(module.importDescriptions)) {
				const importDescription = module.importDescriptions[importName];
				// 获取导出内容，没有的话就报错
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
