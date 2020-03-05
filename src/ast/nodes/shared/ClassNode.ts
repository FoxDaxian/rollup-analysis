import { CallOptions } from '../../CallOptions';
import { HasEffectsContext } from '../../ExecutionContext';
import ChildScope from '../../scopes/ChildScope';
import Scope from '../../scopes/Scope';
import { ObjectPath } from '../../utils/PathTracker';
import ClassBody from '../ClassBody';
import Identifier from '../Identifier';
import { ExpressionNode, NodeBase } from './Node';

export default class ClassNode extends NodeBase {
	body!: ClassBody;
	id!: Identifier | null;
	superClass!: ExpressionNode | null;

	createScope(parentScope: Scope) {
		this.scope = new ChildScope(parentScope);
	}

	hasEffectsWhenAccessedAtPath(path: ObjectPath) {
		return path.length > 1;
	}

	hasEffectsWhenAssignedAtPath(path: ObjectPath) {
		return path.length > 1;
	}

	hasEffectsWhenCalledAtPath(
		path: ObjectPath,
		callOptions: CallOptions,
		context: HasEffectsContext
	) {
		if (!callOptions.withNew) return true;
		return (
			this.body.hasEffectsWhenCalledAtPath(path, callOptions, context) ||
			(this.superClass !== null &&
				this.superClass.hasEffectsWhenCalledAtPath(path, callOptions, context))
		);
	}

	initialise() {
		if (this.id !== null) {
			this.id.declare('class', this);
		}
	}
}
