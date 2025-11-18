# runtime/audioSystem.js

## API

### `class AudioSystem`
Simple Web Audio API wrapper with voice counting for budgeting.

- `init()`: Initializes the AudioContext (resume on user interaction).
- `loadBufferFromUrl(url) -> Promise<AudioBuffer>`: Decodes audio data.
- `playOneShot(buffer, { volume })`: Plays a sound effect. Returns a voice object or `null` if budget exceeded.
- `playBeep({ frequency, durationMs, volume })`: Generates a synthesized beep (useful for debugging or placeholders).

**Budgeting:**
- Respects `config.budgets.audio.maxVoices` (default ~24).
- Prevents new sounds from playing if the voice limit is reached.

## Usage

```js
const audio = new AudioSystem();
await audio.init();

// Load
const jumpSfx = await audio.loadBufferFromUrl('assets/audio/jump.wav');

// Play
audio.playOneShot(jumpSfx, { volume: 0.8 });
```
