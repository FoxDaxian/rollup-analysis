import { Entity } from '../Entity';

export const UnknownKey = Symbol('Unknown Key');
export type ObjectPathKey = string | typeof UnknownKey;

export type ObjectPath = ObjectPathKey[];
export const EMPTY_PATH: ObjectPath = [];
export const UNKNOWN_PATH: ObjectPath = [UnknownKey];

const EntitiesKey = Symbol('Entities');
interface EntityPaths {
	[EntitiesKey]: Set<Entity>;
	[UnknownKey]?: EntityPaths;
	[pathSegment: string]: EntityPaths;
}

export class PathTracker {
	// 创建一个对象，指定原型上的[EntitiesKey]属性的值为Set实例
	entityPaths: EntityPaths = Object.create(null, { [EntitiesKey]: { value: new Set<Entity>() } });

	getEntities(path: ObjectPath) {
		let currentPaths = this.entityPaths;
		// 循环path，判断currentPaths(Set)对象里有没有当前path，
		// 有的话直接赋值给 currentPaths 和 currentPaths[pathSegment]，没有的话就创建一个新的对象，和entityPaths初始化一样
		// currentPaths每次都会更新，代表当前path，结构为父子结构
		for (const pathSegment of path) {
			currentPaths = currentPaths[pathSegment] =
				currentPaths[pathSegment] ||
				Object.create(null, { [EntitiesKey]: { value: new Set<Entity>() } });
		}
		// 返回的是最后一个path的set值
		return currentPaths[EntitiesKey];
	}
}

export const SHARED_RECURSION_TRACKER = new PathTracker();
