# Nintendo 64 Feature Constraints Table

| **Feature** | **Standard N64 (4 MB RAM)** | **With Expansion Pak (8 MB RAM)** |
|-------------|------------------------------|-----------------------------------|
| **CPU** | 64-bit MIPS R4300i RISC at 93.75 MHz | No change |
| **Graphics Processor** | Reality Coprocessor (RCP) at 62.5 MHz | No change |
| **System Memory** | 4 MB Rambus DRAM | 8 MB Rambus DRAM |
| **Resolution** | 256×224 to 640×480 pixels<br/>320×240 common | Higher resolutions more feasible<br/>640×480 more common |
| **Texture Memory (TMEM)** | 4 KB cache (unchanged) | 4 KB cache (unchanged) |
| **Texture Size** | 32×32 pixels max for 32-bit RGBA | Same limitation, but more textures in RAM |
| **Polygon Performance** | ~160,000 polygons/second | Same, but more complex scenes possible |
| **Per-Frame Budget** | ~5,333 polygons at 30 FPS | Same theoretical limit |
| **Character Models** | 250-750 triangles per character<br/>Main: 500-750, Secondary: 250-400 | More complex characters possible<br/>Higher detail models |
| **Environmental Geometry** | 1,000-4,000 triangles per scene<br/>2,000-3,000 typical | More detailed environments<br/>Larger scenes possible |
| **Scene Composition** | Main char: 500-750<br/>Environment: 2,000-3,000<br/>Effects: 500-1,000<br/>Total: ~3,200-5,150 | More complex scenes<br/>Additional characters/objects |
| **Audio** | 16-bit stereo at 44.1 kHz<br/>Up to 100 PCM channels | Higher quality audio possible<br/>More complex audio processing |
| **Storage** | Cartridge: 8-64 MB | No change |
| **Skeletal Animation** | Limited by memory/CPU<br/>Reduced bone counts for performance | More complex animations possible<br/>Higher bone counts |
| **Vertex Animation** | ~191KB for 44 frames (272 vertices) | Same per-frame, but more frames possible |
| **LOD Systems** | Distance-based detail reduction<br/>Culling for performance | More aggressive LOD possible<br/>Better detail management |
| **Compression Techniques** | ADPCM audio, texture quantization<br/>Custom data compression | Less aggressive compression needed<br/>Better quality assets |

## Nintendo 64 3D Pathfinding Techniques

### Pathfinding Methods
**Waypoint Navigation:**
- **Predefined waypoints** placed throughout game environments
- AI characters move from waypoint to waypoint
- **Reduced computational load** compared to dynamic pathfinding
- Used in games like "Super Mario 64" for enemy patrol patterns

**Grid-Based Pathfinding:**
- **Environment divided into grid cells**
- **Simplified A* algorithm** adapted for grid navigation
- **Bounding box/sphere collision detection** for efficiency
- Limited search space to reduce processing demands

**Scripted Paths:**
- **Predetermined routes** for AI characters
- **No real-time pathfinding** calculations needed
- Used for linear game sections and cutscenes
- **Event-driven triggers** for path changes

### Common AI Practices

**Finite State Machines (FSMs):**
- **Limited states:** idle, patrol, chase, attack, flee
- **State transitions** based on triggers (player proximity, health, etc.)
- **Computationally efficient** and easy to implement
- Used extensively in "Super Mario 64" for Goombas, Koopas

**Behavior Trees:**
- **Hierarchical decision-making** structure
- **Reusable AI behaviors** across different characters
- **More flexible** than FSMs but still performance-conscious
- **Modular design** for complex AI systems

**Level of Detail (LOD) for AI:**
- **Reduced AI complexity** for distant characters
- **Simplified behaviors** for off-screen NPCs
- **Reduced update frequencies** for background characters
- **CPU cycle conservation** for critical tasks

**Event-Driven AI:**
- **Triggered responses** to player actions
- **Scripted sequences** for specific scenarios
- **No continuous processing** required
- **Predictable behavior** with minimal resource usage

### Performance Optimizations

**Collision Detection:**
- **Bounding boxes/spheres** instead of complex geometry
- **Simplified collision calculations**
- **Spatial partitioning** for efficient object queries

**Memory Management:**
- **AI data streaming** from cartridge
- **Compressed behavior data**
- **Shared AI routines** across similar characters

**Update Scheduling:**
- **Frame-rate dependent** AI updates
- **Priority-based processing** (player proximity)
- **Batch processing** of similar AI behaviors

## Compression Techniques Used

**Texture Compression:**
- **Color quantization** and **palettization**
- **Texture tiling** to fit 4 KB TMEM
- **Custom algorithms** for real-time decompression

**Audio Compression:**
- **ADPCM (Adaptive Differential Pulse Code Modulation)**
- **Lower sampling rates** to conserve space
- **Compressed formats** to fit cartridge storage

**Data Compression:**
- **Custom algorithms** for game data
- **Real-time decompression** during gameplay
- **Streaming** from cartridge to RAM

**Memory Management:**
- **Level of Detail (LOD)** systems
- **Distance-based detail reduction**
- **Animation streaming** from storage
- **Unified memory architecture** (CPU/GPU shared)

The Expansion Pak primarily doubled RAM, allowing for more complex assets and better utilization of existing storage, but didn't change fundamental hardware limitations like TMEM cache size or processing power.

## Skybox/Skydome Rendering on N64

**Techniques:**
- **6-sided skybox (cube):** Rendered as 4–6 quads around the camera with inward-facing faces; textures were palettized and often tiled to fit TMEM.
- **Skydome/hemisphere:** Low-poly dome with vertex color gradients and simple horizon bands for smooth color transitions.
- **Parallax-free background:** Camera translation removed (or geometry follows camera position) so the sky does not parallax with the world.
- **Ordering:** Sky drawn with depth test enabled but **depth writes disabled**, or drawn first; unlit material (no per-pixel lighting) to keep cost minimal.

**Constraints & asset format:**
- **TMEM 4 KB per tile:** Faces split into 32×32 or 64×64 tiles; palettized CI4/CI8 or RGBA16 textures; nearest filtering; no mipmaps.
- **Typical per-face size:** 64×64 to 128×128 effective, often tiled; horizon strips might use long, short quads to minimize tile count.
- **Fog integration:** Distance fog blended with sky color; horizon color matched fog to hide far clipping and transitions.
- **No PBR:** Flat/unlit shading or vertex color gradients; clamped UVs at seams; minimal overdraw.

**Implementation guidance (modern emulation):**
- Use a large inward-facing cube or dome that **follows the camera position** each frame to eliminate parallax.
- Use **unlit materials** (no lights) and set `depthWrite = false` so the sky never occludes scene geometry.
- Prefer a **simple vertical gradient** (vertex/fragment shader) to avoid additional textures, or use a small tiled atlas respecting the ~4 KB per-tile idea.
- Blend scene **fog** to the horizon/sky colors to mimic N64 transitions.

## Particle Effects Budget

- **Active particles per frame:**
  - **Standard:** ≤ 256 (≈512 triangles)
  - **With Expansion Pak:** ≤ 512 (≈1024 triangles)
- **Caps and spawning:** per-emitter cap and global cap; spawn rate limiting
- **Particle textures:**
  - ≤ 32×32 RGBA8, or palettized 8bpp/4bpp tiles where (w×h×bpp)/8 + palette ≤ 4 KB (TMEM)
  - Atlas allowed; nearest filtering; no mipmaps
- **Update policy:** LOD-reduce updates for off-screen/distant particles; overflow policy drops oldest or halves spawn rate

## UI Image Constraints

- **Allowed formats:**
  - PNG-8 palettized (≤256 colors); prefer ≤16 colors for 4bpp path
  - PNG RGBA only for sprites ≤ 32×32
- **Sprite max size:**
  - **Standard:** ≤ 64×64 px
  - **With Expansion Pak:** ≤ 96×96 px
- **Atlas max size:**
  - **Standard:** ≤ 256×256 px
  - **With Expansion Pak:** ≤ 512×256 px
- **TMEM fit:** each UI tile/region must fit ≤ 4 KB including palette; atlas regions should be multiples of 8 px (tile-aligned)
- **Per-frame UI TMEM tiles:**
  - **Standard:** ≤ 8 tiles
  - **With Expansion Pak:** ≤ 12 tiles
- **Rendering:** scale from internal 320×240 using nearest-neighbor; no mipmaps; no PBR