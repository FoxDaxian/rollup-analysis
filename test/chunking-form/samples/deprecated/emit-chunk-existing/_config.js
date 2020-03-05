module.exports = {
	description: 'allows adding modules already in the graph as entry points',
	options: {
		strictDeprecations: false,
		input: {
			'first-main': 'main1',
			'second-main': 'main2'
		},
		plugins: {
			buildStart() {
				// it should be possible to add existing entry points while not overriding their alias
				this.emitChunk('main1');

				// if an existing dependency is added, all references should use the new name
				this.emitChunk('dep.js');
				this.emitChunk('dep');
			}
		}
	}
};
