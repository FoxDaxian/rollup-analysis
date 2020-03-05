import ArrayExpression from './ArrayExpression';
import ArrayPattern from './ArrayPattern';
import ArrowFunctionExpression from './ArrowFunctionExpression';
import AssignmentExpression from './AssignmentExpression';
import AssignmentPattern from './AssignmentPattern';
import AwaitExpression from './AwaitExpression';
import BinaryExpression from './BinaryExpression';
import BlockStatement from './BlockStatement';
import BreakStatement from './BreakStatement';
import CallExpression from './CallExpression';
import CatchClause from './CatchClause';
import ClassBody from './ClassBody';
import ClassDeclaration from './ClassDeclaration';
import ClassExpression from './ClassExpression';
import ConditionalExpression from './ConditionalExpression';
import ContinueStatement from './ContinueStatement';
import DoWhileStatement from './DoWhileStatement';
import EmptyStatement from './EmptyStatement';
import ExportAllDeclaration from './ExportAllDeclaration';
import ExportDefaultDeclaration from './ExportDefaultDeclaration';
import ExportNamedDeclaration from './ExportNamedDeclaration';
import ExpressionStatement from './ExpressionStatement';
import ForInStatement from './ForInStatement';
import ForOfStatement from './ForOfStatement';
import ForStatement from './ForStatement';
import FunctionDeclaration from './FunctionDeclaration';
import FunctionExpression from './FunctionExpression';
import Identifier from './Identifier';
import IfStatement from './IfStatement';
import ImportDeclaration from './ImportDeclaration';
import ImportExpression from './ImportExpression';
import LabeledStatement from './LabeledStatement';
import Literal from './Literal';
import LogicalExpression from './LogicalExpression';
import MemberExpression from './MemberExpression';
import MetaProperty from './MetaProperty';
import MethodDefinition from './MethodDefinition';
import NewExpression from './NewExpression';
import ObjectExpression from './ObjectExpression';
import ObjectPattern from './ObjectPattern';
import Program from './Program';
import Property from './Property';
import RestElement from './RestElement';
import ReturnStatement from './ReturnStatement';
import SequenceExpression from './SequenceExpression';
import { NodeBase } from './shared/Node';
import SpreadElement from './SpreadElement';
import SwitchCase from './SwitchCase';
import SwitchStatement from './SwitchStatement';
import TaggedTemplateExpression from './TaggedTemplateExpression';
import TemplateElement from './TemplateElement';
import TemplateLiteral from './TemplateLiteral';
import ThisExpression from './ThisExpression';
import ThrowStatement from './ThrowStatement';
import TryStatement from './TryStatement';
import UnaryExpression from './UnaryExpression';
import UnknownNode from './UnknownNode';
import UpdateExpression from './UpdateExpression';
import VariableDeclaration from './VariableDeclaration';
import VariableDeclarator from './VariableDeclarator';
import WhileStatement from './WhileStatement';
import YieldExpression from './YieldExpression';

export const nodeConstructors: {
	[name: string]: typeof NodeBase;
} = {
	ArrayExpression,
	ArrayPattern,
	ArrowFunctionExpression,
	AssignmentExpression,
	AssignmentPattern,
	AwaitExpression,
	BinaryExpression,
	BlockStatement,
	BreakStatement,
	CallExpression,
	CatchClause,
	ClassBody,
	ClassDeclaration,
	ClassExpression,
	ConditionalExpression,
	ContinueStatement,
	DoWhileStatement,
	EmptyStatement,
	ExportAllDeclaration,
	ExportDefaultDeclaration,
	ExportNamedDeclaration,
	ExpressionStatement,
	ForInStatement,
	ForOfStatement,
	ForStatement,
	FunctionDeclaration,
	FunctionExpression,
	Identifier,
	IfStatement,
	ImportDeclaration,
	ImportExpression,
	LabeledStatement,
	Literal,
	LogicalExpression,
	MemberExpression,
	MetaProperty,
	MethodDefinition,
	NewExpression,
	ObjectExpression,
	ObjectPattern,
	Program,
	Property,
	RestElement,
	ReturnStatement,
	SequenceExpression,
	SpreadElement,
	SwitchCase,
	SwitchStatement,
	TaggedTemplateExpression,
	TemplateElement,
	TemplateLiteral,
	ThisExpression,
	ThrowStatement,
	TryStatement,
	UnaryExpression,
	UnknownNode,
	UpdateExpression,
	VariableDeclaration,
	VariableDeclarator,
	WhileStatement,
	YieldExpression
};
