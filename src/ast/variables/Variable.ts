import ExternalModule from '../../ExternalModule';
import Module from '../../Module';
import { CallOptions } from '../CallOptions';
import { DeoptimizableEntity } from '../DeoptimizableEntity';
import { HasEffectsContext, InclusionContext } from '../ExecutionContext';
import Identifier from '../nodes/Identifier';
import { ExpressionEntity } from '../nodes/shared/Expression';
import { ExpressionNode } from '../nodes/shared/Node';
import SpreadElement from '../nodes/SpreadElement';
import { ObjectPath, PathTracker } from '../utils/PathTracker';
import { LiteralValueOrUnknown, UNKNOWN_EXPRESSION, UnknownValue } from '../values';

export default class Variable implements ExpressionEntity {
	alwaysRendered = false;
	exportName: string | null = null;
	included = false;
	isId = false;
	isNamespace?: boolean;
	isReassigned = false;
	module?: Module | ExternalModule;
	name: string;
	renderBaseName: string | null = null;
	renderName: string | null = null;
	safeExportName: string | null = null;

	constructor(name: string) {
		this.name = name;
	}

	/**
	 * Binds identifiers that reference this variable to this variable.
	 * Necessary to be able to change variable names.
	 */
	addReference(_identifier: Identifier) {}

	deoptimizePath(_path: ObjectPath) {}

	getBaseVariableName(): string {
		return this.renderBaseName || this.renderName || this.name;
	}

	getLiteralValueAtPath(
		_path: ObjectPath,
		_recursionTracker: PathTracker,
		_origin: DeoptimizableEntity
	): LiteralValueOrUnknown {
		return UnknownValue;
	}

	getName(): string {
		const name = this.renderName || this.name;
		return this.renderBaseName ? `${this.renderBaseName}${getPropertyAccess(name)}` : name;
	}

	getReturnExpressionWhenCalledAtPath(
		_path: ObjectPath,
		_recursionTracker: PathTracker,
		_origin: DeoptimizableEntity
	): ExpressionEntity {
		return UNKNOWN_EXPRESSION;
	}

	hasEffectsWhenAccessedAtPath(path: ObjectPath, _context: HasEffectsContext) {
		return path.length > 0;
	}

	hasEffectsWhenAssignedAtPath(_path: ObjectPath, _context: HasEffectsContext) {
		return true;
	}

	hasEffectsWhenCalledAtPath(
		_path: ObjectPath,
		_callOptions: CallOptions,
		_context: HasEffectsContext
	) {
		return true;
	}

	/**
	 * Marks this variable as being part of the bundle, which is usually the case when one of
	 * its identifiers becomes part of the bundle. Returns true if it has not been included
	 * previously.
	 * Once a variable is included, it should take care all its declarations are included.
	 */
	include(_context: InclusionContext) {
		this.included = true;
	}

	includeCallArguments(context: InclusionContext, args: (ExpressionNode | SpreadElement)[]): void {
		for (const arg of args) {
			arg.include(context, false);
		}
	}

	markCalledFromTryStatement() {}

	setRenderNames(baseName: string | null, name: string | null) {
		this.renderBaseName = baseName;
		this.renderName = name;
	}

	setSafeName(name: string | null) {
		this.renderName = name;
	}

	toString() {
		return this.name;
	}
}

const getPropertyAccess = (name: string) => {
	return /^(?!\d)[\w$]+$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
};
