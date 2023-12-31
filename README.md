# TPAC 2023 workshop: Responsiveness

> Michal Mocny, mmocny@google.com, Sept 2023

> For Web Perf WG

## Goals

- It's a workshop!
	- (Don't just sit there, follow along!)
- Explore options for measuring events & showcase Performance Timeline
- Share some recommendations for breaking down interactions into parts
- Maybe look at several quirky examples, and share some useful techniques

## Useful Links

- [This repo](httpss://github.com/mmocny/tpac_2023_workshop_responsiveness)
- [INP demo page](https://inp-demo.glitch.me)
- [Event Timing spec](https://w3c.github.io/event-timing/)
- [LoAF Explainer](https://github.com/w3c/longtasks/blob/main/loaf-explainer.md)

> Note: Testing in Chrome Canary with Experimental Web Platform Featues enabled works best for later examples

## 1. Measuring Events, manually

Let's attempt to measure Events, with a simple wrapper:

```js
document.addEventListener('click', measureEvent((event) => {
	console.log(event);
}));

function measureEvent(callback) {
	return (event) => {
		const processingStart = performance.now();
		callback(event);
		const processingEnd = performance.now();

		performance.measure('Event.InputDelay', {
			start: event.timeStamp,
			end: processingStart,
		});
		performance.measure('Event.Processing', {
			start: processingStart,
			end: processingEnd,
		});

		console.log('Event', event.type, {
			inputDelay: processingStart - event.timeStamp,
			processing: processingEnd - processingStart,
		});
	}
}
```

...test it:

```js
function block(ms) {
	const target = performance.now() + ms;
	while (performance.now() < target);
}

document.addEventListener('click', measureEvent((event) => {
	block(20);
}), { capture: true });
```

This is one way to measure the time spent on main thread, running an event listener, visualized using User Timings.

## But, when are Effects "done"?

- **synchronous** effects, such as `console.log()` or writing to `localStorage` are "done" right away.
- **asynchronous** effects, such as fetch() response processing, don't resolve until after event is done.
- "Rendering" is a very specific type of **asynchonous** effect.
- "Responsiveness" typically refers specifically to: _visual responsiveness_
	- e.g. Interaction to Next Paint (INP)
	- Even network responsiveness (which INP does **not** measure) typically means the visual update after response.
	- Note: Accessibility features often rely on rendering as well (style, layout, etc).

Let's update our measurement snippet to include rendering work:

```js
function measureEvent(callback) {
	return (event) => {
		const processingStart = performance.now();
		callback(event);
		const processingEnd = performance.now();

		performance.measure('Event.InputDelay', {
			start: event.timeStamp,
			end: processingStart,
		});
		performance.measure('Event.Processing', {
			start: processingStart,
			end: processingEnd,
		});

		requestAnimationFrame(async () => {
			const renderStart = performance.now();
			try {
				await scheduler.yield();
			} catch {
				await new Promise(resolve => setTimeout(resolve, 0));
			}
			const renderEnd = performance.now();

			performance.measure('Event.Rendering', {
				start: renderStart,
				end: performance.now(),
			});

			console.log('Event', event.type, {
				inputDelay: processingStart - event.timeStamp,
				processing: processingEnd - processingStart,
				renderDelay: renderStart - processingEnd,
				rendering: renderEnd - renderStart,
			});
		});
	}
}

function block(ms) {
	const target = performance.now() + ms;
	while (performance.now() < target);
}

document.addEventListener('click', measureEvent((event) => {
	console.log(event);
	block(20);
}), { capture: true });
```

Try it:

- Multiple event listeners
- Multiple event types
- `{ capture: true }`
- `{ passive: true }`

## Discussion: Measuring manually

- Disadvantage: Must explicitly decorate listeners.
	> ...or try to monkey patch addEventListener
- Advantage: Access to context (custom components, state).
- Advantage: Attribution *before* DOM modifications.
- Advantage: Synchronous measures, less document unload risk.
- Advantage: Uses simple primitives (works everywhere)
- Disadvantage: Difficult to measure complete responsiveness accurately
	- Unlikely to measure *all* event listeners
	- Imperfect visibility, especially so for paint/presentation time.
- Disadvantage: Computational Overhead, blocking important interactions
- Disadvantage: Bootstrapping

## 2. Measuring using Event Timing API

A convenient "summary" of *all* event handlers of a specific type (for a specific target).

- `startTime` is same as event `timeStamp`
- `name` is same as event `type`
- `processingStart` and `processingEnd` mark the sum of all Event Dispatch work
-  `duration` marks the total time, to (presentation of) next paint
- `interactionId` labels (and groups) distinct events by input gesture.

```js
new PerformanceObserver(list => {
	for (let entry of list.getEntries()) {
		const renderTime = Math.max(entry.startTime + entry.duration, entry.processingEnd);
		performance.measure('Event.Duration', {
			start: entry.startTime,
			end: entry.startTime + entry.duration
		});
		performance.measure('Event.InputDelay', {
			start: entry.startTime,
			end: entry.processingStart
		});
		performance.measure('Event.Processing', {
			start: entry.processingStart,
			end: entry.processingEnd
		});
		performance.measure('Event.PresentationDelay', {
			start: entry.processingEnd,
			end: renderTime
		});
	}
}).observe({
	type: 'event',
	durationThreshold: 0,
	buffered: true
});
```

> Tip: You can get the best of both worlds, measure Events and Event Timing, match up by `event.type == entry.name && event.timeStamp == entry.startTime`

<details>
<summary>Answer: match Events to Event Timings</summary>

```js
const interestingEventTypes = [ 'pointerdown', 'pointerup', 'click', 'keydown', 'keypress', 'keyup'];
const eventData = Object.fromEntries(interestingEventTypes.map(type => [type, {}]));

for (let type of interestingEventTypes) {
	document.addEventListener(type, (event) => {
		// TODO: Do attribution however you like
		const nodeType = event.target.nodeName.toLowerCase();
		const nodeId = event.target.id;
		const nodeClasses = event.target.className.replace(/\s/g, '.');
		const targetSelector = `${nodeType}#${nodeId}.${nodeClasses}`;
		const data = {
			targetSelector,
			details: {
				state: "..."
			}
		};
		
		eventData[type][event.timeStamp] = data;
	});
}

new PerformanceObserver(list => {
    for (let entry of list.getEntries()) {
        if (!interestingEventTypes.includes(entry.name)) continue;

		try {
			const data = eventData[entry.name][entry.startTime];
			console.log('Matched event data to event entry', data, entry);
		} catch {
		}
    }
}).observe({
    type: 'event',
    durationThreshold: 0
});
```
</details>

### Single Event Timing

![Screenshot 2023-09-05 at 09 37 56](https://github.com/mmocny/tpac_2023_workshop_responsiveness/assets/474282/1a72c701-a99a-4f9a-baef-34e5753960e5)

### Multiple Event Timings

![Screenshot 2023-09-05 at 09 38 55](https://github.com/mmocny/tpac_2023_workshop_responsiveness/assets/474282/411011b9-23b5-41c0-b847-7cb97c861dc0)


> How many events, really?

```js
// Look at all those events
Object.fromEntries(performance.eventCounts)

// Count of all events
Array.from(performance.eventCounts.values()).reduce((a,b) => a + b)
```

![Screenshot 2023-09-05 at 10 10 21](https://github.com/mmocny/tpac_2023_workshop_responsiveness/assets/474282/529832cc-eb6b-4fe4-8760-5c8dd6ab5f5a)


### Clearing the clutter

- Sometimes multiple events dispatch for a single input "gesture"
- Events can "nest" (but its not consistent)
- Sometimes multuple input "gestures" arrive within a single animation frame

<img width="1122" alt="Screenshot 2023-09-11 at 11 10 04" src="https://github.com/mmocny/tpac_2023_workshop_responsiveness/assets/474282/a90afd33-3758-41b1-b142-cd7bfaec5c94">
<img width="1117" alt="Screenshot 2023-09-11 at 11 10 28" src="https://github.com/mmocny/tpac_2023_workshop_responsiveness/assets/474282/4f65e080-9b83-4d6b-95e0-dfbc34e7118f">

Strategy "flatten down":

1. Select important _time ranges_ for Events.
    - e.g. based on all long Interactions, or
    - e.g. based of the single longest Interaction only (your INP)
1. Group _all events_ that share that same animation frame
    - You can do this using just Event Timing `startTime + duration` (which is effectively a `renderTime`)
    - Note: because `duration` is rounded to 8ms, group by `renderTime` +/- 8ms.
1. Mark the smallest `processingStart`
1. Mark the largest `processingEnd`
1. Sum the total (non-overlapping) processing time

With that, you get a better model for:

- Input Delay
- All event's processing (time and range)
- Presentation Delay

### Measure Interaction Animation Frames: merging all Event Timings' processing times

```js
new PerformanceObserver(list => {
	const interactionTimeRanges = [];

	for (let entry of list.getEntries()) {
		if (entry.interactionId) {
			const renderTime = Math.max(entry.processingEnd, entry.startTime + entry.duration);

			// We only need to report the first interaction per presentation
			if (!(interactionTimeRanges.length > 0 && Math.abs(interactionTimeRanges.at(-1).end - renderTime) <= 8)) { 
				interactionTimeRanges.push({
					start: entry.startTime,
					end: renderTime,
					details: {
						processingTimes: []
					}
				});
			}
			performance.measure('Interaction', interactionTimeRanges.at(-1));
		}

		if (interactionTimeRanges.length == 0) continue;

		const currentInteraction = interactionTimeRanges.at(-1);

		if (entry.processingStart >= currentInteraction.start && entry.processingEnd <= currentInteraction.end) {
			currentInteraction.details.processingTimes.push({
				start: entry.processingStart,
				end: entry.processingEnd,
			})
		}
	}

	if (interactionTimeRanges.length == 0) return;
	const currentInteraction = interactionTimeRanges.at(-1);
	let totalProcessingTime = 0;
	let prevEnd = 0;
	for (let {start,end} of currentInteraction.details.processingTimes) {
		totalProcessingTime += end - Math.max(start, prevEnd);
		prevEnd = end;
	}
	const start = currentInteraction.details.processingTimes[0].start;
	const end = currentInteraction.details.processingTimes.at(-1).end;
	const percent = totalProcessingTime / (end-start) * 100;

	performance.measure(`Event.Processing [${percent.toFixed(1)}%]`, {
		start,
		end
	});
}).observe({
	type: 'event',
	durationThreshold: 0,
	buffered: true
});
```


## 3. Measurement using Long Animation Frames (LoAF)

With Event timing API, we gained accurate measurement of processing times, and final presentation -- but lost the ability to measure rendering work.  This means we miss out on a useful diagnostic, and actually decreases the accuracy of event grouping.

It was also just a lot of work to "group events by animation frame".  Let's just use the new LoAF API, instead!

### Measure Long Animation Frames

```js
new PerformanceObserver(list => {
	for (let entry of list.getEntries()) {
		performance.measure('LoAF.processingWork', { 
			start: entry.startTime,
			end: entry.renderStart,
		});
		performance.measure('LoAF.eventsAndRAF', {
			start: entry.renderStart,
			end: entry.styleAndLayoutStart,
		});
		performance.measure('LoAF.styleAndLayout', {
			start: entry.styleAndLayoutStart,
			end: entry.startTime + entry.duration,
		});
	}
}).observe({
	type: 'long-animation-frame'
});
```

> Warning! This is a fresh API, just in Origin Trial. The guidance for use with Event Timing is evolving!  For example, LoAFs are only available for frames > 50ms, not for every interaction.

### Measure Interactions using Long Animation Frames

Strategy:

- Each LoAF entry marks a time range (main thread time).
- Overlap with Interaction processing time marks an interesting LoAF.
- Take Events within the animation frame time range (less grouping)
- Measure processing times same as before
- LoAF also gives render time breakdowns, and script attribution.

![Screenshot 2023-09-30 at 10 42 16](https://github.com/mmocny/tpac_2023_workshop_responsiveness/assets/474282/ffb6dfbf-6479-4540-bb64-db962815d7fc)

```js
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
```


## Discuss: Using LoAF

- Disadvantage: New, unreleased API (currently in Origin Trial)
- Advantage: Accurate and insightful
	- (time points, scripts attribution)
- Advantage: Comparatively simple to implement
- Disadvantage: Only works for long frames on main thread, therefore, longer interactions
	- Should usually measure Interactions above 100ms
	- Due to input/presentation delay, which you can measure with just Event Timing

# Fin

## Some useful techniques to know

- `afterNextPaint`, basically, a `requestPostAnimationFrame()` polyfill
	- Useful for cases where you cannot guarentee the task will yield() regularly.  Otherwise, just do that.

```js
async function afterNextPaint() {
  return new Promise(resolve => requestAnimationFrame(async () => {
    await scheduler.yield();
    resolve();
  }));
}
```

- JS frameworks: `startTransition`

## Some quirky problems to watch for

- Just yielding (to split long task) vs explicitly waiting for after next paint
- isInputPending() inside event handlers
- Hover events, especially on mobile
- Beacon data, deferring work in interactions, and (before)unload handlers
- Callbacks during (idle) periods before next paint
