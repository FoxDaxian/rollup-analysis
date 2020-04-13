import { locate } from 'locate-character';
import MagicString from 'magic-string';
import { AstContext, CommentDescription } from '../../../Module';
import { NodeRenderOptions, RenderOptions } from '../../../utils/renderHelpers';
import { CallOptions } from '../../CallOptions';
import { DeoptimizableEntity } from '../../DeoptimizableEntity';
import { Entity } from '../../Entity';
import {
	createHasEffectsContext,
	HasEffectsContext,
	InclusionContext
} from '../../ExecutionContext';
// keys 初始是这样的
// {
// 	Literal: [],
// 	Program: ['body']
// };
import { getAndCreateKeys, keys } from '../../keys';
import ChildScope from '../../scopes/ChildScope';
import { ObjectPath, PathTracker } from '../../utils/PathTracker';
import { LiteralValueOrUnknown, UNKNOWN_EXPRESSION, UnknownValue } from '../../values';
import LocalVariable from '../../variables/LocalVariable';
import Variable from '../../variables/Variable';
import SpreadElement from '../SpreadElement';
import { ExpressionEntity } from './Expression';

export interface GenericEsTreeNode {
	type: string;
	[key: string]: any;
}

export const INCLUDE_PARAMETERS: 'variables' = 'variables';
export type IncludeChildren = boolean | typeof INCLUDE_PARAMETERS;

export interface Node extends Entity {
	annotations?: CommentDescription[];
	context: AstContext;
	end: number;
	included: boolean;
	keys: string[];
	needsBoundaries?: boolean;
	parent: Node | { type?: string };
	preventChildBlockScope?: boolean;
	start: number;
	type: string;
	variable?: Variable | null;

	/**
	 * Called once all nodes have been initialised and the scopes have been populated.
	 */
	bind(): void;

	/**
	 * Declare a new variable with the optional initialisation.
	 */
	declare(kind: string, init: ExpressionEntity | null): LocalVariable[];

	/**
	 * Determine if this Node would have an effect on the bundle.
	 * This is usually true for already included nodes. Exceptions are e.g. break statements
	 * which only have an effect if their surrounding loop or switch statement is included.
	 * The options pass on information like this about the current execution path.
	 */
	hasEffects(context: HasEffectsContext): boolean;

	/**
	 * Includes the node in the bundle. If the flag is not set, children are usually included
	 * if they are necessary for this node (e.g. a function body) or if they have effects.
	 * Necessary variables need to be included as well.
	 */
	include(context: InclusionContext, includeChildrenRecursively: IncludeChildren): void;

	/**
	 * Alternative version of include to override the default behaviour of
	 * declarations to only include nodes for declarators that have an effect. Necessary
	 * for for-loops that do not use a declared loop variable.
	 */
	includeWithAllDeclaredVariables(
		includeChildrenRecursively: IncludeChildren,
		context: InclusionContext
	): void;
	render(code: MagicString, options: RenderOptions, nodeRenderOptions?: NodeRenderOptions): void;

	/**
	 * Start a new execution path to determine if this node has an effect on the bundle and
	 * should therefore be included. Included nodes should always be included again in subsequent
	 * visits as the inclusion of additional variables may require the inclusion of more child
	 * nodes in e.g. block statements.
	 */
	shouldBeIncluded(context: InclusionContext): boolean;
}

export interface StatementNode extends Node {}

export interface ExpressionNode extends ExpressionEntity, Node {}

export class NodeBase implements ExpressionNode {
	context: AstContext;
	end!: number;
	included = false; // 默认没有被引入，可以shaking
	keys: string[];
	parent: Node | { context: AstContext; type: string };
	scope!: ChildScope;
	start!: number;
	type!: string;

	constructor(
		esTreeNode: GenericEsTreeNode,
		parent: Node | { context: AstContext; type: string },
		parentScope: ChildScope
	) {
		// 参考这个网站转义的结果：https://astexplorer.net/
		// type为当前整个estree的类型
		// keys是对象，别看岔了！！！
		// getAndCreateKeys用来递归esTreeNode对象上的所有节点的type，并赋值给keys
		// keys = {
		// 	Literal: [],
		// 	Program: ['body']
		// }
		this.keys = keys[esTreeNode.type] || getAndCreateKeys(esTreeNode);
		this.parent = parent;
		this.context = parent.context;
		this.createScope(parentScope); // 设置当前语法树的作用域，类似原型链，可以根据这个一直查找
		// 语法node解析工作，判断各个类型的value，然后再new Programe
		// 将ast的所有属性解析(不只获取，还进行了各类型的new nodeType操作)，然挂载到实例上(new Program)上
		// 并且，之后每一个 ast node type 初始的include都是false
		// 基础解析方法 parseNode，在每次new 的时候都会调用  => 递归
		this.parseNode(esTreeNode);
		// 被子类重写了
		this.initialise();
		// 这时候，当前实例(this)上就有了ast tree的start和end属性
		// 添加字符索引到source map？
		this.context.magicString.addSourcemapLocation(this.start);
		this.context.magicString.addSourcemapLocation(this.end);
	}

	/**
	 * Override this to bind assignments to variables and do any initialisations that
	 * require the scopes to be populated with variables.
	 */
	bind() {
		for (const key of this.keys) {
			// 获取ast上的每一个属性
			const value = (this as GenericEsTreeNode)[key];
			// 不能为null或者类型注解
			if (value === null || key === 'annotations') continue;
			if (Array.isArray(value)) {
				for (const child of value) {
					// 各ast node type上实现的bind方法
					if (child !== null) child.bind();
				}
			} else {
				value.bind();
			}
		}
	}

	/**
	 * Override if this node should receive a different scope than the parent scope.
	 */
	createScope(parentScope: ChildScope) {
		this.scope = parentScope;
	}

	declare(_kind: string, _init: ExpressionEntity | null): LocalVariable[] {
		return [];
	}

	deoptimizePath(_path: ObjectPath) {}

	getLiteralValueAtPath(
		_path: ObjectPath,
		_recursionTracker: PathTracker,
		_origin: DeoptimizableEntity
	): LiteralValueOrUnknown {
		return UnknownValue;
	}

	getReturnExpressionWhenCalledAtPath(
		_path: ObjectPath,
		_recursionTracker: PathTracker,
		_origin: DeoptimizableEntity
	): ExpressionEntity {
		return UNKNOWN_EXPRESSION;
	}

	// 不同的 ast 节点类型有他们自己的副作用，有的有，有的没有
	hasEffects(context: HasEffectsContext): boolean {
		for (const key of this.keys) {
			const value = (this as GenericEsTreeNode)[key];
			if (value === null || key === 'annotations') continue;
			if (Array.isArray(value)) {
				for (const child of value) {
					if (child !== null && child.hasEffects(context)) return true;
				}
			} else if (value.hasEffects(context)) return true;
		}
		return false;
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

	include(context: InclusionContext, includeChildrenRecursively: IncludeChildren) {
		this.included = true;
		// 将内容全都设置为include
		for (const key of this.keys) {
			const value = (this as GenericEsTreeNode)[key];
			if (value === null || key === 'annotations') continue;
			if (Array.isArray(value)) {
				for (const child of value) {
					if (child !== null) child.include(context, includeChildrenRecursively);
				}
			} else {
				value.include(context, includeChildrenRecursively);
			}
		}
	}

	includeCallArguments(context: InclusionContext, args: (ExpressionNode | SpreadElement)[]): void {
		for (const arg of args) {
			arg.include(context, false);
		}
	}

	includeWithAllDeclaredVariables(
		includeChildrenRecursively: IncludeChildren,
		context: InclusionContext
	) {
		this.include(context, includeChildrenRecursively);
	}

	/**
	 * Override to perform special initialisation steps after the scope is initialised
	 */
	initialise() {}

	insertSemicolon(code: MagicString) {
		if (code.original[this.end - 1] !== ';') {
			code.appendLeft(this.end, ';');
		}
	}

	locate() {
		// useful for debugging
		const location = locate(this.context.code, this.start, { offsetLine: 1 });
		location.file = this.context.fileName;
		location.toString = () => JSON.stringify(location);

		return location;
	}

	parseNode(esTreeNode: GenericEsTreeNode) {
		// 就是遍历，然后new nodeType，然后挂载到实例上
		for (const key of Object.keys(esTreeNode)) {
			// That way, we can override this function to add custom initialisation and then call super.parseNode
			// this 指向 Program构造类，通过new创建的
			// 如果program上有的话，那么跳过
			if (this.hasOwnProperty(key)) continue;
			// ast tree上的每一个属性
			const value = esTreeNode[key];
			// 不等于对象或者null或者key是annotations
			// annotations是type
			if (typeof value !== 'object' || value === null || key === 'annotations') {
				(this as GenericEsTreeNode)[key] = value;
			} else if (Array.isArray(value)) {
				// 如果是数组，那么创建数组并遍历上去
				(this as GenericEsTreeNode)[key] = [];
				// this.context.nodeConstructors 针对不同的语法书类型，进行不同的操作，比如挂载依赖等等
				for (const child of value) {
					// 循环然后各种new 各种类型的node，都是继成的NodeBase
					(this as GenericEsTreeNode)[key].push(
						child === null
							? null
							: new (this.context.nodeConstructors[child.type] ||
									this.context.nodeConstructors.UnknownNode)(child, this, this.scope) // 处理各种ast类型
					);
				}
			} else {
				// 以上都不是的情况下，直接new
				(this as GenericEsTreeNode)[key] = new (this.context.nodeConstructors[value.type] ||
					this.context.nodeConstructors.UnknownNode)(value, this, this.scope);
			}
		}
	}

	render(code: MagicString, options: RenderOptions) {
		for (const key of this.keys) {
			const value = (this as GenericEsTreeNode)[key];
			if (value === null || key === 'annotations') continue;
			if (Array.isArray(value)) {
				for (const child of value) {
					if (child !== null) child.render(code, options);
				}
			} else {
				// 调用不同ast type node提供的render方法，并对code(调用magicString提供的方法)进行重写覆盖
				value.render(code, options);
			}
		}
	}

	shouldBeIncluded(context: InclusionContext): boolean {
		// 整体已经inclued了，或者初始化并且有副作用
		return this.included || (!context.brokenFlow && this.hasEffects(createHasEffectsContext()));
	}

	toString() {
		return this.context.code.slice(this.start, this.end);
	}
}

export { NodeBase as StatementBase };
