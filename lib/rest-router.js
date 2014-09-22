var express = require('express');
var ZSError = require('zs-error');
var transformError = require('./error-transform');
var parseRegisterArgs = require('./parse-register-args');

function RestRouter(parentRouter, options, apiVersion) {
	if(!options) options = {};
	this.apiVersion = apiVersion;
	this.apiType = 'rest';

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

		// Set a transport on the request object
		req.apiTransport = 'rest';

		// Set the API version
		req.apiVersion = apiVersion;

		var useParamsFromQueryString = true;
		var useParamsFromRouteParams = true;
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

	// Register the main REST router with the parent router
	parentRouter.use('/api', this.mainRouter);

	this.callInfo = {};

}

RestRouter.prototype.getCallInfo = function() {
	return this.callInfo;
};

/* Arguments are: name (dot-separated), method (or array of methods),
			and handlers (function(req, res, next)) */
RestRouter.prototype.registerAPICall = function() {
	var self = this;
	var params = parseRegisterArgs.parseArgs(arguments);

	var regArgs = [
		'/' + params.name.replace(/\./g, '/'),
		function(req, res, next) {
			// Set the API method name as a parameter on the request object
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
	var callData = {
		path: params.name.replace(/\./g, '/'),
		name: params.bareName,
		methods: methods.filter(function(m) { return !!params.options[m]; }).map(function(m) { return m.toUpperCase(); }),
		middleware: params.middleware
	};
	this.callInfo[callData.path] = callData;
	return callData;
};

RestRouter.prototype._collectionRouteBase = function(collection) {
	var baseRoute = collection.baseName;
	if(collection.groupKeys && collection.groupKeys.length) {
		baseRoute += '/:' + this.groupKeys.join('/:');
	}
	return baseRoute;
};

RestRouter.prototype._collectionRegister = function(collection, prefix, suffix, methods, remapBody, args) {
	args = Array.prototype.slice.call(args, 0);
	if(remapBody) {
		args =
		[
			function(req, res, next) {
				if(req.body) {
					if(req._setUseParamsFromBody) req._setUseParamsFromBody(false);
					req.setParam('item', req.body);
					if(collection.itemName != 'item') {
						req.setParam(collection.itemName, req.body);
					}
				}
				next();
			}
		].concat(args);
	}
	args = [
		(prefix || '') + this._collectionRouteBase(collection) + (suffix || ''),
		methods
	].concat(args);
	this.registerAPICall.apply(this, args);
};

RestRouter.prototype.collectionGet = function(collection, args) {
	this._collectionRegister(collection, null, '.:' + collection.itemIdName, { get: true }, false, args);
	this._collectionRegister(collection, 'collection.', '.get', { get: true, post: true }, false, args);
};

RestRouter.prototype.collectionPut = function(collection, args) {
	// Standard REST call
	this._collectionRegister(collection, null, '.:' + collection.itemIdName, { put: true }, true, args);
	// PUT to base collection with item ID in the body
	this._collectionRegister(collection, null, null, { put: true }, true, args);
	// Collection-style call
	this._collectionRegister(collection, 'collection.', '.replace', { put: true, post: true }, false, args);
	// Collection-style call with item ID in query
	this._collectionRegister(collection, 'collection.', '.replace.:' + collection.itemIdName, { put: true, post: true }, false, args);
};

RestRouter.prototype.collectionUpdate = function(collection, args) {
	// There's no REST verb for update ... only register collection-style calls
	// Collection-style call
	this._collectionRegister(collection, 'collection.', '.update', { post: true }, false, args);
	// Collection-style call with item ID in query
	this._collectionRegister(collection, 'collection.', '.update.:' + collection.itemIdName, { post: true }, false, args);
};

RestRouter.prototype.collectionDelete = function(collection, args) {
	this._collectionRegister(collection, null, '.:' + collection.itemIdName, { delete: true }, false, args);
	this._collectionRegister(collection, 'collection.', '.delete', { delete: true, post: true }, false, args);
};

RestRouter.prototype.collectionCreate = function(collection, args) {
	// Standard REST call (POST to root of collection)
	this._collectionRegister(collection, null, null, { post: true }, true, args);
	// Collection-style call
	this._collectionRegister(collection, 'collection.', '.create', { post: true }, false, args);
};

RestRouter.prototype.collectionList = function(collection, args) {
	// Register REST calls on the collection base route and the base route corresponding to each of the group keys
	// These correspond to querying with or without including the various group keys
	for(var i = 0; i <= collection.groupKeys.length; i++) {
		var route = collection.baseName;
		if(i > 0) route += '/:' + collection.groupKeys.slice(0, i).join('/:');
		this.registerAPICall.apply(this, [route, { get: true }].concat(args));
		this.registerAPICall.apply(this, ['collection.' + route, { get: true, post: true }].concat(args));
	}
};

RestRouter.prototype.collectionItemAction = function(collection, actionName, args) {
	// Collection-style call
	this._collectionRegister(collection, 'collection.', null, '.' + actionName, { post: true }, false, args);
	// With item ID
	this._collectionRegister(collection, 'collection.', null, '.' + actionName + '.:' + collection.itemIdName, { post: true }, false, args);
};

RestRouter.prototype.collectionAction = function(collection, actionName, args) {
	this._collectionRegister(collection, 'collection.', null, '.' + actionName, { post: true }, false, args);
};


module.exports = RestRouter;
