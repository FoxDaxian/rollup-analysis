import ExternalModule from '../ExternalModule';
import Module from '../Module';

export function markModuleAndImpureDependenciesAsExecuted(baseModule: Module) {
	baseModule.isExecuted = true;
	const modules = [baseModule];
	const visitedModules = new Set<string>();
	for (const module of modules) {
		for (const dependency of module.dependencies) {
			// 依赖们进行是否执行操作
			// 条件为： 不是外部依赖，并且未执行，有副作用，没缓存过
			if (
				!(dependency instanceof ExternalModule) &&
				!dependency.isExecuted &&
				dependency.moduleSideEffects &&
				!visitedModules.has(dependency.id)
			) {
				dependency.isExecuted = true;
				visitedModules.add(dependency.id);
				modules.push(dependency);
			}
		}
	}
}
