var express = require('express');
var ZSError = require('zs-error');
var transformError = require('./error-transform');
var parseRegisterArgs = require('./parse-register-args');

function HTTPRPCRouter(parentRouter, options, apiVersion) {
	if(!options) options = {};
	this.apiVersion = apiVersion;
	this.apiType = 'httprpc';

	function jsonStringify(val) {
		if(options.prettyJSON) {
			return JSON.stringify(val, null, '\t');
		} else {
			return JSON.stringify(val);
		}
	}

	// Create an express router to use for the actual API call routes
	this.apiCallRouter = express.Router({
		caseSensitive: true,
		strict: true
	});

	// Create an express router to use for postprocessing API errors
	this.postAPIRouter = express.Router({});

	// This express router wraps the other sub-routers
	this.mainRouter = express.Router({
		caseSensitive: true,
		strict: true
	});

	// Set up the request and response objects as API request/response
	this.mainRouter.use(function(req, res, next) {
		// Always return JSON
		res.set('Content-type', 'application/json');

		// Set a transport on the request object
		req.apiTransport = 'httprpc';

		// Set the API version
		req.apiVersion = apiVersion;

		var useParamsFromQueryString = true;
		var useParamsFromRouteParams = false;
		var useParamsFromBody = true;
		var extraParams = {};

		req._setUseParamsFromQueryString = function(b) { useParamsFromQueryString = b; };
		req._setUseParamsFromRouteParams = function(b) { useParamsFromRouteParams = b; };
		req._setUseParamsFromBody = function(b) { useParamsFromBody = b; };

		req.origParam = req.param;

		req.param = function(name) {
			if(extraParams[name] !== undefined) return extraParams[name];
			if(useParamsFromBody && req.body && typeof req.body == 'object' && req.body[name] !== undefined) return req.body[name];
			if(useParamsFromQueryString && req.query && req.query[name] !== undefined) return req.query[name];
			if(useParamsFromRouteParams && req.params && req.params[name] !== undefined) return req.params[name];
			return undefined;
		};

		req.setParam = function(name, value) {
			extraParams[name] = value;
		};

		req.getAllParams = function() {
			var key;
			var params = {};
			if(useParamsFromRouteParams && req.params) {
				for(key in req.params) params[key] = req.params[key];
			}
			if(useParamsFromQueryString && req.query) {
				for(key in req.query) params[key] = req.query[key];
			}
			if(useParamsFromBody && req.body && typeof req.body == 'object') {
				for(key in req.body) params[key] = req.body[key];
			}
			for(key in extraParams) params[key] = extraParams[key];
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
		res.status(httpCode).send(jsonStringify(error));
	});
	/* jshint unused: true */

	parentRouter.use('/api', this.mainRouter);
	parentRouter.use('/httprpc', this.mainRouter);

	this.callInfo = {};

}

HTTPRPCRouter.prototype.getCallInfo = function() {
	return this.callInfo;
};

/* Arguments are: name (dot-separated), options object that may contain extra HTTP methods,
			and handlers (function(req, res, next)) */
HTTPRPCRouter.prototype.registerAPICall = function() {
	var self = this;
	var params = parseRegisterArgs.parseArgs(arguments);

	var regArgs = [
		'/' + params.bareName.replace(/\./g, '/'),
		function(req, res, next) {
			// Set the API method name as a parameter on the request object
			req.apiMethod = params.bareName;
			next();
		}
	].concat(params.middleware);

	var methods = [ 'get', 'post', 'put', 'delete' ];
	methods.forEach(function(method) {
		if(params.options[method] || method == 'post') {	// ALWAYS allow POST
			self.apiCallRouter[method].apply(self.apiCallRouter, regArgs);
		}
	});
	var callData = {
		path: params.bareName.replace(/\./g, '/'),
		name: params.bareName,
		methods: methods.filter(function(m) { return !!params.options[m]; }).map(function(m) { return m.toUpperCase(); }),
		middleware: params.middleware
	};
	this.callInfo[callData.path] = callData;
	return callData;
};


module.exports = HTTPRPCRouter;
