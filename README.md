# Stillpoint

**A two-minute, camera-only breathing retreat that starts from the rhythm you already have.**

Stillpoint reads your pulse and breathing through a webcam with the
[Presage SmartSpectra SDK](https://smartspectra.presagetech.com/docs), then guides you into a
slower rhythm instead of asking you to match an arbitrary one.

- 32 seconds of quiet settling while the SDK learns your breathing rate
- 90 seconds of guided breathing paced from that measurement
- Live pulse, breathing rate, and HRV in the interface
- An optional expression-responsive color scene
- No wearable, account, recording, upload, or analytics
- Not a medical device; wellness only

> Built for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04).

[Watch the 2-minute demo](https://github.com/pham-canh/stillpoint/releases/download/demo-v1/stillpoint-demo.mp4)
· [Release page](https://github.com/pham-canh/stillpoint/releases/tag/demo-v1)

The demo uses a 70-second shortened session (`SETTLE_MS` / `SESSION_MS`) to keep the video tight;
the default experience is 32 seconds of settling plus 90 seconds of guided breathing.

## Requirements

- Node.js 20 or newer
- A supported platform for the SmartSpectra native SDK:
  - macOS on Apple Silicon (`darwin-arm64`)
  - Linux x64 or arm64 (`linux-x64`, `linux-arm64`)
  - Windows x64
- A webcam connected to the machine running the server (the SDK opens it natively)
- A modern browser for the interface (Chrome or Edge recommended)
- A Presage developer API key

The SmartSpectra Node SDK ships native binaries and does **not** support Intel Macs
(`darwin-x64`). Stillpoint's UI still loads on unsupported platforms, but a session cannot start
there. Use a supported machine, or use the `DEMO_VIDEO` file mode for development.

## Quick start

```bash
git clone <this-repository> stillpoint
cd stillpoint
npm install
cp .env.example .env
```

Add your key to `.env`:

```dotenv
SMARTSPECTRA_API_KEY=your_presage_key
```

Start the local server:

```bash
npm start
```

Open <http://127.0.0.1:4317>, read the consent note, and press **Begin**. The local Node process
opens the camera with the SDK's native capture; there is no browser camera prompt in the default
mode. The server binds to loopback only, so open the app through `127.0.0.1` or `localhost`.

If the server cannot access a camera (for example, it runs in a container without `/dev/video0`),
set `CAPTURE_MODE=frames` to use the browser camera fallback instead.

## How a session works

1. **Consent.** Nothing starts until you tick the consent checkbox. Expression analysis is optional
   and off by default; enable it only if you want the scene to respond.
2. **Capture.** After **Begin**, the local Node process opens the camera with the SDK's native
   `useCamera()` path at up to 1280×720. Frames stay inside that process and are never written to
   disk. A downsampled 320×240 RGBA preview is sent over loopback so you can check your framing.
3. **Measure.** The SDK estimates pulse rate, breathing rate, HRV, and (optionally) expression. The
   app requests only those four metrics; it does not request traces, landmarks, blinking, or talking.
4. **Settle.** For 32 seconds the interface stays out of the way while the breathing rate warms up.
5. **Guide.** The pacer starts at your measured breathing period, clamped to 6–12 seconds. It eases
   toward a 10-second period by 750 ms per breath and never speeds up a slower breather. The orb
   grows on a 40% inhale and settles on a 60% exhale.
6. **Finish.** At 90 guided seconds the session stops, releases the camera, and shows a local
   summary. Nothing is saved.

Validation hints from the SDK ("face not centered", "too dark", "chest not visible", and so on)
appear on the preview so you can adjust without guessing.

## Configuration

Copy `.env.example` to `.env`. All values are optional except the API key.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SMARTSPECTRA_API_KEY` | — | Presage developer key. Required for a camera session. |
| `PORT` | `4317` | Local HTTP port. |
| `HOST` | `127.0.0.1` | Bind address. Keep it on loopback unless you know what you are doing. |
| `SESSION_MS` | `90000` | Guided breathing duration in milliseconds. |
| `SETTLE_MS` | `32000` | Unpaced settling duration in milliseconds. |
| `CAPTURE_MODE` | `camera` | `camera` uses the SDK's native camera capture. `frames` uses the browser camera fallback. |
| `CAMERA_ID` | first camera | Opaque device ID from `SmartSpectraSDK.availableCameras()`. |
| `CAMERA_WIDTH` | `1280` | Native capture width. |
| `CAMERA_HEIGHT` | `720` | Native capture height. |
| `CAMERA_FPS` | `30` | Requested native capture frame rate. |
| `DEMO_VIDEO` | — | Path to a local video. When set, the SDK uses `useFile()` instead of the camera. |

## Demo and CI mode

Set `DEMO_VIDEO` to replay a local clip through the same SmartSpectra pipeline:

```bash
DEMO_VIDEO=./fixtures/face.mp4 npm start
```

The browser previews the same clip from `/demo.mp4`, but no frames are sent from the browser in this
mode; the server feeds the file to the SDK with `useFile()`. The clip stays on the machine. This is
useful for headless checks. For a full two-minute demo, the clip needs to be at least
`SETTLE_MS + SESSION_MS` long.

The smoke test uses the same idea without the UI:

```bash
npm run smoke -- ./fixtures/face.mp4
```

It exits non-zero if no live pulse or breathing reading is produced. It requires a supported
platform and a valid key.

## Tests

```bash
npm test
```

The unit tests cover the adaptive pacer and summary statistics. They do not need the native SDK.

## Architecture

```text
Local camera (/dev/video0, AVFoundation, etc.)
   │  SDK native capture: useCamera()
   ▼
Node server (server.mjs) ── SmartSpectra SDK ── metrics events
   │                              │  pulseRate, breathing.rate, hrv, expression
   │                              ▼
   │                     SDK videoOutput (processed frame)
   │                              │  downsample to 320×240 RGBA
   ├──── Server-Sent Events ◄─────┘  (loopback)
   │       metrics, validation, status, ended
   └──── control WebSocket + binary preview (loopback) ───► Browser UI
                                                             pacer, scene,
                                                             metrics, summary
```

- `server.mjs` — HTTP static server, SSE stream, control WebSocket, preview downsampling,
  camera selection, session lifecycle.
- `lib/session.mjs` — SmartSpectra wrapper: native camera or file/custom input, requested metrics,
  decoding, deduplication, summary.
- `public/app.js` — consent, camera mode, preview canvas, pacer, metrics, summary.
- `scripts/smoke.mjs` — headless SDK smoke test with a local video.
- `public/lib/pacer.js` — adaptive breathing pacer.
- `public/lib/stats.js` — median/confidence summary helpers.
- `public/scene.js` — canvas landscape, heartbeat ripples, optional expression palette.
- `docs/decisions.md` — pacer, privacy, HRV-confidence, and testing decisions.

## Privacy

In the default native mode, the local Node process opens the camera and frames stay inside that
process. A small 320×240 preview is sent over loopback to the page so you can check framing. Frames
are dropped after measurement; nothing is recorded or uploaded. Measurements stay in memory for the
session and are discarded at the end. SDK telemetry is disabled. The SDK authenticates the API key
with Presage; see [PRIVACY.md](PRIVACY.md) and the in-app page at `/privacy`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `The server has no Presage API key` | Add `SMARTSPECTRA_API_KEY` to `.env` and restart. |
| `401` / `Authentication required` | The key is invalid, expired, or out of credits. Create a new key in the Presage developer portal. |
| `SmartSpectra could not load on darwin-x64` | The native SDK does not ship an Intel Mac build. Use Apple Silicon, Linux, or Windows. |
| Camera permission blocked | In the default mode, give the **server process** access to the camera. In `CAPTURE_MODE=frames`, allow the camera for `127.0.0.1` / `localhost` in the browser. |
| Camera already in use | Close other apps that hold the camera (browser tabs, OBS, Zoom). Or set `CAPTURE_MODE=frames` and let the browser own it. |
| `No camera found` / `kInputUnavailable` | Check the device is connected, then set `CAMERA_ID` from `SmartSpectraSDK.availableCameras()`. |
| Low signal or no pulse | Use even light, keep the camera still, and keep your face and upper chest in frame. |
| `kSustainedLowFrameRate` | Close other camera or CPU-heavy apps. Native capture needs a steady frame rate; a USB 2.0 camera may settle around 24–26 fps at 720p. |
| Port already in use | Set `PORT` in `.env` and open the new port. |

## License

MIT. See [LICENSE](LICENSE).

SmartSpectra is a product of Presage Technologies. This project is an independent challenge entry
and is not affiliated with Presage.
