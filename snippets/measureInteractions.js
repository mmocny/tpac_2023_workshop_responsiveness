export default function measureInteractions() {
	new PerformanceObserver(list => {
		const reportedRenderTimes = [];

		for (let entry of list.getEntries()) {
			if (!entry.interactionId) continue;
			const renderTime = entry.startTime + entry.duration;
			if (reportedRenderTimes.some(time => Math.abs(time - renderTime) <= 8)) continue;
			reportedRenderTimes.push(renderTime);

			performance.measure('Interaction', {
				start: entry.startTime,
				end: renderTime,
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