import { HasEffectsContext } from '../ExecutionContext';
import { EMPTY_PATH, ObjectPath } from '../utils/PathTracker';
import Variable from '../variables/Variable';
import * as NodeType from './NodeType';
import Property from './Property';
import RestElement from './RestElement';
import { ExpressionEntity } from './shared/Expression';
import { NodeBase } from './shared/Node';
import { PatternNode } from './shared/Pattern';

export default class ObjectPattern extends NodeBase implements PatternNode {
	properties!: (Property | RestElement)[];
	type!: NodeType.tObjectPattern;

	addExportedVariables(variables: Variable[]): void {
		for (const property of this.properties) {
			if (property.type === NodeType.Property) {
				((property.value as unknown) as PatternNode).addExportedVariables(variables);
			} else {
				property.argument.addExportedVariables(variables);
			}
		}
	}

	declare(kind: string, init: ExpressionEntity) {
		const variables = [];
		for (const property of this.properties) {
			variables.push(...property.declare(kind, init));
		}
		return variables;
	}

	deoptimizePath(path: ObjectPath) {
		if (path.length === 0) {
			for (const property of this.properties) {
				property.deoptimizePath(path);
			}
		}
	}

	hasEffectsWhenAssignedAtPath(path: ObjectPath, context: HasEffectsContext) {
		if (path.length > 0) return true;
		for (const property of this.properties) {
			if (property.hasEffectsWhenAssignedAtPath(EMPTY_PATH, context)) return true;
		}
		return false;
	}
}
