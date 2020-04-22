// Copyright 2016 Zipscene, LLC
// Licensed under the Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0

const supertest = require('supertest');
const express = require('express');
const _ = require('lodash');
const chai = require('chai');
const { expect } = chai;
const sinon = require('sinon');
const sinonChai = require('sinon-chai');
const XError = require('xerror');
const { createSchema } = require('common-schema');
const { APIRouter, RESTSimpleInterface } = require('../lib');
const zstreams = require('zstreams');
const pasync = require('pasync');
const http = require('http');
const request = require('request');
chai.use(sinonChai);

let app, router, superRequest, server;

// Setup express router
const setupRouter = () => {
	app = express();
	router = new APIRouter();
	superRequest = supertest(app);
	server = null;
	app.use(router.getExpressRouter());

	router.version(1).addInterface(new RESTSimpleInterface());

	router.registerAPIInfoRoute();
};

const testrest = (verb, qstring, body, expectedResponse, expectedCode = 200) => {
	return new Promise((resolve, reject) => {
		verb = verb.toLowerCase();
		let c = superRequest[verb](qstring);
		if (verb === 'post' || verb === 'put') {
			c = c.send(body || {});
		}
		c = c.expect(expectedCode);
		if (typeof expectedResponse !== 'function') {
			c = c.expect(expectedResponse);
		}
		c.end((err, res) => {
			if (err) return reject(err);
			if (typeof expectedResponse === 'function') {
				try {
					expectedResponse(res.body);
				} catch (err) {
					return reject(err);
				}
			}
			resolve();
		});
	});
};

const registerMockModel = (opts = {}) => {
	let { nkeys, name, error } = _.defaults(opts, {
		nkeys: 1,
		name: 'model',
		error: false
	});
	let keys = [];
	for (let i = 0; i < nkeys; i++) {
		keys.push('key' + i);
	}
	let mockModel = {
		getKeys() {
			return keys;
		},
		getName() {
			return name;
		},
		name: name
	};

	router.register({
		method: name + '.get',
		description: 'Model get',
		model: mockModel,
		schema: createSchema('mixed')
	}, (ctx) => {
		if (error) {
			throw new XError(XError.NOT_FOUND, 'Not found error');
		} else {
			return {
				foo: 'bar',
				params: ctx.params
			};
		}
	});

	router.register({
		method: name + '.query',
		description: 'Model query',
		model: mockModel,
		schema: createSchema('mixed')
	}, (ctx) => {
		if (error) {
			throw new XError(XError.NOT_FOUND, 'Not found error');
		} else {
			return {
				results: [ { foo: 'bar' } ]
			};
		}
	});

	router.register({
		method: name + '.put',
		description: 'Model put',
		model: mockModel,
		schema: createSchema('mixed')
	}, (ctx) => {
		if (error) {
			throw new XError(XError.NOT_FOUND, 'Not found error');
		} else {
			return {
				foo: 'bar',
				params: ctx.params
			};
		}
	});

	router.register({
		method: name + '.delete',
		description: 'Model delete',
		model: mockModel,
		schema: createSchema('mixed')
	}, (ctx) => {
		if (error) {
			throw new XError(XError.NOT_FOUND, 'Not found error');
		} else {
			return {
				foo: 'bar',
				params: ctx.params
			};
		}
	});

};

describe('RESTSimpleInterface', function() {
	beforeEach(setupRouter);

	afterEach(function(done) {
		if (server) {
			server.close(done);
		} else {
			done();
		}
	});

	it('get object verb', function() {
		registerMockModel();
		return testrest('get', '/v1/rest/model/myid', null, (res) => {
			expect(res.foo).to.equal('bar');
			expect(res.params.keys.key0).to.equal('myid');
		});
	});

	it('get method call', function() {
		registerMockModel();
		return testrest('post', '/v1/rest/model/get', {
			keys: {
				key0: 'myid'
			}
		}, (res) => {
			expect(res.foo).to.equal('bar');
			expect(res.params.keys.key0).to.equal('myid');
		});
	});

	it('get object root verb', function() {
		registerMockModel();
		return testrest('get', '/v1/rest/model', null, (res) => {
			expect(Array.isArray(res.results));
			expect(res.results[0].foo).to.equal('bar');
		});
	});

	it('query method call', function() {
		registerMockModel();
		return testrest('post', '/v1/rest/model/query', {
			query: {
				key0: 'myid'
			}
		}, (res) => {
			expect(Array.isArray(res.results));
			expect(res.results[0].foo).to.equal('bar');
		});
	});

	it('get object verb w/ error', function() {
		registerMockModel({ error: true });
		return testrest('get', '/v1/rest/model/myid', null, (res) => {
			expect(res.code).to.equal('not_found');
		}, 404);
	});

	it('get method call w/ error', function() {
		registerMockModel({ error: true });
		return testrest('post', '/v1/rest/model/get', {
			keys: {
				key0: 'myid'
			}
		}, (res) => {
			expect(res.code).to.equal('not_found');
		}, 404);
	});

	it('get object verb w/ multiple keys', function() {
		registerMockModel({ nkeys: 2 });
		return testrest('get', '/v1/rest/model/myid1/myid2', null, (res) => {
			expect(res.foo).to.equal('bar');
			expect(res.params.keys.key0).to.equal('myid1');
			expect(res.params.keys.key1).to.equal('myid2');
		});
	});

	it('get object verb w/ fields', function() {
		registerMockModel();
		return testrest('get', '/v1/rest/model/myid?fields=["a","b"]', null, (res) => {
			expect(res.foo).to.equal('bar');
			expect(res.params.keys.key0).to.equal('myid');
			expect(res.params.fields).to.deep.equal([ 'a', 'b' ]);
		});
	});

	it('put object verb', function() {
		registerMockModel();
		return testrest('put', '/v1/rest/model/myid', {
			zip: 'zap'
		}, (res) => {
			expect(res.foo).to.equal('bar');
			expect(res.params.data.key0).to.equal('myid');
			expect(res.params.data.zip).to.equal('zap');
		});
	});

	it('delete object verb', function() {
		registerMockModel();
		return testrest('delete', '/v1/rest/model/myid', null, (res) => {
			expect(res.foo).to.equal('bar');
			expect(res.params.query.key0).to.equal('myid');
		});
	});

	it('manual rest route', function() {
		router.register({
			method: 'foo.bar',
			schema: createSchema({
				foo: String,
				bar: String,
				baz: String
			}),
			rest: {
				verb: 'POST',
				route: '/foobar/:baz',
				params: [ 'route', 'body', 'qs' ]
			}
		}, (ctx) => {
			return ctx.params;
		});
		return testrest('post', '/v1/rest/foobar/xyz?foo=abc', { bar: 'fgh' }, (res) => {
			expect(res.foo).to.equal('abc');
			expect(res.bar).to.equal('fgh');
			expect(res.baz).to.equal('xyz');
		});
	});


});


