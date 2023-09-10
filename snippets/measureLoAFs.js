export default function measureLoAFs() {
	new PerformanceObserver(list => {
		for (let entry of list.getEntries()) {
			performance.measure('LoAF.tasks', { 
				start: entry.startTime,
				end: entry.renderStart,
			});
			performance.measure('LoAF.rendering', {
				start: entry.renderStart,
				end: entry.styleAndLayoutStart,
			});
			performance.measure('LoAF.style', {
				start: entry.styleAndLayoutStart,
				end: entry.startTime + entry.duration,
			});
		}
	}).observe({
		type: 'long-animation-frame',
		buffered: true
	});
}