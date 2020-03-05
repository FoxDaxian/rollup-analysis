import MagicString from 'magic-string';
import { RenderOptions } from '../../utils/renderHelpers';
import { ObjectPath } from '../utils/PathTracker';
import { LiteralValueOrUnknown, UnknownValue } from '../values';
import * as NodeType from './NodeType';
import { ExpressionNode, NodeBase } from './shared/Node';
import TemplateElement from './TemplateElement';

export default class TemplateLiteral extends NodeBase {
	expressions!: ExpressionNode[];
	quasis!: TemplateElement[];
	type!: NodeType.tTemplateLiteral;

	getLiteralValueAtPath(path: ObjectPath): LiteralValueOrUnknown {
		if (path.length > 0 || this.quasis.length !== 1) {
			return UnknownValue;
		}
		return this.quasis[0].value.cooked;
	}

	render(code: MagicString, options: RenderOptions) {
		(code.indentExclusionRanges as [number, number][]).push([this.start, this.end] as [
			number,
			number
		]);
		super.render(code, options);
	}
}
