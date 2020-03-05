import * as ESTree from 'estree';
import ExternalModule from './ExternalModule';
import Graph from './Graph';
import Module from './Module';
import {
	ExternalOption,
	GetManualChunk,
	IsExternal,
	ModuleJSON,
	ModuleSideEffectsOption,
	PureModulesOption,
	ResolvedId,
	ResolveIdResult,
	TransformModuleJSON
} from './rollup/types';
import {
	errBadLoader,
	errCannotAssignModuleToChunk,
	errEntryCannotBeExternal,
	errExternalSyntheticExports,
	errInternalIdCannotBeExternal,
	errInvalidOption,
	errNamespaceConflict,
	error,
	errUnresolvedEntry,
	errUnresolvedImport,
	errUnresolvedImportTreatedAsExternal
} from './utils/error';
import { isRelative, resolve } from './utils/path';
import { PluginDriver } from './utils/PluginDriver';
import relativeId from './utils/relativeId';
import { timeEnd, timeStart } from './utils/timers';
import transform from './utils/transform';

export interface UnresolvedModule {
	fileName: string | null;
	id: string;
	name: string | null;
}

function normalizeRelativeExternalId(importer: string, source: string) {
	return isRelative(source) ? resolve(importer, '..', source) : source;
}

function getIdMatcher<T extends Array<any>>(
	option: boolean | string[] | ((id: string, ...args: T) => boolean | null | undefined)
): (id: string, ...args: T) => boolean {
	if (option === true) {
		return () => true;
	}
	if (typeof option === 'function') {
		return (id, ...args) => (!id.startsWith('\0') && option(id, ...args)) || false;
	}
	if (option) {
		const ids = new Set(Array.isArray(option) ? option : option ? [option] : []);
		return (id => ids.has(id)) as (id: string, ...args: T) => boolean;
	}
	return () => false;
}

function getHasModuleSideEffects(
	moduleSideEffectsOption: ModuleSideEffectsOption,
	pureExternalModules: PureModulesOption,
	graph: Graph
): (id: string, external: boolean) => boolean {
	if (typeof moduleSideEffectsOption === 'boolean') {
		return () => moduleSideEffectsOption;
	}
	if (moduleSideEffectsOption === 'no-external') {
		return (_id, external) => !external;
	}
	if (typeof moduleSideEffectsOption === 'function') {
		return (id, external) =>
			!id.startsWith('\0') ? moduleSideEffectsOption(id, external) !== false : true;
	}
	if (Array.isArray(moduleSideEffectsOption)) {
		const ids = new Set(moduleSideEffectsOption);
		return id => ids.has(id);
	}
	if (moduleSideEffectsOption) {
		graph.warn(
			errInvalidOption(
				'treeshake.moduleSideEffects',
				'please use one of false, "no-external", a function or an array'
			)
		);
	}
	const isPureExternalModule = getIdMatcher(pureExternalModules);
	return (id, external) => !(external && isPureExternalModule(id));
}

export class ModuleLoader {
	readonly isExternal: IsExternal;
	private readonly getManualChunk: GetManualChunk;
	private readonly graph: Graph;
	private readonly hasModuleSideEffects: (id: string, external: boolean) => boolean;
	private readonly indexedEntryModules: { index: number; module: Module }[] = [];
	private latestLoadModulesPromise: Promise<any> = Promise.resolve();
	private readonly manualChunkModules: Record<string, Module[]> = {};
	private readonly modulesById: Map<string, Module | ExternalModule>;
	private nextEntryModuleIndex = 0;
	private readonly pluginDriver: PluginDriver;

	// this,
	// this.moduleById,
	// this.pluginDriver,
	// options.external!,
	// (typeof options.manualChunks === 'function' && options.manualChunks) as GetManualChunk | null,
	// (this.treeshakingOptions ? this.treeshakingOptions.moduleSideEffects : null)!,
	// (this.treeshakingOptions ? this.treeshakingOptions.pureExternalModules : false)!

	constructor(
		graph: Graph,
		modulesById: Map<string, Module | ExternalModule>,
		pluginDriver: PluginDriver,
		// 下面的都是配置信息了
		external: ExternalOption,
		getManualChunk: GetManualChunk | null,
		moduleSideEffects: ModuleSideEffectsOption,
		pureExternalModules: PureModulesOption
	) {
		this.graph = graph;
		this.modulesById = modulesById;
		this.pluginDriver = pluginDriver;
		// 匹配外部资源
		this.isExternal = getIdMatcher(external);
		this.hasModuleSideEffects = getHasModuleSideEffects(
			moduleSideEffects,
			pureExternalModules,
			graph
		);
		this.getManualChunk = typeof getManualChunk === 'function' ? getManualChunk : () => null;
	}

	addEntryModules(
		unresolvedEntryModules: UnresolvedModule[],
		isUserDefined: boolean
	): Promise<{
		entryModules: Module[];
		manualChunkModulesByAlias: Record<string, Module[]>;
		newEntryModules: Module[];
	}> {
		// nextEntryModuleIndex初始定义为0，意味着默认有0个入口
		// firstEntryModuleIndex第一个入口模块的索引值 => 默认为0
		const firstEntryModuleIndex = this.nextEntryModuleIndex;
		// 设置为真正的入口数量
		this.nextEntryModuleIndex += unresolvedEntryModules.length;

		// loadNewEntryModulesPromise： 是转换后的一堆rollup入口模块
		const loadNewEntryModulesPromise = Promise.all(
			// 再次声明，rollup以文件路径为id哦！！！这个很重要
			// 返回了Promise[]以供promise.all使用
			unresolvedEntryModules.map(({ fileName, id, name }) =>
				this.loadEntryModule(id, true).then(module => {
					// 上面的module参数是id经过一系列处理后得到的rollup模块
					// 在进行chunk的处理
					if (fileName !== null) {
						// 如果有filename，那么设置为module的chunk名
						module.chunkFileNames.add(fileName);
					} else if (name !== null) {
						if (module.chunkName === null) {
							// 以name作为chunkname
							module.chunkName = name;
						}
						if (isUserDefined) {
							// 用户定义的chunk名
							module.userChunkNames.add(name);
						}
					}
					return module;
				})
			)
		).then(entryModules => {
			// entryModules为一个id经过一些列转换后得到的rollup入口模块
			// 这一大堆转换不建议深入看，不同的工具有不同的思考，对于处理也不尽相同，还是要保持自己的想法，要看的话也是借鉴、批判的看
			let moduleIndex = firstEntryModuleIndex;
			for (const entryModule of entryModules) {
				// 是否为用户定义，默认是
				entryModule.isUserDefinedEntryPoint = entryModule.isUserDefinedEntryPoint || isUserDefined;
				const existingIndexModule = this.indexedEntryModules.find(
					indexedModule => indexedModule.module.id === entryModule.id
				);
				// 根据moduleIndex进行入口去重
				if (!existingIndexModule) {
					this.indexedEntryModules.push({ module: entryModule, index: moduleIndex });
				} else {
					existingIndexModule.index = Math.min(existingIndexModule.index, moduleIndex);
				}
				moduleIndex++;
			}
			// 入口模块排序
			this.indexedEntryModules.sort(({ index: indexA }, { index: indexB }) =>
				indexA > indexB ? 1 : -1
			);
			// 引用类型可直接返回
			return entryModules;
		});

		// entryModules 和 newEntryModules 不一样哦
		return this.awaitLoadModulesPromise(loadNewEntryModulesPromise).then(newEntryModules => ({
			entryModules: this.indexedEntryModules.map(({ module }) => module), // 入口模块
			manualChunkModulesByAlias: this.manualChunkModules, // chunk
			newEntryModules // module详细信息
		}));
	}

	addManualChunks(manualChunks: Record<string, string[]>): Promise<void> {
		const unresolvedManualChunks: { alias: string; id: string }[] = [];
		for (const alias of Object.keys(manualChunks)) {
			const manualChunkIds = manualChunks[alias];
			for (const id of manualChunkIds) {
				unresolvedManualChunks.push({ id, alias });
			}
		}
		const loadNewManualChunkModulesPromise = Promise.all(
			unresolvedManualChunks.map(({ id }) => this.loadEntryModule(id, false))
		).then(manualChunkModules => {
			for (let index = 0; index < manualChunkModules.length; index++) {
				this.addModuleToManualChunk(unresolvedManualChunks[index].alias, manualChunkModules[index]);
			}
		});

		return this.awaitLoadModulesPromise(loadNewManualChunkModulesPromise);
	}

	async resolveId(
		source: string,
		importer: string,
		skip?: number | null
	): Promise<ResolvedId | null> {
		return this.normalizeResolveIdResult(
			this.isExternal(source, importer, false)
				? false
				: await this.pluginDriver.hookFirst('resolveId', [source, importer], null, skip),
			importer,
			source
		);
	}

	private addModuleToManualChunk(alias: string, module: Module) {
		// Module类，初始化为实例的时候，manualChunkAlias默认为null
		// 如果不为null，那么就重复赋值了，报错吧
		if (module.manualChunkAlias !== null && module.manualChunkAlias !== alias) {
			return error(errCannotAssignModuleToChunk(module.id, alias, module.manualChunkAlias));
		}
		// 这里设置rollup模块的chunk别名
		module.manualChunkAlias = alias;
		// 将返回相同chunk 别名的 module添加到数组中，以便之后打包同一个chunk中
		if (!this.manualChunkModules[alias]) {
			this.manualChunkModules[alias] = [];
		}
		this.manualChunkModules[alias].push(module);
	}

	private awaitLoadModulesPromise<T>(loadNewModulesPromise: Promise<T>): Promise<T> {
		// 为了更新this.latestLoadModulesPromise的值
		this.latestLoadModulesPromise = Promise.all([
			loadNewModulesPromise,
			this.latestLoadModulesPromise // 默认值为 Promise.resolve()
		]);

		const getCombinedPromise = (): Promise<void> => {
			const startingPromise = this.latestLoadModulesPromise;
			return startingPromise.then(() => {
				if (this.latestLoadModulesPromise !== startingPromise) {
					return getCombinedPromise();
				}
			});
		};

		return getCombinedPromise().then(() => loadNewModulesPromise);
	}

	// 获取所有的依赖模块
	private fetchAllDependencies(module: Module): Promise<unknown> {
		return Promise.all([
			...(Array.from(module.sources).map(async source =>
				this.fetchResolvedDependency(
					source,
					module.id,
					(module.resolvedIds[source] =
						module.resolvedIds[source] ||
						this.handleResolveId(await this.resolveId(source, module.id), source, module.id))
				)
			) as Promise<unknown>[]),
			// 解析按需加载、动态导入的模块
			...module.getDynamicImportExpressions().map((specifier, index) =>
				this.resolveDynamicImport(module, specifier as string | ESTree.Node, module.id).then(
					resolvedId => {
						if (resolvedId === null) return;
						const dynamicImport = module.dynamicImports[index];
						if (typeof resolvedId === 'string') {
							dynamicImport.resolution = resolvedId;
							return;
						}
						return this.fetchResolvedDependency(
							relativeId(resolvedId.id),
							module.id,
							resolvedId
						).then(module => {
							dynamicImport.resolution = module;
						});
					}
				)
			)
		]);
	}

	// 传入的参数示例：id, undefined, true, false, isEntry(true)
	private fetchModule(
		id: string,
		importer: string,
		moduleSideEffects: boolean,
		syntheticNamedExports: boolean,
		isEntry: boolean
	): Promise<Module> {
		const existingModule = this.modulesById.get(id);
		// 获取缓存，提高性能
		if (existingModule instanceof Module) {
			existingModule.isEntryPoint = existingModule.isEntryPoint || isEntry;
			return Promise.resolve(existingModule);
		}

		// 是时候将入口路径转换成rollup的模块了！！
		const module: Module = new Module(
			this.graph,
			id,
			moduleSideEffects,
			syntheticNamedExports,
			isEntry
		);
		// 缓存，以备优化
		this.modulesById.set(id, module);
		// 为每一个入库模块启动监听
		this.graph.watchFiles[id] = true;
		// this.getManualChunk为用户定义的公共包提取规则，如果是函数才会进入这条判断
		// 大概逻辑为：如果当前入口用户定义了提取公共chunk规则的话，将该公共模块进行添加缓存
		const manualChunkAlias = this.getManualChunk(id);
		// 比如 manualChunkAlias(id){
		// 	if (xxx) {
		// 		return 'vendor';
		// 	}
		// }
		if (typeof manualChunkAlias === 'string') {
			// 将用户定义的公共模块名进行添加操作
			this.addModuleToManualChunk(manualChunkAlias, module);
		}

		timeStart('load modules', 3);
		return Promise.resolve(this.pluginDriver.hookFirst('load', [id]))
			.catch((err: Error) => {
				timeEnd('load modules', 3);
				let msg = `Could not load ${id}`;
				if (importer) msg += ` (imported by ${importer})`;
				msg += `: ${err.message}`;
				err.message = msg;
				throw err;
			})
			.then(source => {
				// 第一步操作
				timeEnd('load modules', 3);
				// 格式化为{ code: source }的样子
				// 参考 https://github.com/rollup/plugins/tree/e7a9e4a516d398cbbd1fa2b605610517d9161525/packages/wasm 这个插件
				// 如果加载的文件符合要求的话，获取文件内容并返回，以供后续逻辑使用
				if (typeof source === 'string') return { code: source };
				if (source && typeof source === 'object' && typeof source.code === 'string') return source;
				return error(errBadLoader(id));
			})
			.then(sourceDescription => {
				// 第二步操作
				// 缓存相关操作
				// 上一次传入的打包结果中，能否找到该模块，通过路径id找rollup模块
				// 这个rollup模块可以理解为虚拟dom，vdom是将dom转为数据，rollup模块是将文件转为数据
				// 好多都是这种思想，开发语言有中间机器码之说，babel有ast之说，mvvm框架有vdom之说，rollup有专用的模块之说。。。。
				const cachedModule = this.graph.cachedModules.get(id);
				// 如果和当前构建的模块一直，那么进行emitFile操作，然后返回缓存模块，提升性能
				//
				if (
					cachedModule &&
					!cachedModule.customTransformCache &&
					cachedModule.originalCode === sourceDescription.code
				) {
					if (cachedModule.transformFiles) {
						for (const emittedFile of cachedModule.transformFiles)
							this.pluginDriver.emitFile(emittedFile);
					}
					return cachedModule;
				}

				// 没有缓存的时候的逻辑，可通过该逻辑得到上面缓存中的一些字段是怎么来的
				// 给当前模块添加一些标志
				if (typeof sourceDescription.moduleSideEffects === 'boolean') {
					module.moduleSideEffects = sourceDescription.moduleSideEffects;
				}
				if (typeof sourceDescription.syntheticNamedExports === 'boolean') {
					module.syntheticNamedExports = sourceDescription.syntheticNamedExports;
				}
				// 这种传入graph的方式，大部分都是用来使用实例提供的一些公共方法，感觉可能不是最优的，传入层级会很深
				// sourceDescription：{ code: source, ... }转化
				// this.graph: 全局唯一的graph，代表模块图标
				// 这行是让代码经过所有插件的transform操作
				return transform(this.graph, sourceDescription, module);
			})
			.then((source: TransformModuleJSON | ModuleJSON) => {
				// 第三步操作，第三步操作有点不太懂细节了
				// 所有的产出都会挂载到当前这个module上
				module.setSource(source);
				// 模块id与模块绑定
				this.modulesById.set(id, module);

				// 处理模块的依赖们，将导出的模块也挂载到module上？
				return this.fetchAllDependencies(module).then(() => {
					for (const name in module.exports) {
						if (name !== 'default') {
							module.exportsAll[name] = module.id;
						}
					}
					for (const source of module.exportAllSources) {
						const id = module.resolvedIds[source].id;
						const exportAllModule = this.modulesById.get(id);
						if (exportAllModule instanceof ExternalModule) continue;

						for (const name in exportAllModule!.exportsAll) {
							if (name in module.exportsAll) {
								this.graph.warn(errNamespaceConflict(name, module, exportAllModule!));
							} else {
								module.exportsAll[name] = exportAllModule!.exportsAll[name];
							}
						}
					}
					return module;
				});
			});
	}

	private fetchResolvedDependency(
		source: string,
		importer: string,
		resolvedId: ResolvedId
	): Promise<Module | ExternalModule> {
		// 区分处理外部依赖模块和非外部依赖模块
		if (resolvedId.external) {
			if (!this.modulesById.has(resolvedId.id)) {
				this.modulesById.set(
					resolvedId.id,
					// 外部模块
					new ExternalModule(this.graph, resolvedId.id, resolvedId.moduleSideEffects)
				);
			}

			const externalModule = this.modulesById.get(resolvedId.id);
			if (!(externalModule instanceof ExternalModule)) {
				return error(errInternalIdCannotBeExternal(source, importer));
			}
			return Promise.resolve(externalModule);
		} else {
			// 如果不是外部依赖模块，那么反过去继续fetchmodule
			return this.fetchModule(
				resolvedId.id,
				importer,
				resolvedId.moduleSideEffects,
				resolvedId.syntheticNamedExports,
				false
			);
		}
	}

	private handleResolveId(
		resolvedId: ResolvedId | null,
		source: string,
		importer: string
	): ResolvedId {
		if (resolvedId === null) {
			if (isRelative(source)) {
				return error(errUnresolvedImport(source, importer));
			}
			this.graph.warn(errUnresolvedImportTreatedAsExternal(source, importer));
			return {
				external: true,
				id: source,
				moduleSideEffects: this.hasModuleSideEffects(source, true),
				syntheticNamedExports: false
			};
		} else {
			if (resolvedId.external && resolvedId.syntheticNamedExports) {
				this.graph.warn(errExternalSyntheticExports(source, importer));
			}
		}
		return resolvedId;
	}

	private loadEntryModule = (unresolvedId: string, isEntry: boolean): Promise<Module> =>
		// resolveId钩子函数接收两个参数，一个是id，
		// then中的参数resolveIdResult是最后一个钩子函数的返回结果
		this.pluginDriver.hookFirst('resolveId', [unresolvedId, undefined]).then(resolveIdResult => {
			// 如果插件返回false，那么代表不应该作为入口，应该作为外部依赖，同理，对于返回对象且含有external的同样适用
			if (
				resolveIdResult === false ||
				(resolveIdResult && typeof resolveIdResult === 'object' && resolveIdResult.external)
			) {
				return error(errEntryCannotBeExternal(unresolvedId));
			}
			// 再次获取经过resolveId钩子函数处理过的路径标志:id
			const id =
				resolveIdResult && typeof resolveIdResult === 'object'
					? resolveIdResult.id
					: resolveIdResult;

			if (typeof id === 'string') {
				// 返回经过一大堆处理后的rollup模块
				return this.fetchModule(id, undefined as any, true, false, isEntry);
			}
			// 不能解析入口，咱报个错吧
			return error(errUnresolvedEntry(unresolvedId));
		});

	private normalizeResolveIdResult(
		resolveIdResult: ResolveIdResult,
		importer: string,
		source: string
	): ResolvedId | null {
		let id = '';
		let external = false;
		let moduleSideEffects = null;
		let syntheticNamedExports = false;
		if (resolveIdResult) {
			if (typeof resolveIdResult === 'object') {
				id = resolveIdResult.id;
				if (resolveIdResult.external) {
					external = true;
				}
				if (typeof resolveIdResult.moduleSideEffects === 'boolean') {
					moduleSideEffects = resolveIdResult.moduleSideEffects;
				}
				if (typeof resolveIdResult.syntheticNamedExports === 'boolean') {
					syntheticNamedExports = resolveIdResult.syntheticNamedExports;
				}
			} else {
				if (this.isExternal(resolveIdResult, importer, true)) {
					external = true;
				}
				id = external ? normalizeRelativeExternalId(importer, resolveIdResult) : resolveIdResult;
			}
		} else {
			id = normalizeRelativeExternalId(importer, source);
			if (resolveIdResult !== false && !this.isExternal(id, importer, true)) {
				return null;
			}
			external = true;
		}
		return {
			external,
			id,
			moduleSideEffects:
				typeof moduleSideEffects === 'boolean'
					? moduleSideEffects
					: this.hasModuleSideEffects(id, external),
			syntheticNamedExports
		};
	}

	private async resolveDynamicImport(
		module: Module,
		specifier: string | ESTree.Node,
		importer: string
	): Promise<ResolvedId | string | null> {
		// TODO we only should expose the acorn AST here
		const resolution = await this.pluginDriver.hookFirst('resolveDynamicImport', [
			specifier,
			importer
		]);
		if (typeof specifier !== 'string') {
			if (typeof resolution === 'string') {
				return resolution;
			}
			if (!resolution) {
				return null;
			}
			return {
				external: false,
				moduleSideEffects: true,
				...resolution
			} as ResolvedId;
		}
		if (resolution == null) {
			return (module.resolvedIds[specifier] =
				module.resolvedIds[specifier] ||
				this.handleResolveId(await this.resolveId(specifier, module.id), specifier, module.id));
		}
		return this.handleResolveId(
			this.normalizeResolveIdResult(resolution, importer, specifier),
			specifier,
			importer
		);
	}
}
