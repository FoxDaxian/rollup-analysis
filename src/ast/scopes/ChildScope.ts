import { getSafeName } from '../../utils/safeName';
import ImportExpression from '../nodes/ImportExpression';
import { ExpressionEntity } from '../nodes/shared/Expression';
import Variable from '../variables/Variable';
import Scope from './Scope';

export default class ChildScope extends Scope {
	accessedDynamicImports?: Set<ImportExpression>;
	accessedGlobalVariablesByFormat?: Map<string, Set<string>>;
	accessedOutsideVariables = new Map<string, Variable>();
	parent: Scope;

	constructor(parent: Scope) {
		super();
		this.parent = parent;
		parent.children.push(this);
	}

	addAccessedDynamicImport(importExpression: ImportExpression) {
		(this.accessedDynamicImports || (this.accessedDynamicImports = new Set())).add(
			importExpression
		);
		if (this.parent instanceof ChildScope) {
			this.parent.addAccessedDynamicImport(importExpression);
		}
	}

	addAccessedGlobalsByFormat(globalsByFormat: { [format: string]: string[] }) {
		const accessedGlobalVariablesByFormat =
			this.accessedGlobalVariablesByFormat || (this.accessedGlobalVariablesByFormat = new Map());
		for (const format of Object.keys(globalsByFormat)) {
			let accessedGlobalVariables = accessedGlobalVariablesByFormat.get(format);
			if (!accessedGlobalVariables) {
				accessedGlobalVariables = new Set();
				accessedGlobalVariablesByFormat.set(format, accessedGlobalVariables);
			}
			for (const name of globalsByFormat[format]) {
				accessedGlobalVariables.add(name);
			}
		}
		if (this.parent instanceof ChildScope) {
			this.parent.addAccessedGlobalsByFormat(globalsByFormat);
		}
	}

	addNamespaceMemberAccess(name: string, variable: Variable) {
		this.accessedOutsideVariables.set(name, variable);
		(this.parent as ChildScope).addNamespaceMemberAccess(name, variable);
	}

	addReturnExpression(expression: ExpressionEntity) {
		this.parent instanceof ChildScope && this.parent.addReturnExpression(expression);
	}

	addUsedOutsideNames(usedNames: Set<string>, format: string): void {
		for (const variable of this.accessedOutsideVariables.values()) {
			if (variable.included) {
				usedNames.add(variable.getBaseVariableName());
				if (variable.exportName && format === 'system') {
					usedNames.add('exports');
				}
			}
		}
		const accessedGlobalVariables =
			this.accessedGlobalVariablesByFormat && this.accessedGlobalVariablesByFormat.get(format);
		if (accessedGlobalVariables) {
			for (const name of accessedGlobalVariables) {
				usedNames.add(name);
			}
		}
	}

	contains(name: string): boolean {
		return this.variables.has(name) || this.parent.contains(name);
	}

	deconflict(format: string) {
		const usedNames = new Set<string>();
		this.addUsedOutsideNames(usedNames, format);
		if (this.accessedDynamicImports) {
			for (const importExpression of this.accessedDynamicImports) {
				if (importExpression.inlineNamespace) {
					usedNames.add(importExpression.inlineNamespace.getBaseVariableName());
				}
			}
		}
		for (const [name, variable] of this.variables) {
			if (variable.included || variable.alwaysRendered) {
				variable.setSafeName(getSafeName(name, usedNames));
			}
		}
		for (const scope of this.children) {
			scope.deconflict(format);
		}
	}

	findLexicalBoundary(): ChildScope {
		return (this.parent as ChildScope).findLexicalBoundary();
	}

	findVariable(name: string): Variable {
		const knownVariable = this.variables.get(name) || this.accessedOutsideVariables.get(name);
		if (knownVariable) {
			return knownVariable;
		}
		const variable = this.parent.findVariable(name);
		this.accessedOutsideVariables.set(name, variable);
		return variable;
	}
}
