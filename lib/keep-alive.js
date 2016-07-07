const _ = require('lodash');

class KeepAlive {
	constructor(res, interval) {
		this.res = res;
		this.interval = (_.isNumber(interval)) ? interval : 10000;
		this.intervalId = null;
	}

	start() {
		this.stop();
		this.intervalId = setInterval(() => {
			this.res.write(' ');
		}, this.interval);
	}

	stop() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}
}

module.exports = KeepAlive;
