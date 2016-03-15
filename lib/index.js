require('xerror').registerErrorCode('request_error', {
	message: 'An error occurred with the request',
	http: 400
});

const APICallRegistrar = require('./api-call-registrar');
const APIInterface = require('./api-interface');
const APIRouter = require('./api-router');
const HTTPRPCInterface = require('./http-rpc-interface');
const JSONRPCInterface = require('./json-rpc-interface');
const VersionRouter = require('./version-router');

exports.APICallRegistrar = APICallRegistrar;
exports.APIInterface = APIInterface;
exports.APIRouter = APIRouter;
exports.HTTPRPCInterface = HTTPRPCInterface;
exports.JSONRPCInterface = JSONRPCInterface;
exports.VersionRouter = VersionRouter;
