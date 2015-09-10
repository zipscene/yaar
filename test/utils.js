const expect = require('chai').expect;
const { runCallMiddleware } = require('../lib/utils');

describe('runCallMiddleware()', function() {
	it('should run pre-middleware until a result is returned', function() {
		let context = {};
		return runCallMiddleware();
	});
});
