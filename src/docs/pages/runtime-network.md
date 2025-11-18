# Network System

The networking system provides basic multiplayer capabilities, supporting both local network play (via a WebSocket relay) and internet play (via Multisynq).

It handles player state replication (position, rotation) and remote player spawning/interpolation.

## Usage

### LAN (Local Network)

1.  **Start the Relay Server**:
    ```bash
    node server.js
    # Server starts on port 8080
    ```

2.  **Connect Clients**:
    Open the game with the `?lan` parameter:
    ```
    http://localhost:5173/?lan=true
    ```
    This connects to `ws://localhost:8080` by default. You can specify a different address:
    ```
    http://192.168.1.5:5173/?lan=ws://192.168.1.5:8080
    ```

### Multisynq (Internet)

1.  **Get Credentials**:
    Obtain an API Key from [multisynq.io/coder](https://multisynq.io/coder).

2.  **Connect Clients**:
    Open the game with the `?multisynq` or `?key` parameter:
    ```
    http://localhost:5173/?multisynq=true&key=YOUR_API_KEY&id=your.app.id
    ```

## Architecture

The system is abstracted so the game logic doesn't need to know which transport is being used.

### `NetworkSystem` (LAN)
*   **File**: `src/runtime/network.js`
*   **Transport**: Raw WebSocket to a local relay server.
*   **Protocol**: JSON messages (`hello`, `join`, `leave`, `state`).
*   **Replication**: Sends local player state at 20Hz.

### `MultisynqNetworkSystem` (Internet)
*   **File**: `src/runtime/multisynq.js`
*   **Transport**: Multisynq SDK.
*   **Model**: Uses a synchronized `Three64Model` class to store player data in the session state.
*   **Events**: Uses Multisynq's pub/sub for movement updates to ensure low latency.

### Remote Players
When a remote player joins, the system:
1.  Spawns a `Player` archetype (or fallback object).
2.  Disables the `Player` component on that instance (so it doesn't process local input).
3.  Interpolates its position and rotation based on incoming state updates.

