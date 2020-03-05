import { AstContext } from '../../Module';
import Identifier from '../nodes/Identifier';
import { ExpressionEntity } from '../nodes/shared/Expression';
import LocalVariable from '../variables/LocalVariable';
import ParameterScope from './ParameterScope';

export default class CatchScope extends ParameterScope {
	addDeclaration(
		identifier: Identifier,
		context: AstContext,
		init: ExpressionEntity | null,
		isHoisted: boolean | 'function'
	): LocalVariable {
		if (isHoisted) {
			return this.parent.addDeclaration(identifier, context, init, isHoisted);
		} else {
			return super.addDeclaration(identifier, context, init, false);
		}
	}
}
