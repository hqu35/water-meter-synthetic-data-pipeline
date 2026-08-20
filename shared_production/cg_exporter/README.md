# Three.js Mechanical Water Meter Layout Generator

Generates high-resolution, pure-white-background PNG images of randomized 2D mechanical water meter front views for AI layout data.

## Generate one PNG

```bash
NODE_PATH=/Users/ququ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
/Users/ququ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node work/export-png.js
```

Optional environment variables:

- `SEED=demo-001` for reproducible layout.
- `WIDTH=3072 HEIGHT=3072` for larger PNGs.
- `PORT=5502` if `5501` is occupied.

Output files are written to `outputs/`.

## Generate a batch

```bash
COUNT=100 WIDTH=2048 HEIGHT=2048 \
NODE_PATH=/Users/ququ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
/Users/ququ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node work/export-batch.js
```

## Generate a 10-image reference sheet

```bash
NODE_PATH=/Users/ququ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
/Users/ququ/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node work/export-reference-set.js
```

This writes `meter_001.png` through `meter_010.png`, a 5x2 collage, and `meter_001_high_precision.png`.
