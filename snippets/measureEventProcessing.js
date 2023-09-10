export default function measureEventProcessing() {
	new PerformanceObserver(list => {
		for (let entry of list.getEntries()) {
			performance.measure(`Event.${entry.name}`, {
				start: entry.processingStart,
				end: entry.processingEnd,
				details: {
					eventType: entry.name,
					interactionId: entry.interactionId,
				}
			});
		}
	}).observe({
		type: 'event',
		durationThreshold: 0,
		buffered: true
	});
}