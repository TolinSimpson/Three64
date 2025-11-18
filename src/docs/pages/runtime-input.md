# runtime/input.js

## API

### `class Input`
Handles composite input from Keyboard, Gamepad, and Touch (Mobile).

**Constructor:**
- `constructor(domElement)`: Attaches event listeners to the DOM element (default: `document.body`).

**Properties (Read-only):**
- `inputState`: Returns the current frame's input state object:
  ```js
  {
    x: number,      // -1 to 1 (Strafe: Left/Right)
    y: number,      // -1 to 1 (Move: Back/Forward)
    sprint: boolean,// Shift or Gamepad Button
    crouch: boolean,// Ctrl or Gamepad Button
    jump: boolean   // Space or Gamepad Button (or touch tap)
  }
  ```

**Methods:**
- `consumeLookDelta() -> { dx, dy }`: Returns accumulated mouse/touch/gamepad look delta since last call. Resets internal counters.
- `consumeJumpQueued() -> boolean`: Returns true if a jump was queued (e.g., via touch tap) and resets the flag.

**Controls:**
- **Keyboard**: WASD / Arrows to move. Shift to sprint, Ctrl to crouch, Space to jump.
- **Touch**: Left-half virtual joystick for movement. Right-half drag to look. Tap right-half to jump.
- **Gamepad**: Left stick move, Right stick look. Buttons mapped to jump/crouch/sprint.

## Usage

```js
import { Input } from './runtime/input.js';

const input = new Input(document.body);

function update(dt) {
  const state = input.inputState;
  const look = input.consumeLookDelta();

  if (state.jump || input.consumeJumpQueued()) {
    // Handle jump
  }

  // Apply movement: state.x, state.y
  // Apply rotation: look.dx, look.dy
}
```
