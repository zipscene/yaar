var cors = require('cors');
var bodyParser = require('body-parser');
var express = require('express');
var ZSError = require('zs-error');
var RESTRouter = require('./rest-router');
var JSONRPCRouter = require('./jsonrpc-router');
var HTTPRPCRouter = require('./httprpc-router');
var jsonp = require('./jsonp');
var parseRegisterArgs = require('./parse-register-args');


// Options can include:
// - forceSSL
// - prettyJSON
// - returnStackTrace
// - allowJSONP
// - requestSizeLimit
// - versions:
// A map from version number to an object containing options for that version.
// Ex:
/*
{
	1: {
		jsonrpc: true,
		rest: true,
		default: true
	},
	2: {
		jsonrpc: true,
		httprpc: true
	}
}
*/
function APIRouter(options) {
	var self = this;
	if(!options) options = {};
	if(!options.versions) {
		options.versions = {
			1: {
				jsonrpc: true,
				httprpc: true,
				default: true
			}
		};
	}

	// Instantiate the main router used for API calls
	this.router = express.Router({ caseSensitive: true, strict: false });

	// Register middleware to force SSL
	if(options.forceSSL) {
		this.router.use(function(req, res, next) {
			if(req.secure || req.url === '/') {
				next();
			} else {
				next(new ZSError(ZSError.BAD_REQUEST, 'HTTPS is required for this request.'));
			}
		});
	}

	// Allow CORS
	this.router.use(cors({
		methods: [ 'GET', 'POST', 'PUT', 'DELETE' ],
		headers: [ 'Content-type', 'Authorization' ]
	}));

	// Allow JSONP
	if(options.allowJSONP) {
		this.router.use(jsonp);
	}

	// Body parsers
	this.router.use(bodyParser.json({limit: options.requestSizeLimit || '50mb'}));
	this.router.use(bodyParser.urlencoded({limit: options.requestSizeLimit || '50mb'}));

	var allAPIRouters = [];
	this.allAPIRouters = allAPIRouters;
	var versionRouters = {};
	this.versionRouters = versionRouters;
	var versionAPIRouters = {};
	this.versionAPIRouters = versionAPIRouters;

	// Instantiate routers for each version
	var defaultVersion;
	Object.keys(options.versions).forEach(function(versionNum) {
		versionNum = parseInt(versionNum, 10);
		var versionObj = options.versions[versionNum];
		if(versionObj.default) defaultVersion = versionNum;

		// Instantiate a version router to use for this version
		var versionRouter = express.Router({ caseSensitive: true, strict: false });
		versionRouters[versionNum] = versionRouter;
		self.router.use('/v' + versionNum, versionRouter);

		if(!versionAPIRouters[versionNum]) versionAPIRouters[versionNum] = {};

		// Register the API call routers with it
		if(versionObj.jsonrpc) {
			versionAPIRouters[versionNum].jsonrpc = new JSONRPCRouter(versionRouter, options, versionNum);
			allAPIRouters.push(versionAPIRouters[versionNum].jsonrpc);
		}
		if(versionObj.rest) {
			versionAPIRouters[versionNum].rest = new RESTRouter(versionRouter, options, versionNum);
			allAPIRouters.push(versionAPIRouters[versionNum].rest);
		}
		if(versionObj.httprpc) {
			versionAPIRouters[versionNum].httprpc = new HTTPRPCRouter(versionRouter, options, versionNum);
			allAPIRouters.push(versionAPIRouters[versionNum].httprpc);
		}
	});

	// Include the default version router for anything unmatched by a version
	if(defaultVersion !== undefined) {
		self.router.use('/', versionRouters[defaultVersion]);
	}

}

APIRouter.prototype.getCallInfo = function() {
	var ret = {};
	for(var version in this.versionAPIRouters) {
		ret[version] = {};
		for(var apiType in this.versionAPIRouters[version]) {
			ret[version][apiType] = this.versionAPIRouters[version][apiType].getCallInfo();
		}
	}
	return ret;
};

// Call to register an API call
APIRouter.prototype.registerAPICall = function() {
	var params = parseRegisterArgs.parseArgs(arguments);
	if(!params.options) params.options = {};

	// Wrap each middleware in a try/catch to prevent express from catching the errors
	params.middleware.forEach(function(func, idx) {
		params.middleware[idx] = function(req, res, next) {
			try {
				return func.apply(this, Array.prototype.slice.call(arguments, 0));
			} catch (ex) {
				process.emit('uncaughtException', ex);
				next(new ZSError(ZSError.INTERNAL_ERROR, 'An internal uncaught exception occurred'));
			}
		};
		params.middleware[idx].origFunction = func;
	});

	// Register the API call with each API router
	this.allAPIRouters.forEach(function(apiRouter) {
		apiRouter.registerAPICall(params);
	});
};

APIRouter.prototype.register = APIRouter.prototype.registerAPICall;

APIRouter.prototype.collection = function(baseName, itemName, itemIdName, groupKeyNames) {
	return new APIRouterCollection(this, baseName, itemName, itemIdName, groupKeyNames);
};


function APIRouterCollection(apiRouter, baseName, itemName, itemIdName, itemGroupKeyNames) {
	this.apiRouter = apiRouter;
	this.baseName = baseName;
	this.itemName = itemName || 'item';
	this.itemIdName = itemIdName || 'id';
	this.groupKeys = itemGroupKeyNames || [];
}

APIRouterCollection.prototype.collectionAction = function(actionName/*, ...*/) {
	var collection = this;
	var uCase = actionName[0].toUpperCase() + actionName.slice(1);
	var args = [collection._paramMapper(true, false, true)].concat(Array.prototype.slice.call(arguments, 1));
	this.apiRouter.allAPIRouters.forEach(function(apiRouter) {
		if(apiRouter['collection' + uCase]) {
			apiRouter['collection' + uCase](collection, args);
		} else if(apiRouter.collectionAction) {
			apiRouter.collectionAction(collection, actionName, args);
		} else {
			apiRouter.registerAPICall.apply(apiRouter, [collection.baseName + '.' + actionName].concat(args));
		}
	});
};

APIRouterCollection.prototype.itemAction = function(actionName/*, ...*/) {
	var collection = this;
	var uCase = actionName[0].toUpperCase() + actionName.slice(1);
	var args = [collection._paramMapper(true, false, true)].concat(Array.prototype.slice.call(arguments, 1));
	this.apiRouter.allAPIRouters.forEach(function(apiRouter) {
		if(apiRouter['collection' + uCase]) {
			apiRouter['collection' + uCase](collection, args);
		} else if(apiRouter.collectionItemAction) {
			apiRouter.collectionItemAction(collection, actionName, args);
		} else if(apiRouter.collectionAction) {
			apiRouter.collectionAction(collection, actionName, args);
		} else {
			apiRouter.registerAPICall.apply(apiRouter, [collection.baseName + '.' + actionName].concat(args));
		}
	});
};

// Maps various parameters to other parameters (body/item, id, etc)
APIRouterCollection.prototype._paramMapper = function(remapItem, remapBody, remapId) {
	var self = this;
	return function(req, res, next) {
		// If 'id' is supplied, but not the itemId, set 'id', and vice-versa
		if(remapId) {
			if(self.itemIdName != 'id') {
				if(req.param(self.itemIdName) && !req.param('id')) {
					req.setParam('id', req.param(self.itemIdName));
				} else if(req.param('id') && !req.param(self.itemIdName)) {
					req.setParam(self.itemIdName);
				}
			}
		}
		// If a body is given, remap it to both 'item' and the item name, then prevent it from being used as parameters
		if(remapBody) {
			if(req.body) {
				if(req._setUseParamsFromBody) req._setUseParamsFromBody(false);
				req.setParam('item', req.body);
				if(self.itemName != 'item') {
					req.setParam(self.itemName, req.body);
				}
			}
		}
		// If a named item parameter is given, map it to 'item' and vice-versa
		if(remapItem) {
			if(self.itemName != 'item') {
				if(req.param(self.itemName) && !req.param('item')) {
					req.setParam('item', req.param(self.itemName));
				} else if(req.param('item') && !req.param(self.itemName)) {
					req.setParam(self.itemName, req.param('item'));
				}
			}
		}
		next();
	};
};

APIRouterCollection.prototype.get = function() {
	this.itemAction.apply(this, ['get'].concat(Array.prototype.slice.call(arguments, 0)));
};

APIRouterCollection.prototype.replace = function() {
	this.itemAction.apply(this, ['put'].concat(Array.prototype.slice.call(arguments, 0)));
};

APIRouterCollection.prototype.put = APIRouterCollection.prototype.replace;

APIRouterCollection.prototype.update = function() {
	this.itemAction.apply(this, ['update'].concat(Array.prototype.slice.call(arguments, 0)));
};

APIRouterCollection.prototype.delete = function() {
	this.itemAction.apply(this, ['delete'].concat(Array.prototype.slice.call(arguments, 0)));
};

APIRouterCollection.prototype.create = function() {
	this.collectionAction.apply(this, ['create'].concat(Array.prototype.slice.call(arguments, 0)));
};

APIRouterCollection.prototype.list = function() {
	this.collectionAction.apply(this, ['list'].concat(Array.prototype.slice.call(arguments, 0)));
};

module.exports = APIRouter;
