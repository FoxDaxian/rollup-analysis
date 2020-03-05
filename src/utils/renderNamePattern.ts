import { errFailedValidation, error } from './error';
import { extname } from './path';
import { isPlainPathFragment } from './relativeId';

export function renderNamePattern(
	pattern: string,
	patternName: string,
	replacements: { [name: string]: () => string }
) {
	if (!isPlainPathFragment(pattern))
		return error(
			errFailedValidation(
				`Invalid pattern "${pattern}" for "${patternName}", patterns can be neither absolute nor relative paths and must not contain invalid characters.`
			)
		);
	return pattern.replace(/\[(\w+)\]/g, (_match, type) => {
		if (!replacements.hasOwnProperty(type)) {
			return error(
				errFailedValidation(`"[${type}]" is not a valid placeholder in "${patternName}" pattern.`)
			);
		}
		const replacement = replacements[type]();
		if (!isPlainPathFragment(replacement))
			return error(
				errFailedValidation(
					`Invalid substitution "${replacement}" for placeholder "[${type}]" in "${patternName}" pattern, can be neither absolute nor relative path.`
				)
			);
		return replacement;
	});
}

export function makeUnique(name: string, existingNames: Record<string, any>) {
	const existingNamesLowercase = new Set(Object.keys(existingNames).map(key => key.toLowerCase()));
	if (!existingNamesLowercase.has(name.toLocaleLowerCase())) return name;

	const ext = extname(name);
	name = name.substr(0, name.length - ext.length);
	let uniqueName,
		uniqueIndex = 1;
	while (existingNamesLowercase.has((uniqueName = name + ++uniqueIndex + ext).toLowerCase()));
	return uniqueName;
}
