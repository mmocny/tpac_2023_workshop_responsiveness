import measureLoAFs from './measureLoAFs.js';
import measureEventProcessing from './measureEventProcessing.js';
import measureInteractions from './measureInteractions.js';
import measureEventManually from './measureEventManually.js';

const interestingEvents = [
	'keydown',
	'keyup',
	'pointerdown',
	'pointerup',
	// 'keypress',
	// 'click',
	// 'input',
	// ...
];

function block(ms) {
	const target = performance.now() + ms;
	while (performance.now() < target);
}

function measureAll() {
	// measureInteractions();
	// measureEventProcessing();
	// measureLoAFs();

	for (let type of interestingEvents) {
		document.addEventListener(type, measureEventManually((event) => {
			// console.log(event.type, event.target);
			block(20);
		}), { capture: true });
	}
}

measureAll();