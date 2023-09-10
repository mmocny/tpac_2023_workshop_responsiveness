# TPAC 2023 workshop: Responsiveness

> Michal Mocny, mmocny@google.com, Sept 2023

> For Web Perf WG

## Goals

- It's a workshop!
	- (Don't just sit there, follow along!)
- Explore options for measuring events & showcase Performance Timeline
- Share some recommendations for simplification
- Discuss a useful(?) model for breaking down Event Latency into parts
- Look at several quirky problems examples, and some useful techniques

## Useful Links

- [This repo](httpss://github.com/mmocny/tpac_2023_workshop_responsiveness)
- [INP demo page](https://inp-demo.glitch.me)
- [Event Timing spec](https://w3c.github.io/event-timing/)
- [LoAF Explainer](https://github.com/w3c/longtasks/blob/main/loaf-explainer.md)

> Note: Testing in Chrome Canary with Experimental Web Platform Featues enabled
## 1. Measuring Events, manually

Let's attempt to measure Events, with a simple wrapper:

```js
function measureEvent(callback) {
	return (event) => {
		// TODO: add measurement
		callback(event);
	}
}
```

To be used, as such:
```js
document.addEventListener('click', measureEvent((event) => {
	console.log(event);
}));
```

<details>
<summary>Answer: measuring event processing times</summary>

```js
function measureEvent(callback) {
	return (event) => {
		performance.measure('Event.InputDelay', {
			start: event.timeStamp,
			end: performance.now(),
		});

		const processingStart = performance.now();

		callback(event);

		performance.measure('Event.Processing', {
			start: processingStart,
			end: performance.now(),
		});
	}
}

function block(ms) {
	const target = performance.now() + ms;
	while (performance.now() < target);
}

for (let type of ['keydown','keyup','pointerdown','pointerup','click']) {
	document.addEventListener(type, measureEvent((event) => {
		console.log(event);
		block(20);
	}), { capture: true });
}
```
</details>

## When are Effects done?

- **synchronous** effects, such as `console.log()` or using `localStorage` are "done" right away.
- **asynchronous** effects, such as fetch() response processing, don't resolve until after event is done.
	- TODO: callout to Thursday talk
- "Rendering" is a very specific type of asynchonous effect.
- "Responsiveness" typically refers specifically to _visual responsiveness_
	- e.g. Interaction to Next Paint (INP)
	- Note: Accessibility features often rely on rendering as well (style, layout, etc).

Let's update our measurement snippet to include rendering work:

<details>
<summary>Answer: measuring event rendering work as well</summary>

```js
function measureEvent(callback) {
	return (event) => {
		performance.measure('Event.InputDelay', {
			start: event.timeStamp,
			end: performance.now(),
		});

		const processingStart = performance.now();

		callback(event);

		performance.measure('Event.Processing', {
			start: processingStart,
			end: performance.now(),
		});

		requestAnimationFrame(async () => {
			const renderStart = performance.now();

			try {
				// This option is measurably better in many scenarios
				await scheduler.yield();
				performance.measure('Event.Rendering', {
					start: renderStart,
					end: performance.now(),
				});
			} catch {
				// Fallback option
				setTimeout(() => {
					performance.measure('Event.Rendering', {
						start: renderStart,
						end: performance.now(),
					});
				}, 0);
			}
		});
	}
}

function block(ms) {
	const target = performance.now() + ms;
	while (performance.now() < target);
}


for (let type of ['keydown','keyup','pointerdown','pointerup','click']) {
	document.addEventListener(type, measureEvent((event) => {
		console.log(event);
		block(20);
	}), { capture: true });
}
```
</details>

Try it:
- Multiple event listeners
- Multiple event types
- `{ capture: true }`
- `{ passive: true }`

## Discussion: Measuring manually

- Advantage: Access to context (custom components, state).
- Advantage: Measurement *before* DOM modifications.
- Advantage: Synchronous measures, no document unload risk.
- Disadvantage: Difficult to actually measure accurately
	- Unlikely to measure *all* event handlers
	- Imperfect visibility, especially for "next paint"
- Disadvantage: Computational Overhead
- Disadvantage: Late bootstrapping

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
TODO: Image of a single Event Timing

### Multiple Event Timings
TODO: Image of multiple Event Timings

> How many events, really?

```js
// Look at all those events
Object.fromEntries(performance.eventCounts)

// Count of all events
Array.from(performance.eventCounts.values()).reduce((a,b) => a + b)
```

### Clearing the clutter

- Sometimes multiple events dispatch for a single input "gesture"
- Events can "nest" (but its not consistent)
- Sometimes multuple input "gestures" arrive within a single animation frame

Strategy:

1. Filter Events down to interesting time ranges
	- e.g. overlap with Interactions, largest INP
1. Group events (by common presentation time).
1. Mark the smallest `processingStart`
1. Mark the largest `processingEnd`
1. Sum the total (non-overlapping) processing time


<details>
<summary>Visualize just Interaction time ranges</summary>

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

With Event timing API, we gained accurate measurement of processing times, and presentation -- but lost the ability to measure rendering work.  It was also a lot of work to "group events by animation frame".

Let's use the new LoAF API, instead!

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

> Warning! This is a fresh API, just in Origin Trial. The guidance for use with Event Timing is evolving!

Each LoAF event marks that start of some work that caused a visual update (an invalidation).

> Technically, some LoAF do not, and are equivalent to plain Long Tasks, but this same feature applies to Event Timing.

## Some useful techniques

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

## Some quirky problems

- Hover
- isInputPending()