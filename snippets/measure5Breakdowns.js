// Queue of LoAF entries.  Event Timings "lag" behind in reporting.
const loafs = [];

// LoAF Observer
new PerformanceObserver(list => {
	for (let entry of list.getEntries()) {
		loafs.push(entry);
	}
}).observe({
	type: 'long-animation-frame',
	buffered: true
});

// Event Timing Observer
new PerformanceObserver(list => {
	const eventEntries = Array.from(list.getEntries()).sort((a,b) => {
		return a.processingStart - b.processingStart;
	});

	// Optional: Filter down just to frames with "interactions"
	const interactionFramesData = splitByFrame(eventEntries)
		.filter(data => data.events.some(entry => entry.interactionId > 0));

	for (let frameData of interactionFramesData) {
		// frameData is: { loaf, events: [] }
		visualizeFrameData(frameData);
	}
}).observe({
	type: 'event',
	durationThreshold: 0,
	buffered: true
});

// Use LoAF entries to group event timing entries by frame
function splitByFrame(eventEntries) {
	const framesByStartTime = {};

	for (let entry of eventEntries) {
		// Process the LoAF queue one at a time
		// Once we find the right loaf entry, we stop iterating
		for (let loaf; loaf = loafs[0]; loafs.shift()) {
			const renderEnd = loaf.startTime + loaf.duration;

			// This event is obviously before the current loaf entry
			// This shouldn't happen, except when using buffered:true
			if (entry.processingEnd < loaf.startTime) break;

			// This event is for a future frame
			if (entry.processingStart > renderEnd) continue;

			// Assert: loaf.startTime <= entry.processingStart
			// Assert: renderEnd >= entry.processingEnd

			framesByStartTime[loaf.startTime] ??= { loaf, events: [] };
			framesByStartTime[loaf.startTime].events.push(entry);
			break;
		}
	}

	return Object.values(framesByStartTime);
}

function visualizeFrameData({ loaf, events }) {
	let maxPresentationTime = 0;
	let totalProcessingTime = 0;
	let prevEnd = 0;
	for (let { startTime, processingStart, processingEnd, duration } of events) {
		maxPresentationTime = Math.max(maxPresentationTime, processingEnd, startTime + duration);
		totalProcessingTime += processingEnd - Math.max(processingStart, prevEnd);
		prevEnd = processingEnd;
	}

	const processingStart = events[0].processingStart;
	const processingEnd = events.at(-1).processingEnd;
	const percent = totalProcessingTime / (processingEnd - processingStart) * 100;

	const renderStart = Math.max(loaf.renderStart, processingEnd);
	const renderEnd = loaf.startTime + loaf.duration;

	// Both event presentation times and loaf renderEnd are rounded, so sometimes one laps the other slightly...
	const interactionEndTime = Math.max(maxPresentationTime, renderEnd);

	performance.measure(`Interaction`, {
		start: events[0].startTime,
		end: interactionEndTime
	});
	performance.measure(`Interaction.InputDelay`, {
		start: events[0].startTime,
		end: processingStart
	});
	performance.measure(`Interaction.Processing [${percent.toFixed(1)}%]`, {
		start: processingStart,
		end: processingEnd
	});
	performance.measure(`Interaction.RenderingDelay`, {
		start: processingEnd,
		end: renderStart
	});
	performance.measure(`Interaction.Rendering`, {
		start: renderStart,
		end: renderEnd,
	});
	performance.measure(`Interaction.PresentationDelay`, {
		start: renderEnd,
		end: interactionEndTime
	});
}