// Parses the args to the register() function to register an API call

// Give this an array of arguments
// The arguments can be in this format:
// name - required (string)
// methods and options - Either a string (HTTP method), array of strings (HTTP methods), or object (map from HTTP methods to true, plus other options)
// Middleware functions
// The return value of this function is:
// { name: ..., bareName: ..., options: ..., middleware: ... }
// Also, an existing object of this form can be passed as the only argument, and will be returned verbatim
function parseArgs(args) {
	if(!Array.isArray(args) && args && args.length) args = Array.prototype.slice.call(args, 0);
	if(!Array.isArray(args) && args && typeof args == 'object' && args.name) return args;
	if(args.length == 1 && args[0] && typeof args[0] == 'object' && args[0].name) return args[0];

	var name = args[0];
	if(!name || typeof name != 'string') throw 'ZSAPI function must have a name';
	name = name.split('/').join('.');

	var nameWithoutParams = name.replace(/\.:([^\.]+)/g, '');

	var handlersStart = 1;
	var opts = {};
	if(typeof args[1] == 'string') {
		handlersStart++;
		opts[args[1].toLowerCase()] = true;
	} else if(Array.isArray(args[1])) {
		handlersStart++;
		args[1].forEach(function(m) {
			opts[m.toLowerCase()] = true;
		});
	} else if(typeof args[1] == 'object' && args[1]) {
		handlersStart++;
		opts = args[1];
	} else {
		opts.post = true;
	}
	var handlers = args.slice(handlersStart);

	return {
		name: name,
		bareName: nameWithoutParams,
		options: opts,
		middleware: handlers
	};
};

exports.parseArgs = parseArgs;

function parseArgsAfterName(name, args) {
	if(!Array.isArray(args) && args && args.length) args = Array.prototype.slice.call(args, 0);
	return parseArgs([name].concat(args));
}

exports.parseArgsAfterName = parseArgsAfterName;
