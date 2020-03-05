import ExternalModule from '../ExternalModule';
import Module from '../Module';
import relativeId from './relativeId';

interface OrderedExecutionUnit {
	execIndex: number;
}

const compareExecIndex = <T extends OrderedExecutionUnit>(unitA: T, unitB: T) =>
	unitA.execIndex > unitB.execIndex ? 1 : -1;

export function sortByExecutionOrder(units: OrderedExecutionUnit[]) {
	units.sort(compareExecIndex);
}

export function analyseModuleExecution(entryModules: Module[]) {
	let nextExecIndex = 0;
	const cyclePaths: string[][] = [];
	const analysedModules: { [id: string]: boolean } = {};
	const orderedModules: Module[] = [];
	const dynamicImports: Module[] = [];
	const parents: { [id: string]: string | null } = {};

	const analyseModule = (module: Module | ExternalModule) => {
		if (analysedModules[module.id]) return;

		// 如果是外部依赖，那么被使用次数加1，记录一共被使用多少次，或许对提出公共chunk上有用，比如3次以上的提成一个文件巴拉巴拉
		// 添加到已解析modules数组内
		if (module instanceof ExternalModule) {
			module.execIndex = nextExecIndex++;
			analysedModules[module.id] = true;
			return;
		}

		// 走到这里的肯定不是外部依赖模块了
		// 所以找寻当前模块的所有依赖
		for (const dependency of module.dependencies) {
			// 当前模块的依赖在parents中
			if (dependency.id in parents) {
				// 没有被解析过
				if (!analysedModules[dependency.id]) {
					// 将循环路径push到cyclePaths
					cyclePaths.push(getCyclePath(dependency.id, module.id, parents));
				}
				// 跳过后面的操作，进行下一轮迭代循环
				continue;
			}
			// 标记这个依赖模块是哪个模块的
			parents[dependency.id] = module.id;
			// 将依赖模块作为主模块，继续分析
			analyseModule(dependency);
		}

		// 处理动态导入
		for (const { resolution } of module.dynamicImports) {
			if (resolution instanceof Module && dynamicImports.indexOf(resolution) === -1) {
				dynamicImports.push(resolution);
			}
		}

		// 被使用次数加1
		module.execIndex = nextExecIndex++;
		// 被分析过了，避免重复分析
		analysedModules[module.id] = true;
		orderedModules.push(module);
	};

	// 分析入口模块
	for (const curEntry of entryModules) {
		if (!parents[curEntry.id]) {
			parents[curEntry.id] = null;
			analyseModule(curEntry);
		}
	}
	// 入口模块提取出动态导入模块，然后再分析动态导入模块，进而打包出外部引入模块的核心模块和外部外部(就是double，强调一下)引入模块
	for (const curEntry of dynamicImports) {
		if (!parents[curEntry.id]) {
			parents[curEntry.id] = null;
			analyseModule(curEntry);
		}
	}

	return { orderedModules, cyclePaths };
}


// dependency.id, module.id, parents
// 当前模块依赖模块的id，当前模块的id，parents代表着各个模块和以来的引用关系
// 找到一个循环路径，以id开始和结束
function getCyclePath(id: string, parentId: string, parents: { [id: string]: string | null }) {
	// 获取相对路径
	const path = [relativeId(id)];
	// 当前模块id
	let curId = parentId;
	// 如果 当前模块id 不等于 当前模块依赖模块的id 的话 进入循环
	while (curId !== id) {
		// 将当前模块的相对路径添加到path中
		path.push(relativeId(curId));
		// 将当前模块作为依赖时的父模块id赋值给 当前模块
		curId = parents[curId]!;
		// 如果不存在，跳出循环
		if (!curId) break;
	}
	path.push(path[0]);
	path.reverse();
	return path;
}
