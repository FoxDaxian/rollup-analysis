import { GenericEsTreeNode } from './nodes/shared/Node';

export const keys: {
	[name: string]: string[];
} = {
	Literal: [],
	Program: ['body']
};

export function getAndCreateKeys(esTreeNode: GenericEsTreeNode) {
	// 过滤esTreeNode上的非对象属性，然后统一赋值到keys上
	keys[esTreeNode.type] = Object.keys(esTreeNode).filter(
		key => typeof esTreeNode[key] === 'object'
	);
	// 返回
	return keys[esTreeNode.type];
}
