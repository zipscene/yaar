const expect = require('chai').expect;
const { expressionMatchesVersion } = require('../lib/version-match');

describe('Version Match', function() {

	it('truthy matches', function() {
		expect(expressionMatchesVersion('5', 5)).to.equal(true);
		expect(expressionMatchesVersion(5, 5)).to.equal(true);
		expect(expressionMatchesVersion('5+', 5)).to.equal(true);
		expect(expressionMatchesVersion('5+', 6)).to.equal(true);
		expect(expressionMatchesVersion('5-', 6)).to.equal(true);
		expect(expressionMatchesVersion('-5', 5)).to.equal(true);
		expect(expressionMatchesVersion('-5', 4)).to.equal(true);
		expect(expressionMatchesVersion('3-5', 3)).to.equal(true);
		expect(expressionMatchesVersion('3-5', 4)).to.equal(true);
		expect(expressionMatchesVersion('3-5', 5)).to.equal(true);
		expect(expressionMatchesVersion('1,2,4-6', 2)).to.equal(true);
		expect(expressionMatchesVersion('1,2,4-6', 5)).to.equal(true);
	});

	it('falsy matches', function() {
		expect(expressionMatchesVersion('6', 5)).to.equal(false);
		expect(expressionMatchesVersion(4, 5)).to.equal(false);
		expect(expressionMatchesVersion('5+', 4)).to.equal(false);
		expect(expressionMatchesVersion('5+', 1)).to.equal(false);
		expect(expressionMatchesVersion('5-', 4)).to.equal(false);
		expect(expressionMatchesVersion('-5', 6)).to.equal(false);
		expect(expressionMatchesVersion('-5', 7)).to.equal(false);
		expect(expressionMatchesVersion('3-5', 2)).to.equal(false);
		expect(expressionMatchesVersion('3-5', 6)).to.equal(false);
		expect(expressionMatchesVersion('1,2,4-6', 3)).to.equal(false);
		expect(expressionMatchesVersion('1,2,4-6', 7)).to.equal(false);
	});

	it('expression errors', function() {
		expect(() => expressionMatchesVersion(true, 1)).to.throw(Error);
		expect(() => expressionMatchesVersion(null, 1)).to.throw(Error);
		expect(() => expressionMatchesVersion('1a', 1)).to.throw(Error);
		expect(() => expressionMatchesVersion('5_7', 1)).to.throw(Error);
		expect(() => expressionMatchesVersion('a1', 1)).to.throw(Error);
	});

});


