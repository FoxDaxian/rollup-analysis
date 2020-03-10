import Module from '../Module';

function guessIndentString(code: string) {
	const lines = code.split('\n'); // 以换行符为标准进行分离代码

	const tabbed = lines.filter(line => /^\t+/.test(line)); // tab
	const spaced = lines.filter(line => /^ {2,}/.test(line)); // space

	if (tabbed.length === 0 && spaced.length === 0) {
		return null;
	}

	// More lines tabbed than spaced? Assume tabs, and
	// default to tabs in the case of a tie (or nothing
	// to go on)
	// 如果用tab的行数比space多，就用tab
	if (tabbed.length >= spaced.length) {
		return '\t';
	}

	// Otherwise, we need to guess the multiple
	// 找到用户的空格缩进数量
	const min = spaced.reduce((previous, current) => {
		const numSpaces = /^ +/.exec(current)![0].length; // 多少个空格啊
		return Math.min(numSpaces, previous); // 找最小的那个空格
	}, Infinity);

	return new Array(min + 1).join(' ');
}

// 猜缩进
export default function getIndentString(modules: Module[], options: { indent?: boolean }) {
	if (options.indent !== true) return options.indent || '';

	for (let i = 0; i < modules.length; i++) {
		const indent = guessIndentString(modules[i].originalCode);
		if (indent !== null) return indent;
	}

	return '\t';
}
