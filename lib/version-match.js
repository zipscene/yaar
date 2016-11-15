// Copyright 2016 Zipscene, LLC
// Licensed under the Apache License, Version 2.0
// http://www.apache.org/licenses/LICENSE-2.0

const _ = require('lodash');

/**
 * Given an expression in the form '3,5-8,9-' or something similar, returns whether or not the
 * expression matches the given version number.  The expression can take the following forms:
 *
 * - `6` - Just a plain Number type.
 * - `'6'` - A string containing a single number.
 * - `'5-7'` - A string containing a range of numbers (inclusive at both ends).
 * - `'5-'` or `'5+'` - An open-ended range.
 * - `'-5'` - Open ended range that matches 5 and anything earlier.
 * - `'3,5-8,10-'` - A comma-separated list of expressions to match.
 * - `[ 3, '5-9', '11+' ]` - An array of expressions.
 *
 * @method expressionMatchesVersion
 * @param {String|Number} expr - Expression, as described above.
 * @param {Number} version - The version to match against.
 * @return {Boolean} - True if it matches.
 */
function expressionMatchesVersion(expr, version) {
	// Check for an array
	if (_.isArray(expr)) {
		return _.some(expr, (subExpr) => expressionMatchesVersion(subExpr, version));
	}
	// Check for a plain number
	if (_.isNumber(expr)) {
		return expr === version;
	}
	// Make sure the remainder is a string
	if (!_.isString(expr)) {
		throw new Error('Invalid API version expression');
	}
	// Check for a comma-separated list of expressions
	let subExprs = expr.split(',');
	if (subExprs.length > 1) {
		return expressionMatchesVersion(subExprs, version);
	}
	// Check for string matches
	let matches;
	if (expr[0] !== '-' && !isNaN(+expr)) {
		if (+expr === version) { return true; }
	} else if ((matches = /^([0-9]+)[+-]$/.exec(expr))) {
		if (version >= +matches[1]) { return true; }
	} else if ((matches = /^-([0-9]+)$/.exec(expr))) {
		if (version <= +matches[1]) { return true; }
	} else if ((matches = /^([0-9]+)-([0-9]+)$/.exec(expr))) {
		if (version >= +matches[1] && version <= +matches[2]) { return true; }
	} else {
		throw new Error('Invalid API version expression');
	}
	return false;
}

exports.expressionMatchesVersion = expressionMatchesVersion;
