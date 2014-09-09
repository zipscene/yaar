var express = require('express');
var ZSError = require('zs-error');
var transformError = require('./error-transform');
var parseRegisterArgs = require('./parse-register-args');

function RestRouter(options) {
	if(!options) options = {};

	function jsonStringify(val) {
		if(options.prettyJSON) {
			return JSON.stringify(val, null, '\t');
		} else {
			return JSON.stringify(val);
		}
	}

	// Create an express router to use for the actual REST API call routes
	this.apiCallRouter = express.Router({
		caseSensitive: true,
		strict: true
	});

	// Create an express router to use for postprocessing API errors
	this.postAPIRouter = express.Router({});

	// This express router wraps the other sub-routers for REST
	this.mainRouter = express.Router({
		caseSensitive: true,
		strict: true
	});

	// Set up the request and response objects as a REST API request/response
	this.mainRouter.use(function(req, res, next) {
		// Always return JSON
		res.set('Content-type', 'application/json');

		var key;
		var params = {};
		if(req.params && typeof req.params == 'object') {
			for(key in req.params) {
				params[key] = req.params[key];
			}
		}
		if(req.query && typeof req.query == 'object') {
			for(key in req.query) {
				params[key] = req.query[key];
			}
		}
		if(req.body && typeof req.body == 'object') {
			for(key in req.body) {
				params[key] = req.body[key];
			}
		}

		// Redefine the req.param method to pull from REST parameters
		req.origParam = req.param;
		req.param = function(name) {
			return params[name];
		};

		req.getAllParams = function() {
			return params;
		};

		// Set a res.result method to return a result
		res.result = function(result) {
			if(result === undefined) result = { success: true };
			res.send(jsonStringify(result));
		};

		next();
	});

	// Run the request through the API call router
	this.mainRouter.use(this.apiCallRouter);

	// If any request was not matched by the API call router, send a 404 error
	this.mainRouter.use(function(req, res, next) {
		next(new ZSError(ZSError.NOT_FOUND, 'API call not found.'));
	});

	// Include the post-API router
	this.mainRouter.use(this.postAPIRouter);

	// Return errors
	/* jshint unused: false */
	this.mainRouter.use(function(error, req, res, next) {
		error = transformError(error, options);
		var httpCode = (ZSError.getErrorCodeData(error.code) || {}).http || 500;
		res.send(httpCode, jsonStringify(error));
	});
	/* jshint unused: true */

}

/* Arguments are: name (dot-separated), method (or array of methods),
			and handlers (function(req, res, next)) */
RestRouter.prototype.registerAPICall = function() {
	var self = this;
	var params = parseRegisterArgs.parseArgs(arguments);

	var regArgs = [
		'/' + params.name.replace(/\./g, '/'),
		function(req, res, next) {
			req.apiMethod = params.name;
			next();
		}
	].concat(params.middleware);

	var methods = [ 'get', 'post', 'put', 'delete' ];
	methods.forEach(function(method) {
		if(params.options[method]) {
			self.apiCallRouter[method].apply(self.apiCallRouter, regArgs);
		}
	});
};


module.exports = RestRouter;
