import { Plugin, ResolveIdHook } from '../rollup/types';
import { error } from './error';
import { lstatSync, readdirSync, readFile, realpathSync } from './fs';
import { basename, dirname, isAbsolute, resolve } from './path';

export function getRollupDefaultPlugin(preserveSymlinks: boolean): Plugin {
	return {
		name: 'Rollup Core',
		// 默认的模块(文件)加载机制
		resolveId: createResolveId(preserveSymlinks) as ResolveIdHook,
		load(id) {
			return readFile(id);
		},
		resolveFileUrl({ relativePath, format }) {
			// 不同format返回不同的文件解析地址
			return relativeUrlMechanisms[format](relativePath);
		},
		resolveImportMeta(prop, { chunkId, format }) {
			// 改变 获取import.meta的信息 的行为
			const mechanism = importMetaMechanisms[format] && importMetaMechanisms[format](prop, chunkId);
			if (mechanism) {
				return mechanism;
			}
		}
	};
}

function findFile(file: string, preserveSymlinks: boolean): string | void {
	try {
		const stats = lstatSync(file);
		if (!preserveSymlinks && stats.isSymbolicLink())
			return findFile(realpathSync(file), preserveSymlinks);
		if ((preserveSymlinks && stats.isSymbolicLink()) || stats.isFile()) {
			// check case
			const name = basename(file);
			const files = readdirSync(dirname(file));

			if (files.indexOf(name) !== -1) return file;
		}
	} catch (err) {
		// suppress
	}
}

function addJsExtensionIfNecessary(file: string, preserveSymlinks: boolean) {
	let found = findFile(file, preserveSymlinks);
	if (found) return found;
	found = findFile(file + '.mjs', preserveSymlinks);
	if (found) return found;
	found = findFile(file + '.js', preserveSymlinks);
	return found;
}

function createResolveId(preserveSymlinks: boolean) {
	return function(source: string, importer: string) {
		if (typeof process === 'undefined') {
			return error({
				code: 'MISSING_PROCESS',
				message: `It looks like you're using Rollup in a non-Node.js environment. This means you must supply a plugin with custom resolveId and load functions`,
				url: 'https://rollupjs.org/guide/en/#a-simple-example'
			});
		}

		// external modules (non-entry modules that start with neither '.' or '/')
		// are skipped at this stage.
		if (importer !== undefined && !isAbsolute(source) && source[0] !== '.') return null;

		// `resolve` processes paths from right to left, prepending them until an
		// absolute path is created. Absolute importees therefore shortcircuit the
		// resolve call and require no special handing on our part.
		// See https://nodejs.org/api/path.html#path_path_resolve_paths
		return addJsExtensionIfNecessary(
			resolve(importer ? dirname(importer) : resolve(), source),
			preserveSymlinks
		);
	};
}

const getResolveUrl = (path: string, URL = 'URL') => `new ${URL}(${path}).href`;

const getUrlFromDocument = (chunkId: string) =>
	`(document.currentScript && document.currentScript.src || new URL('${chunkId}', document.baseURI).href)`;

const getGenericImportMetaMechanism = (getUrl: (chunkId: string) => string) => (
	prop: string | null,
	chunkId: string
) => {
	const urlMechanism = getUrl(chunkId);
	return prop === null ? `({ url: ${urlMechanism} })` : prop === 'url' ? urlMechanism : 'undefined';
};

const importMetaMechanisms: Record<string, (prop: string | null, chunkId: string) => string> = {
	amd: getGenericImportMetaMechanism(() => getResolveUrl(`module.uri, document.baseURI`)),
	cjs: getGenericImportMetaMechanism(
		chunkId =>
			`(typeof document === 'undefined' ? ${getResolveUrl(
				`'file:' + __filename`,
				`(require('u' + 'rl').URL)`
			)} : ${getUrlFromDocument(chunkId)})`
	),
	iife: getGenericImportMetaMechanism(chunkId => getUrlFromDocument(chunkId)),
	system: prop => (prop === null ? `module.meta` : `module.meta.${prop}`),
	umd: getGenericImportMetaMechanism(
		chunkId =>
			`(typeof document === 'undefined' ? ${getResolveUrl(
				`'file:' + __filename`,
				`(require('u' + 'rl').URL)`
			)} : ${getUrlFromDocument(chunkId)})`
	)
};

const getRelativeUrlFromDocument = (relativePath: string) =>
	getResolveUrl(
		`'${relativePath}', document.currentScript && document.currentScript.src || document.baseURI`
	);

const relativeUrlMechanisms: Record<string, (relativePath: string) => string> = {
	amd: relativePath => {
		if (relativePath[0] !== '.') relativePath = './' + relativePath;
		return getResolveUrl(`require.toUrl('${relativePath}'), document.baseURI`);
	},
	cjs: relativePath =>
		`(typeof document === 'undefined' ? ${getResolveUrl(
			`'file:' + __dirname + '/${relativePath}'`,
			`(require('u' + 'rl').URL)`
		)} : ${getRelativeUrlFromDocument(relativePath)})`,
	es: relativePath => getResolveUrl(`'${relativePath}', import.meta.url`),
	iife: relativePath => getRelativeUrlFromDocument(relativePath),
	system: relativePath => getResolveUrl(`'${relativePath}', module.meta.url`),
	umd: relativePath =>
		`(typeof document === 'undefined' ? ${getResolveUrl(
			`'file:' + __dirname + '/${relativePath}'`,
			`(require('u' + 'rl').URL)`
		)} : ${getRelativeUrlFromDocument(relativePath)})`
};

export const accessedMetaUrlGlobals = {
	amd: ['document', 'module', 'URL'],
	cjs: ['document', 'require', 'URL'],
	iife: ['document', 'URL'],
	system: ['module'],
	umd: ['document', 'require', 'URL']
};

export const accessedFileUrlGlobals = {
	amd: ['document', 'require', 'URL'],
	cjs: ['document', 'require', 'URL'],
	iife: ['document', 'URL'],
	system: ['module', 'URL'],
	umd: ['document', 'require', 'URL']
};
