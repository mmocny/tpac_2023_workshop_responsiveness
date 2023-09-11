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
```

```js
function measureEvent(callback) {
	return (event) => {
		// Exercise:
		// measure before
		callback(event);
		// ..and after
	}
}
```

<details>
<summary>Answer: measuring event processing times</summary>

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

		console.log('Event', event.type, {
			inputDelay: processingStart - event.timeStamp,
			processing: processingEnd - processingStart,
		});
	}
}

function block(ms) {
	const target = performance.now() + ms;
	while (performance.now() < target);
}

document.addEventListener('click', measureEvent((event) => {
	block(20);
}), { capture: true });
```
</details>

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

<details>
<summary>Answer: measuring event rendering work as well</summary>

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
</details>

Try it:
- Multiple event listeners
- Multiple event types
- `{ capture: true }`
- `{ passive: true }`

## Discussion: Measuring manually

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
		performance.measure('Event.Duration', {
			start: entry.startTime,
			end: entry.startTime + entry.duration
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

<img width="1425" alt="Screenshot 2023-09-11 at 11 02 57" src="https://github.com/mmocny/tpac_2023_workshop_responsiveness/assets/474282/6672a047-4e5b-434f-b29d-630e7d658dfe">


Strategy "flatten down":

1. Filter timeline down to interesting time ranges
	- e.g. overlap with long Interactions, specifically
	- e.g. longest Interaction only (INP)
1. Group events by animation frame (using `renderTime`)
1. Mark the smallest `processingStart`
1. Mark the largest `processingEnd`
1. Sum the total (non-overlapping) processing time

With that, you get a better model for:
- Input Delay
- All event's processing (time and range)
- Presentation Delay

<details>
<summary>Visualize Interaction time ranges, decluttered</summary>

```js
const interactionTimeRanges = [];

new PerformanceObserver(list => {
	for (let entry of list.getEntries()) {
		if (!entry.interactionId)
			continue;
		const renderTime = Math.max(entry.processingEnd, entry.startTime + entry.duration);

		// We only need to report the first interaction per presentation
		if (interactionTimeRanges.length > 0 && Math.abs(interactionTimeRanges.at(-1).end - renderTime) <= 8)
			continue;

		interactionTimeRanges.push({
			start: entry.startTime,
			end: renderTime
		});

		performance.measure('Interaction', interactionTimeRanges.at(-1));

	}
}).observe({
	type: 'event',
	durationThreshold: 0,
	buffered: true
});
```
</details>

<details>
<summary>Also visualize Event processing times</summary>

```js
const interactionTimeRanges = [];

new PerformanceObserver(list => {
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
			performance.measure('Event.Processing', currentInteraction.details.processingTimes.at(-1));
		}
	}
}).observe({
	type: 'event',
	durationThreshold: 0,
	buffered: true
});
```
</details>


<details>
<summary>Merge Event processing times</summary>

```js
const interactionTimeRanges = [];

// TODO: Update to save all events and interactions first, then post-process into time ranges
new PerformanceObserver(list => {
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
</details>


## 3. Measurement using Long Animation Frames (LoAF)

With Event timing API, we gained accurate measurement of processing times, and final presentation -- but lost the ability to measure rendering work.  This means we miss out on a useful diagnostic, and actually decreases the accuracy of event grouping.

It was also just a lot of work to "group events by animation frame".  Let's just use the new LoAF API, instead!

```js
new PerformanceObserver(list => {
	for (let entry of list.getEntries()) {
		performance.measure('LoAF.work', { 
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
	type: 'long-animation-frame'
});
```

> Warning! This is a fresh API, just in Origin Trial. The guidance for use with Event Timing is evolving!  For example, LoAFs are only available for frames > 50ms, not for every interaction.

- Each LoAF entru marks a time range (main thread time).
- Overlap with Interaction processing time marks an interesting LoAF.
- Take Events within the animation frame time range (less grouping)
- Measure processing times same as before
- LoAF also gives render time breakdowns, and script attribution.

<details>
<summary>LoAF + Event Timing</summary>

```js
const loafs = [];

new PerformanceObserver(list => {
	for (let entry of list.getEntries()) {
		loafs.push(entry);
	}
}).observe({
	type: 'long-animation-frame',
	buffered: true
});

new PerformanceObserver(list => {
	const frameData = {};
	for (let entry of list.getEntries()) {
		while (loaf = loafs[0]) {
			const endTime = loaf.startTime + loaf.duration;
			// This event is obviously from a previous frame (or isn't long and doesn't need Next Paint)
			if (entry.processingEnd < loaf.startTime) {
				console.assert('impossible 1');
				break;
			}

			// This event is obviously for a future frame
			if (entry.processingStart > endTime) {
				loafs.shift();
				continue;
			}

			if (loaf.startTime <= entry.processingStart) {
				// console.log('match', loaf, entry);
				frameData[loaf.startTime] ??= { loaf, events: [] };
				frameData[loaf.startTime].events.push(entry);
				break;
			}
			
			console.assert('impossible 2');
		}
	}

	for (let { loaf, events } of Object.values(frameData).filter(data => data.events.some(entry => entry.interactionId > 0))) {
		// console.log(loaf, events);

		const loafEndTime = loaf.startTime + loaf.duration;
		let maxPresentationTime = 0;
		let totalProcessingTime = 0;
		let prevEnd = 0;
		for (let {startTime, processingStart, processingEnd, duration } of events) {
			maxPresentationTime = Math.max(maxPresentationTime, processingEnd, startTime + duration);
			totalProcessingTime += processingEnd - Math.max(processingStart, prevEnd);
			prevEnd = processingEnd;
		}

		const processingStart = events[0].processingStart;
		const processingEnd = events.at(-1).processingEnd;
		const percent = totalProcessingTime / (processingEnd - processingStart) * 100;

		performance.measure(`Interaction.InputDelay`, {
			start: events[0].startTime,
			end: events[0].processingStart
		});
		performance.measure(`Interaction.Processing [${percent.toFixed(1)}%]`, {
			start: processingStart,
			end: processingEnd
		});
		performance.measure(`Interaction.Rendering`, {
			start: loaf.renderStart,
			end: loafEndTime,
		});
		performance.measure(`Interaction.PresentationDelay`, {
			start: loafEndTime,
			end: maxPresentationTime
		});
		
	}


}).observe({
	type: 'event',
	durationThreshold: 0,
	buffered: true
});
```
</details>

# Fin

## Some useful techniques to know

> Basically, a `requestPostAnimationFrame()` polyfill

```js
async function afterNextPaint() {
  return new Promise(resolve => requestAnimationFrame(async () => {
    // I'm using scheduler.yield() for highest odds to get scheduled.
    // Alternative: setTimeout(..., 0)
    await scheduler.yield();
    resolve();
  }));
}
```

- In React: `startTransition`

## Some quirky problems to watch for

- yielding to split long task vs waiting for after next paint
- isInputPending() inside event handlers
- Hover events, especially mobile
- Callbacks during (idle) periods before next paint
- Unload handlers vs deferred work
