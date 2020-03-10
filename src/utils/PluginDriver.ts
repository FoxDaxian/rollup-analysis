import Graph from '../Graph';
import {
	EmitFile,
	OutputBundleWithPlaceholders,
	Plugin,
	PluginContext,
	PluginHooks,
	RollupWatcher,
	SerializablePluginCache
} from '../rollup/types';
import { getRollupDefaultPlugin } from './defaultPlugin';
import { errInputHookInOutputPlugin, error } from './error';
import { FileEmitter } from './FileEmitter';
import { getPluginContexts } from './PluginContext';
import { throwPluginError, warnDeprecatedHooks } from './pluginUtils';

type Args<T> = T extends (...args: infer K) => any ? K : never;
type EnsurePromise<T> = Promise<T extends Promise<infer K> ? K : T>;

export type Reduce<R = any, T = any> = (reduction: T, result: R, plugin: Plugin) => T;
export type ReplaceContext = (context: PluginContext, plugin: Plugin) => PluginContext;

// 插件驱动器有不同的调用hook的方法，具体后期列出
export class PluginDriver {
	public emitFile: EmitFile;
	public finaliseAssets: () => void;
	public getFileName: (fileReferenceId: string) => string;
	public setOutputBundle: (
		outputBundle: OutputBundleWithPlaceholders,
		assetFileNames: string
	) => void;

	private fileEmitter: FileEmitter;
	private graph: Graph;
	private pluginCache: Record<string, SerializablePluginCache> | undefined;
	private pluginContexts: PluginContext[];
	private plugins: Plugin[];
	private preserveSymlinks: boolean;
	private previousHooks = new Set<string>(['options']);
	private watcher: RollupWatcher | undefined;

	constructor(
		graph: Graph,
		userPlugins: Plugin[],
		pluginCache: Record<string, SerializablePluginCache> | undefined,
		preserveSymlinks: boolean,
		// rollup的watcher类
		watcher: RollupWatcher | undefined,
		basePluginDriver?: PluginDriver
	) {
		// 调用graph的警告函数，警告避免使用一些已弃用的属性
		warnDeprecatedHooks(userPlugins, graph);
		// 将接收的参数初始化
		this.graph = graph;
		this.pluginCache = pluginCache;
		this.preserveSymlinks = preserveSymlinks;
		this.watcher = watcher;

		// 创建FileEmitter实例，使其可以获取到graph实例的一些方法
		this.fileEmitter = new FileEmitter(graph, basePluginDriver && basePluginDriver.fileEmitter);
		// 获取fileEmitter提供的方法
		// TODO：这些方法待深入
		this.emitFile = this.fileEmitter.emitFile;
		this.getFileName = this.fileEmitter.getFileName;
		this.finaliseAssets = this.fileEmitter.assertAssetsFinalized;
		this.setOutputBundle = this.fileEmitter.setOutputBundle;

		// 添加内置rollup plugin
		this.plugins = userPlugins.concat(
			basePluginDriver ? basePluginDriver.plugins : [getRollupDefaultPlugin(preserveSymlinks)]
		);
		// 利用map给每个插件注入plugin特有的context
		this.pluginContexts = this.plugins.map(
			getPluginContexts(pluginCache, graph, this.fileEmitter, watcher)
		);
		// 目前还没发现用到的地方
		if (basePluginDriver) {
			for (const plugin of userPlugins) {
				for (const hook of basePluginDriver.previousHooks) {
					if (hook in plugin) {
						graph.warn(errInputHookInOutputPlugin(plugin.name, hook));
					}
				}
			}
		}
	}

	public createOutputPluginDriver(plugins: Plugin[]): PluginDriver {
		return new PluginDriver(
			this.graph,
			plugins,
			this.pluginCache,
			this.preserveSymlinks,
			this.watcher,
			this
		);
	}

	// 遇到第一个非null的结果就停止并返回
	// chains, first non-null result stops and returns
	hookFirst<H extends keyof PluginHooks, R = ReturnType<PluginHooks[H]>>(
		hookName: H,
		args: Args<PluginHooks[H]>,
		replaceContext?: ReplaceContext | null,
		skip?: number | null
	): EnsurePromise<R> {
		let promise: Promise<any> = Promise.resolve();
		for (let i = 0; i < this.plugins.length; i++) {
			if (skip === i) continue;
			promise = promise.then((result: any) => {
				// 这一步判断，证明了，是所有的插件中，只要有一个同类钩子函数返回值不为null，那么就返回这个返回值，也就意味着不会执行后面的同类钩子函数了
				if (result != null) return result;
				// 执行钩子函数咯
				return this.runHook(hookName, args as any[], i, false, replaceContext);
			});
		}
		// 返回的是所有插件同类钩子函数中中调用的最后一个钩子函数
		return promise;
	}

	// chains synchronously, first non-null result stops and returns
	hookFirstSync<H extends keyof PluginHooks, R = ReturnType<PluginHooks[H]>>(
		hookName: H,
		args: Args<PluginHooks[H]>,
		replaceContext?: ReplaceContext
	): R {
		for (let i = 0; i < this.plugins.length; i++) {
			const result = this.runHookSync(hookName, args, i, replaceContext);
			if (result != null) return result as any;
		}
		return null as any;
	}

	// parallel, ignores returns
	hookParallel<H extends keyof PluginHooks>(
		hookName: H,
		args: Args<PluginHooks[H]>,
		replaceContext?: ReplaceContext
	): Promise<void> {
		// 创建promise.all容器
		const promises: Promise<void>[] = [];
		// 遍历每一个plugin
		for (let i = 0; i < this.plugins.length; i++) {
			// 执行hook返回promise
			const hookPromise = this.runHook<void>(hookName, args as any[], i, false, replaceContext);
			// 如果没有那么不push
			if (!hookPromise) continue;
			promises.push(hookPromise);
		}
		// 返回promise
		return Promise.all(promises).then(() => {});
	}


	// chains, reduces returns of type R, to type T, handling the reduced value as the first hook argument
	hookReduceArg0<H extends keyof PluginHooks, V, R = ReturnType<PluginHooks[H]>>(
		hookName: H,
		[arg0, ...args]: any[], // 取出传入的数组的第一个参数，将剩余的置于一个数组中
		reduce: Reduce<V, R>,
		replaceContext?: ReplaceContext //  替换当前plugin调用时候的上下文环境
	) {
		let promise = Promise.resolve(arg0); // 默认返回source.code
		for (let i = 0; i < this.plugins.length; i++) {
			// 第一个promise的时候只会接收到上面传递的arg0
			// 之后每一次promise接受的都是上一个插件处理过后的source.code值
			promise = promise.then(arg0 => {
				const hookPromise = this.runHook(hookName, [arg0, ...args], i, false, replaceContext);
				// 如果没有返回promise，那么直接返回arg0
				if (!hookPromise) return arg0;
				// result代表插件执行完成的返回值
				return hookPromise.then((result: any) =>
					reduce.call(this.pluginContexts[i], arg0, result, this.plugins[i])
				);
			});
		}
		return promise;
	}

	// chains synchronously, reduces returns of type R, to type T, handling the reduced value as the first hook argument
	hookReduceArg0Sync<H extends keyof PluginHooks, V, R = ReturnType<PluginHooks[H]>>(
		hookName: H,
		[arg0, ...args]: any[],
		reduce: Reduce<V, R>,
		replaceContext?: ReplaceContext
	): R {
		for (let i = 0; i < this.plugins.length; i++) {
			const result: any = this.runHookSync(hookName, [arg0, ...args], i, replaceContext);
			arg0 = reduce.call(this.pluginContexts[i], arg0, result, this.plugins[i]);
		}
		return arg0;
	}


	// const concatSep = (out: string, next: string) => (next ? `${out}\n${next}` : out);
	// const concatDblSep = (out: string, next: string) => (next ? `${out}\n\n${next}` : out);
	// 参数参考: 'banner', evalIfFn(options.banner), [], concatSep

	// chains, reduces returns of type R, to type T, handling the reduced value separately. permits hooks as values.
	hookReduceValue<H extends keyof Plugin, R = any, T = any>(
		hookName: H,
		initialValue: T | Promise<T>,
		args: any[],
		reduce: Reduce<R, T>,
		replaceContext?: ReplaceContext
	): Promise<T> {
		let promise = Promise.resolve(initialValue);
		for (let i = 0; i < this.plugins.length; i++) {
			promise = promise.then(value => {
				const hookPromise = this.runHook(hookName, args, i, true, replaceContext);
				if (!hookPromise) return value;
				return hookPromise.then((result: any) =>
					reduce.call(this.pluginContexts[i], value, result, this.plugins[i])
				);
			});
		}
		return promise;
	}

	// chains, reduces returns of type R, to type T, handling the reduced value separately. permits hooks as values.
	hookReduceValueSync<H extends keyof PluginHooks, R = any, T = any>(
		hookName: H,
		initialValue: T,
		args: any[],
		reduce: Reduce<R, T>,
		replaceContext?: ReplaceContext
	): T {
		let acc = initialValue;
		for (let i = 0; i < this.plugins.length; i++) {
			const result: any = this.runHookSync(hookName, args, i, replaceContext);
			acc = reduce.call(this.pluginContexts[i], acc, result, this.plugins[i]);
		}
		return acc;
	}

	// chains, ignores returns
	async hookSeq<H extends keyof PluginHooks>(
		hookName: H,
		args: Args<PluginHooks[H]>,
		replaceContext?: ReplaceContext
	): Promise<void> {
		let promise: Promise<void> = Promise.resolve();
		for (let i = 0; i < this.plugins.length; i++)
			promise = promise.then(() =>
				this.runHook<void>(hookName, args as any[], i, false, replaceContext)
			);
		return promise;
	}

	// chains, ignores returns
	hookSeqSync<H extends keyof PluginHooks>(
		hookName: H,
		args: Args<PluginHooks[H]>,
		replaceContext?: ReplaceContext
	): void {
		for (let i = 0; i < this.plugins.length; i++)
			this.runHookSync<void>(hookName, args as any[], i, replaceContext);
	}

	// hookName, args, i, false, replaceContext
	private runHook<T>(
		hookName: string,
		args: any[],
		pluginIndex: number,
		permitValues: boolean,
		hookContext?: ReplaceContext | null
	): Promise<T> {
		this.previousHooks.add(hookName);
		// 找到当前plugin
		const plugin = this.plugins[pluginIndex];
		// 找到当前执行的在plugin中定义的hooks钩子函数
		const hook = (plugin as any)[hookName];
		if (!hook) return undefined as any;

		// pluginContexts在初始化plugin驱动器类的时候定义，是个数组，数组保存对应着每个插件的上下文环境
		let context = this.pluginContexts[pluginIndex];
		// 用于区分对待不同钩子函数的插件上下文
		if (hookContext) {
			context = hookContext(context, plugin);
		}
		return Promise.resolve()
			.then(() => {
				// permit values allows values to be returned instead of a functional hook
				if (typeof hook !== 'function') {
					if (permitValues) return hook;
					return error({
						code: 'INVALID_PLUGIN_HOOK',
						message: `Error running plugin hook ${hookName} for ${plugin.name}, expected a function hook.`
					});
				}
				// 传入插件上下文和参数，返回插件执行结果
				return hook.apply(context, args);
			})
			.catch(err => throwPluginError(err, plugin.name, { hook: hookName }));
	}

	private runHookSync<T>(
		hookName: string,
		args: any[],
		pluginIndex: number,
		hookContext?: ReplaceContext
	): T {
		this.previousHooks.add(hookName);
		const plugin = this.plugins[pluginIndex];
		let context = this.pluginContexts[pluginIndex];
		const hook = (plugin as any)[hookName];
		if (!hook) return undefined as any;

		if (hookContext) {
			context = hookContext(context, plugin);
		}
		try {
			// permit values allows values to be returned instead of a functional hook
			if (typeof hook !== 'function') {
				return error({
					code: 'INVALID_PLUGIN_HOOK',
					message: `Error running plugin hook ${hookName} for ${plugin.name}, expected a function hook.`
				});
			}
			return hook.apply(context, args);
		} catch (err) {
			return throwPluginError(err, plugin.name, { hook: hookName });
		}
	}
}
