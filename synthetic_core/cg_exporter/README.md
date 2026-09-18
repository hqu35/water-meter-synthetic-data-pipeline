# Three.js Water-Meter CG Exporter

This exporter serves the browser renderer locally, connects to a visible Chrome
instance through the Chrome DevTools Protocol (CDP), and writes one RGB image,
one binary mask, and one metadata JSON file.

## Install

From this directory:

```bash
npm ci
```

The browser renderer uses the vendored Three.js modules under `vendor/`. The
Node exporter uses the `playwright` package and an installed Google Chrome.

## Start visible Chrome with CDP

macOS:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/water-meter-cdp
```

Linux (adjust the Chrome executable name if necessary):

```bash
google-chrome --remote-debugging-port=9222 \
  --user-data-dir=/tmp/water-meter-cdp
```

Use a dedicated `--user-data-dir`; modern Chrome does not enable remote
debugging for the normal user profile. The default CDP endpoint is
`http://127.0.0.1:9222` and can be changed with `CDP_ENDPOINT`.

## Export one sample

From this directory, while the CDP-enabled Chrome is running:

```bash
SEED=demo-001 FAMILY=classic_round TRANSPARENT=0 npm run export:single
```

Default artifacts are written relative to the repository, independent of the
shell working directory:

```text
outputs/images/meter_0000.png
outputs/images/meter_0000_mask.png
outputs/metadata/meter_0000.json
outputs/debug/meter_0000_*.png
```

Set `OUTPUT_DIR=/custom/location` to move the entire output tree. The existing
per-file variables have higher precedence when supplied:

- `IMAGE_OUTPUT`
- `MASK_OUTPUT`
- `METADATA_OUTPUT`
- `DEBUG_DIR`

Other useful variables include `WIDTH`, `HEIGHT`, `SEED`, `FAMILY`, `PORT`,
`CDP_ENDPOINT`, `TEXTURE_MODE`, `TEXTURE_KEY`, `ENVIRONMENT_MODE`,
`ENVIRONMENT_KEY`, `TRANSPARENT`, and `DIGITS`.

## Keep the real browser tab open

This visible/manual mode exports the files and then leaves the renderer tab and
local HTTP server running until `Ctrl-C`:

```bash
KEEP_BROWSER_OPEN=1 \
SEED=inspect-001 \
FAMILY=industrial_window \
TRANSPARENT=0 \
npm run export:single
```

The exporter reuses the first context in the externally launched Chrome and
opens a new tab for the render. A normal export closes its tab when complete.

## Build and inspect COCO-OBB output

From the repository root:

```bash
python3 synthetic_core/utilities/build_coco_obb.py \
  --output-root outputs \
  --image-root outputs \
  --out outputs/annotations/coco_obb.json

python3 validation/annotation_check/validate_coco_annotations.py \
  --coco outputs/annotations/coco_obb.json \
  --image-root outputs \
  --out-dir outputs/validation
```

Both utilities also accept absolute paths. The overlay validator defaults to
the same repository-level `outputs/` tree and honors `OUTPUT_DIR`.
