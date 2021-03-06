import { WatchOptions } from 'chokidar'; // 只是获取这个类型
import { EventEmitter } from 'events';
import path from 'path';
import createFilter from 'rollup-pluginutils/src/createFilter';
import rollup, { setWatcher } from '../rollup/index';
import {
	InputOptions,
	OutputOptions,
	RollupBuild,
	RollupCache,
	RollupError,
	RollupWatcher,
	WatcherOptions
} from '../rollup/types';
import mergeOptions, { GenericConfigObject } from '../utils/mergeOptions';
import chokidar from './chokidar';
import { addTask, deleteTask } from './fileWatchers';

const DELAY = 200;

export class Watcher {
	emitter: RollupWatcher;

	private buildTimeout: NodeJS.Timer | null = null;
	private invalidatedIds: Set<string> = new Set();
	private rerun = false;
	private running: boolean;
	private tasks: Task[];

	constructor(configs: GenericConfigObject[] | GenericConfigObject) {
		// 没使用类名，直接用的类体，来实例化的，看了半天。。
		this.emitter = new (class extends EventEmitter {
			close: () => void;
			constructor(close: () => void) {
				super();
				// 供用户关闭使
				this.close = close;
				// 不警告
				// Allows more than 10 bundles to be watched without
				// showing the `MaxListenersExceededWarning` to the user.
				this.setMaxListeners(Infinity);
			}
		})(this.close.bind(this)) as RollupWatcher;
		this.tasks = (Array.isArray(configs) ? configs : configs ? [configs] : []).map(
			config => new Task(this, config)
		);
		this.running = true;
		process.nextTick(() => this.run());
	}

	close() {
		if (this.buildTimeout) clearTimeout(this.buildTimeout);
		for (const task of this.tasks) {
			task.close();
		}

		this.emitter.removeAllListeners();
	}

	emit(event: string, value?: any) {
		this.emitter.emit(event as any, value);
	}

	invalidate(id?: string) {
		if (id) {
			this.invalidatedIds.add(id);
		}
		// 防止刷刷刷
		if (this.running) {
			this.rerun = true;
			return;
		}

		// clear pre
		if (this.buildTimeout) clearTimeout(this.buildTimeout);

		this.buildTimeout = setTimeout(() => {
			this.buildTimeout = null;
			for (const id of this.invalidatedIds) {
				// 触发rollup.rollup中监听的事件
				this.emit('change', id);
			}
			this.invalidatedIds.clear();
			// 触发rollup.rollup中监听的事件
			this.emit('restart');
			// 又走了一遍构建
			this.run();
		}, DELAY);
	}

	private run() {
		this.running = true;

		// 当emit 'event' 事件的时候，统一是传递给cli使用，通过code区别不同的执行环节，相当于钩子函数，我们也可以使用增加监听event事件来做我们想做的事
		this.emit('event', {
			code: 'START'
		});

		let taskPromise = Promise.resolve();
		for (const task of this.tasks) taskPromise = taskPromise.then(() => task.run());

		return taskPromise
			.then(() => {
				// 执行之后就置为false了，否则下次不会顺利执行，也保证了不会同时触发多次task
				this.running = false;

				this.emit('event', {
					code: 'END'
				});
			})
			.catch(error => {
				this.running = false;
				this.emit('event', {
					code: 'ERROR',
					error
				});
			})
			.then(() => {
				if (this.rerun) {
					this.rerun = false;
					this.invalidate();
				}
			});
	}
}

// Task类，执行任务的
export class Task {
	cache: RollupCache = { modules: [] };
	watchFiles: string[] = [];

	private chokidarOptions: WatchOptions;
	private chokidarOptionsHash: string;
	private closed: boolean;
	private filter: (id: string) => boolean;
	private inputOptions: InputOptions;
	private invalidated = true;
	private outputFiles: string[];
	private outputs: OutputOptions[];
	private watched: Set<string>;
	private watcher: Watcher;

	constructor(watcher: Watcher, config: GenericConfigObject) {
		// 获取Watch实例
		this.watcher = watcher;

		this.closed = false;
		this.watched = new Set();

		const { inputOptions, outputOptions } = mergeOptions({
			config
		});
		this.inputOptions = inputOptions;

		this.outputs = outputOptions;
		this.outputFiles = this.outputs.map(output => {
			if (output.file || output.dir) return path.resolve(output.file || output.dir!);
			return undefined as any;
		});

		const watchOptions: WatcherOptions = inputOptions.watch || {};
		if ('useChokidar' in watchOptions)
			(watchOptions as any).chokidar = (watchOptions as any).useChokidar;

		let chokidarOptions = 'chokidar' in watchOptions ? watchOptions.chokidar : !!chokidar;

		if (chokidarOptions) {
			chokidarOptions = {
				...(chokidarOptions === true ? {} : chokidarOptions),
				disableGlobbing: true,
				ignoreInitial: true
			};
		}

		if (chokidarOptions && !chokidar) {
			throw new Error(
				`watch.chokidar was provided, but chokidar could not be found. Have you installed it?`
			);
		}

		this.chokidarOptions = chokidarOptions as WatchOptions;
		this.chokidarOptionsHash = JSON.stringify(chokidarOptions);

		this.filter = createFilter(watchOptions.include, watchOptions.exclude);
	}

	close() {
		this.closed = true;
		for (const id of this.watched) {
			deleteTask(id, this, this.chokidarOptionsHash);
		}
	}

	invalidate(id: string, isTransformDependency: boolean) {
		this.invalidated = true;
		if (isTransformDependency) {
			for (const module of this.cache.modules) {
				if (module.transformDependencies.indexOf(id) === -1) continue;
				// effective invalidation
				module.originalCode = null as any;
			}
		}
		// 再调用watcher上的invalidate
		this.watcher.invalidate(id);
	}

	run() {
		if (!this.invalidated) return;
		this.invalidated = false;

		const options = {
			...this.inputOptions,
			cache: this.cache
		};

		const start = Date.now();

		this.watcher.emit('event', {
			code: 'BUNDLE_START',
			input: this.inputOptions.input,
			output: this.outputFiles
		});

		setWatcher(this.watcher.emitter);
		return rollup(options)
			.then(result => {
				if (this.closed) return undefined as any;
				this.updateWatchedFiles(result);
				return Promise.all(this.outputs.map(output => result.write(output))).then(() => result);
			})
			.then((result: RollupBuild) => {
				this.watcher.emit('event', {
					code: 'BUNDLE_END',
					duration: Date.now() - start,
					input: this.inputOptions.input,
					output: this.outputFiles,
					result
				});
			})
			.catch((error: RollupError) => {
				if (this.closed) return;

				if (Array.isArray(error.watchFiles)) {
					for (const id of error.watchFiles) {
						this.watchFile(id);
					}
				}
				if (error.id) {
					this.cache.modules = this.cache.modules.filter(module => module.id !== error.id);
				}
				throw error;
			});
	}

	private updateWatchedFiles(result: RollupBuild) {
		// 上一次的监听set
		const previouslyWatched = this.watched;
		// 新建监听set
		this.watched = new Set();
		// 构建的时候获取的监听文件，赋给watchFiles
		this.watchFiles = result.watchFiles;
		this.cache = result.cache;
		// 将监听的文件添加到监听set中
		for (const id of this.watchFiles) {
			this.watchFile(id);
		}
		for (const module of this.cache.modules) {
			for (const depId of module.transformDependencies) {
				this.watchFile(depId, true);
			}
		}
		// 上次监听的文件，这次没有的话，删除任务
		for (const id of previouslyWatched) {
			if (!this.watched.has(id)) deleteTask(id, this, this.chokidarOptionsHash);
		}
	}

	private watchFile(id: string, isTransformDependency = false) {
		if (!this.filter(id)) return;
		this.watched.add(id);

		if (this.outputFiles.some(file => file === id)) {
			throw new Error('Cannot import the generated bundle');
		}

		// 增加任务
		// this is necessary to ensure that any 'renamed' files
		// continue to be watched following an error
		addTask(id, this, this.chokidarOptions, this.chokidarOptionsHash, isTransformDependency);
	}
}

export default function watch(configs: GenericConfigObject[] | GenericConfigObject): RollupWatcher {
	return new Watcher(configs).emitter;
}
