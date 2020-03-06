import ExternalModule from '../ExternalModule';
import Module from '../Module';
import { randomUint8Array, Uint8ArrayXor } from './entryHashing';

type DependentModuleMap = Map<Module, Set<Module>>;

export function assignChunkColouringHashes(
	entryModules: Module[],
	manualChunkModules: Record<string, Module[]>
) {
	// analyzeModuleGraph分析图，获取依赖模块和动态导入模块？
	const { dependentEntryPointsByModule, dynamicImportersByModule } = analyzeModuleGraph(
		entryModules
	);
	// 获取动态依赖模块入口点
	const dynamicDependentEntryPointsByDynamicEntry: DependentModuleMap = getDynamicDependentEntryPoints(
		dependentEntryPointsByModule,
		dynamicImportersByModule
	);
	const staticEntries = new Set(entryModules);

	function addColourToModuleDependencies(
		entry: Module,
		colour: Uint8Array,
		dynamicDependentEntryPoints: Set<Module> | null
	) {
		const manualChunkAlias = entry.manualChunkAlias;
		const modulesToHandle = new Set([entry]);
		for (const module of modulesToHandle) {
			if (manualChunkAlias) {
				// 这不多余吗？
				module.manualChunkAlias = manualChunkAlias;
				// 添加hash
				module.entryPointsHash = colour;
			} else if (
				dynamicDependentEntryPoints &&
				areEntryPointsContainedOrDynamicallyDependent(
					dynamicDependentEntryPoints,
					dependentEntryPointsByModule.get(module)!
				)
			) {
				continue;
			} else {
				// 重置hash
				Uint8ArrayXor(module.entryPointsHash, colour);
			}
			for (const dependency of module.dependencies) {
				// 将非外部依赖模块push到循环中，继续分析，可以不用递归了
				if (!(dependency instanceof ExternalModule || dependency.manualChunkAlias)) {
					modulesToHandle.add(dependency);
				}
			}
		}
	}

	function areEntryPointsContainedOrDynamicallyDependent(
		entryPoints: Set<Module>,
		superSet: Set<Module>
	): boolean {
		const entriesToCheck = new Set(entryPoints);
		for (const entry of entriesToCheck) {
			if (!superSet.has(entry)) {
				if (staticEntries.has(entry)) return false;
				const dynamicDependentEntryPoints = dynamicDependentEntryPointsByDynamicEntry.get(entry)!;
				for (const dependentEntry of dynamicDependentEntryPoints) {
					entriesToCheck.add(dependentEntry);
				}
			}
		}
		return true;
	}

	// 给每个入口模块都加上hash
	if (manualChunkModules) {
		for (const chunkName of Object.keys(manualChunkModules)) {
			const entryHash = randomUint8Array(10);

			for (const entry of manualChunkModules[chunkName]) {
				addColourToModuleDependencies(entry, entryHash, null);
			}
		}
	}

	for (const entry of entryModules) {
		if (!entry.manualChunkAlias) {
			const entryHash = randomUint8Array(10);
			addColourToModuleDependencies(entry, entryHash, null);
		}
	}

	for (const entry of dynamicImportersByModule.keys()) {
		if (!entry.manualChunkAlias) {
			const entryHash = randomUint8Array(10);
			addColourToModuleDependencies(
				entry,
				entryHash,
				dynamicDependentEntryPointsByDynamicEntry.get(entry)!
			);
		}
	}
}

function analyzeModuleGraph(
	entryModules: Module[]
): {
	dependentEntryPointsByModule: DependentModuleMap;
	dynamicImportersByModule: DependentModuleMap;
} {
	const dynamicImportersByModule: DependentModuleMap = new Map();
	const dependentEntryPointsByModule: DependentModuleMap = new Map();
	const entriesToHandle = new Set(entryModules);
	for (const currentEntry of entriesToHandle) {
		const modulesToHandle = new Set<Module>([currentEntry]);
		for (const module of modulesToHandle) {
			getDependentModules(dependentEntryPointsByModule, module).add(currentEntry);
			for (const dependency of module.dependencies) {
				if (!(dependency instanceof ExternalModule)) {
					modulesToHandle.add(dependency);
				}
			}
			for (const { resolution } of module.dynamicImports) {
				if (
					resolution instanceof Module &&
					resolution.dynamicallyImportedBy.length > 0 &&
					!resolution.manualChunkAlias
				) {
					getDependentModules(dynamicImportersByModule, resolution).add(module);
					entriesToHandle.add(resolution);
				}
			}
		}
	}
	return { dependentEntryPointsByModule, dynamicImportersByModule };
}

function getDependentModules(moduleMap: DependentModuleMap, module: Module): Set<Module> {
	const dependentModules = moduleMap.get(module) || new Set();
	moduleMap.set(module, dependentModules);
	return dependentModules;
}

function getDynamicDependentEntryPoints(
	dependentEntryPointsByModule: DependentModuleMap,
	dynamicImportersByModule: DependentModuleMap
): DependentModuleMap {
	const dynamicDependentEntryPointsByDynamicEntry: DependentModuleMap = new Map();
	for (const [dynamicEntry, importers] of dynamicImportersByModule.entries()) {
		const dynamicDependentEntryPoints = getDependentModules(
			dynamicDependentEntryPointsByDynamicEntry,
			dynamicEntry
		);
		for (const importer of importers) {
			for (const entryPoint of dependentEntryPointsByModule.get(importer)!) {
				dynamicDependentEntryPoints.add(entryPoint);
			}
		}
	}
	return dynamicDependentEntryPointsByDynamicEntry;
}
