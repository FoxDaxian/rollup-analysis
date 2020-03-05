import {
	InputOptions,
	OutputOptions,
	WarningHandler,
	WarningHandlerWithDefault
} from '../rollup/types';

export interface GenericConfigObject {
	[key: string]: unknown;
}

export interface CommandConfigObject {
	external: string[];
	globals: { [id: string]: string } | undefined;
	[key: string]: unknown;
}

const createGetOption = (config: GenericConfigObject, command: GenericConfigObject) => (
	name: string,
	defaultValue?: unknown
): any =>
	command[name] !== undefined
		? command[name]
		: config[name] !== undefined
		? config[name]
		: defaultValue;

const normalizeObjectOptionValue = (optionValue: any) => {
	if (!optionValue) {
		return optionValue;
	}
	if (typeof optionValue !== 'object') {
		return {};
	}
	return optionValue;
};

const getObjectOption = (
	config: GenericConfigObject,
	command: GenericConfigObject,
	name: string
) => {
	const commandOption = normalizeObjectOptionValue(command[name]);
	const configOption = normalizeObjectOptionValue(config[name]);
	if (commandOption !== undefined) {
		return commandOption && configOption ? { ...configOption, ...commandOption } : commandOption;
	}
	return configOption;
};

export function ensureArray<T>(items: (T | null | undefined)[] | T | null | undefined): T[] {
	if (Array.isArray(items)) {
		return items.filter(Boolean) as T[];
	}
	if (items) {
		return [items];
	}
	return [];
}

// 默认的onwarn处理器
const defaultOnWarn: WarningHandler = warning => {
	if (typeof warning === 'string') {
		console.warn(warning);
	} else {
		console.warn(warning.message);
	}
};

const getOnWarn = (
	config: GenericConfigObject,
	defaultOnWarnHandler: WarningHandler = defaultOnWarn
): WarningHandler =>
	config.onwarn
		? warning => (config.onwarn as WarningHandlerWithDefault)(warning, defaultOnWarnHandler)
		: defaultOnWarnHandler;

const getExternal = (config: GenericConfigObject, command: CommandConfigObject) => {
	const configExternal = config.external;
	return typeof configExternal === 'function'
		? (id: string, ...rest: string[]) =>
				configExternal(id, ...rest) || command.external.indexOf(id) !== -1
		: (typeof config.external === 'string'
				? [configExternal]
				: Array.isArray(configExternal)
				? configExternal
				: []
		  ).concat(command.external);
};

export const commandAliases: { [key: string]: string } = {
	c: 'config',
	d: 'dir',
	e: 'external',
	f: 'format',
	g: 'globals',
	h: 'help',
	i: 'input',
	m: 'sourcemap',
	n: 'name',
	o: 'file',
	p: 'plugin',
	v: 'version',
	w: 'watch'
};

export default function mergeOptions({
	config = {},
	// 改变command为rawCommandOptions，解构赋值的别名
	command: rawCommandOptions = {},
	// 默认的onwarn处理器
	defaultOnWarnHandler
}: {
	command?: GenericConfigObject;
	config: GenericConfigObject;
	defaultOnWarnHandler?: WarningHandler;
}): {
	inputOptions: InputOptions;
	optionError: string | null;
	outputOptions: any;
} {
	// 全局external和global全局相关配置
	const command = getCommandOptions(rawCommandOptions);
	// 获取具体的input配置信息
	const inputOptions = getInputOptions(config, command, defaultOnWarnHandler as WarningHandler);

	// 如果有output，就优先使用
	if (command.output) {
		Object.assign(command, command.output);
	}

	const output = config.output;
	// 返回output，默认是空数组
	const normalizedOutputOptions = Array.isArray(output) ? output : output ? [output] : [];
	// 如果没有传递output，给一个默认的{}
	if (normalizedOutputOptions.length === 0) normalizedOutputOptions.push({});
	// 迭代获取通用的output配置
	const outputOptions = normalizedOutputOptions.map(singleOutputOptions =>
		getOutputOptions(singleOutputOptions, command)
	);

	const unknownOptionErrors: string[] = [];
	const validInputOptions = Object.keys(inputOptions);

	// 验证传入的配置是否合法，并将非法的提示push到unknownOptionErrors中
	addUnknownOptionErrors(
		unknownOptionErrors,
		Object.keys(config),
		validInputOptions,
		'input option',
		/^output$/
	);

	const validOutputOptions = Object.keys(outputOptions[0]);
	// 和上面一样的操作
	addUnknownOptionErrors(
		unknownOptionErrors,
		outputOptions.reduce<string[]>((allKeys, options) => allKeys.concat(Object.keys(options)), []),
		validOutputOptions,
		'output option'
	);

	const validCliOutputOptions = validOutputOptions.filter(
		option => option !== 'sourcemapPathTransform'
	);
	// 过滤错误
	addUnknownOptionErrors(
		unknownOptionErrors,
		Object.keys(command),
		validInputOptions.concat(
			validCliOutputOptions,
			Object.keys(commandAliases),
			'config',
			'environment',
			'plugin',
			'silent',
			'stdin'
		),
		'CLI flag',
		/^_|output|(config.*)$/
	);

	// 返回 input 配置选项和 output 配置选项，并附加一段不支持属性的错误信息，以供提示
	return {
		inputOptions,
		optionError: unknownOptionErrors.length > 0 ? unknownOptionErrors.join('\n') : null,
		outputOptions
	};
}

function addUnknownOptionErrors(
	errors: string[],
	options: string[],
	validOptions: string[],
	optionType: string,
	ignoredKeys: RegExp = /$./
) {
	const validOptionSet = new Set(validOptions);
	const unknownOptions = options.filter(key => !validOptionSet.has(key) && !ignoredKeys.test(key));
	if (unknownOptions.length > 0)
		errors.push(
			`Unknown ${optionType}: ${unknownOptions.join(', ')}. Allowed options: ${Array.from(
				validOptionSet
			)
				.sort()
				.join(', ')}`
		);
}

function getCommandOptions(rawCommandOptions: GenericConfigObject): CommandConfigObject {
	const external =
		rawCommandOptions.external && typeof rawCommandOptions.external === 'string'
			? rawCommandOptions.external.split(',')
			: [];
	return {
		...rawCommandOptions,
		external,
		globals:
			typeof rawCommandOptions.globals === 'string'
				? rawCommandOptions.globals.split(',').reduce((globals, globalDefinition) => {
						const [id, variableName] = globalDefinition.split(':');
						globals[id] = variableName;
						if (external.indexOf(id) === -1) {
							external.push(id);
						}
						return globals;
				  }, Object.create(null))
				: undefined
	};
}

function getInputOptions(
	config: GenericConfigObject,
	command: CommandConfigObject = { external: [], globals: undefined },
	defaultOnWarnHandler: WarningHandler
): InputOptions {
	// 高阶函数，返回一个函数，在下面再次调用，获取想要的配置
	const getOption = createGetOption(config, command);
	const inputOptions: InputOptions = {
		acorn: config.acorn,
		acornInjectPlugins: config.acornInjectPlugins as any,
		cache: getOption('cache'),
		chunkGroupingSize: getOption('chunkGroupingSize', 5000),
		context: getOption('context'),
		experimentalCacheExpiry: getOption('experimentalCacheExpiry', 10),
		experimentalOptimizeChunks: getOption('experimentalOptimizeChunks'),
		external: getExternal(config, command) as any,
		inlineDynamicImports: getOption('inlineDynamicImports', false),
		input: getOption('input', []),
		manualChunks: getOption('manualChunks'),
		moduleContext: config.moduleContext as any,
		// 获取onwarn的时候，没有使用高阶函数getOption
		onwarn: getOnWarn(config, defaultOnWarnHandler),
		perf: getOption('perf', false),
		plugins: ensureArray(config.plugins as any),
		preserveModules: getOption('preserveModules'),
		preserveSymlinks: getOption('preserveSymlinks'),
		shimMissingExports: getOption('shimMissingExports'),
		strictDeprecations: getOption('strictDeprecations', false),
		treeshake: getObjectOption(config, command, 'treeshake'),
		watch: config.watch as any
	};

	// support rollup({ cache: prevBuildObject })
	if (inputOptions.cache && (inputOptions.cache as any).cache)
		inputOptions.cache = (inputOptions.cache as any).cache;

	return inputOptions;
}

function getOutputOptions(
	config: GenericConfigObject,
	command: GenericConfigObject = {}
): OutputOptions {
	const getOption = createGetOption(config, command);
	let format = getOption('format');

	// Handle format aliases
	switch (format) {
		case undefined:
		case 'esm':
		case 'module':
			format = 'es';
			break;
		case 'commonjs':
			format = 'cjs';
	}

	return {
		amd: { ...(config.amd as object), ...(command.amd as object) } as any,
		assetFileNames: getOption('assetFileNames'),
		banner: getOption('banner'),
		chunkFileNames: getOption('chunkFileNames'),
		compact: getOption('compact', false),
		dir: getOption('dir'),
		dynamicImportFunction: getOption('dynamicImportFunction'),
		entryFileNames: getOption('entryFileNames'),
		esModule: getOption('esModule', true),
		exports: getOption('exports'),
		extend: getOption('extend'),
		externalLiveBindings: getOption('externalLiveBindings', true),
		file: getOption('file'),
		footer: getOption('footer'),
		format,
		freeze: getOption('freeze', true),
		globals: getOption('globals'),
		hoistTransitiveImports: getOption('hoistTransitiveImports', true),
		indent: getOption('indent', true),
		interop: getOption('interop', true),
		intro: getOption('intro'),
		name: getOption('name'),
		namespaceToStringTag: getOption('namespaceToStringTag', false),
		noConflict: getOption('noConflict'),
		outro: getOption('outro'),
		paths: getOption('paths'),
		plugins: ensureArray(config.plugins as any),
		preferConst: getOption('preferConst'),
		sourcemap: getOption('sourcemap'),
		sourcemapExcludeSources: getOption('sourcemapExcludeSources'),
		sourcemapFile: getOption('sourcemapFile'),
		sourcemapPathTransform: getOption('sourcemapPathTransform'),
		strict: getOption('strict', true)
	};
}
