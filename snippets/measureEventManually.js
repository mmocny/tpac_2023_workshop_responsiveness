export default function measureEventManually(callback) {
	return (...args) => {
		const event = args[0];

		performance.measure('Event.InputDelay', {
			start: event.timeStamp,
			end: performance.now(),
		});

		const processingStart = performance.now();

		callback(...args);

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