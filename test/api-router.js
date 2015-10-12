const { expect } = require('chai');
const { APIRouter, HTTPRPCInterface, JSONRPCInterface } = require('../lib');

let router;

// Setup express router
const setupRouter = () => {
	router = new APIRouter();

	router.version(1)
		.addInterface(new HTTPRPCInterface())
		.addInterface(new JSONRPCInterface());
};

describe('APIRouter', function() {
	beforeEach(setupRouter);

	it('#constructor', function() {
		expect(router.preRouter).to.be.a('function');
		expect(router.preRouter.name).to.equal('router');

		expect(router.versionsRouter).to.be.a('function');
		expect(router.versionsRouter.name).to.equal('router');

		expect(router.router).to.be.a('function');
		expect(router.router.name).to.equal('router');
	});

	it('should add versioned interfaces', function() {
		router.version(0);

		expect(Object.keys(router.versionRouters).length).to.equal(2);
		expect(router.versionRouters[0].version).to.equal(0);
		expect(router.versionRouters[0].interfaces).to.be.empty;
		expect(router.versionRouters[1].version).to.equal(1);
		expect(router.versionRouters[1].interfaces).to.have.length(2);
	});
});
