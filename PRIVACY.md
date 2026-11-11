# Privacy and data handling

Stillpoint is a wellness experience that measures pulse, breathing rate, and HRV from a camera. It
was designed so that the sensitive part — the camera frames — never leaves the machine.

## Summary

| Question | Answer |
| --- | --- |
| Are camera frames stored? | No. Frames live in memory and are dropped after measurement. |
| Are frames uploaded? | No. By default the local SDK process opens the camera; a small preview is sent to the page over a loopback WebSocket. Nothing is uploaded. |
| Are measurements stored? | No. They stay in memory for the session and are discarded at the end. |
| Is anything logged? | Stillpoint does not log frames or measurements. Server console output is limited to startup and error messages. |
| Is SDK telemetry enabled? | No. `enableTelemetry: false` is set explicitly. |
| Is any AI service used? | No optional or third-party AI service. Measurement runs in the local Presage SDK. |
| Is there an account or analytics? | No account, no analytics, no advertising, no tracking. |
| Can I delete data? | Stop the session or close the tab. There is no stored data to delete. |

## Consent

1. The intro screen requires an explicit consent checkbox before **Begin** is enabled.
2. In the default native mode, the local Stillpoint process opens the camera only after **Begin**.
   No browser camera prompt is needed. In `CAPTURE_MODE=frames`, the browser prompt is a second,
   independent gate.
3. Expression analysis is optional and **off by default**. Enable it if you want the scene to
   respond; when off, the SDK is not asked for the expression metric at all.

Consent is not bundled with other actions, and the camera is not opened before consent.

## What is captured

- The camera provides video only, never audio.
- In the default mode, the Stillpoint Node process opens the camera with the SDK's
  `useCamera()` path at up to 1280×720. Frames stay inside that process for measurement.
- A 320×240 RGBA preview is downsampled from the SDK's processed frame and sent to the page over a
  loopback WebSocket. It is not recorded. You can hide it during the session.
- In the `CAPTURE_MODE=frames` fallback, the browser captures up to 1280×720 and sends 640×480 RGBA
  frames over `ws://127.0.0.1` (or `localhost`) to the Node process, which uses
  `useCustomInput()` and `sendFrame()`.

## Where processing happens

The SmartSpectra SDK runs natively in the local Node process. It computes pulse rate, breathing
rate, HRV, and — if enabled — facial expression. Stillpoint requests only those four metrics, not
traces, landmarks, blinking, or talking. Derived measurements are pushed to the browser over a
loopback Server-Sent Events connection for display.

No cloud inference is used by Stillpoint. Stillpoint does not send frames or measurements to
Presage. The SDK authenticates the API key and validates the subscription, and may obtain its model
or update files from Presage; those requests do not include Stillpoint's frames or measurements.

## What leaves the machine

The SDK authenticates the API key and checks the subscription with Presage. That request can
identify the key/account, but Stillpoint does not attach frames or measurements to it. The SDK may
also obtain model or update files. The SDK's telemetry option is disabled:

```js
new SmartSpectraSDK({
  apiKey,
  requestedMetrics,
  enableTelemetry: false,
});
```

See the Presage [Telemetry and Privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy)
documentation for the SDK's own behavior.

## Storage, retention, and deletion

- No frames are written to disk, cached in a file, or stored in a database.
- No measurements are persisted by Stillpoint.
- The server does not log frame contents or metric values.
- Metrics remain in memory for the duration of the session.
- On **Stop**, Escape, tab hide, disconnect, or normal completion, the camera is released, sockets
  are closed, and the session state is released.
- Closing the tab or stopping the server clears the remaining in-memory state.
- If the optional `DEMO_VIDEO` variable is set, a local clip chosen by the operator is read by the
  SDK. It is not uploaded. The clip is not part of the default setup and is excluded from git.

## Sharing

Stillpoint does not share frames or measurements. There are no analytics providers, ad networks,
cloud storage services, or optional AI integrations. The only third party involved is Presage for
API-key validation.

## Security boundaries

- The HTTP server binds to `127.0.0.1` by default.
- WebSocket upgrades and control requests are origin-checked.
- A strict Content Security Policy blocks external scripts, styles, frames, and connections.
- The app loads no external fonts, images, or CDNs.
- The browser-facing `Permissions-Policy` allows camera only for the same origin (used by the
  `frames` fallback) and blocks microphone. In native mode the server process owns the camera.
- Responses set `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and
  `Cross-Origin-Opener-Policy: same-origin`.

## Demo mode

`DEMO_VIDEO` exists for development and headless testing. The server feeds a local file to the SDK
with `useFile()` and serves the same file to the browser preview. Nothing is uploaded. Do not point
it at a clip you do not have permission to use.

## Wellness, not medicine

SmartSpectra metrics are for general wellness and informational purposes. They are not FDA-cleared
and are not a diagnosis or treatment. Stillpoint does not provide medical advice, make medical
decisions, or monitor anyone covertly. It is not intended for emergencies or clinical use.

## Contact

Open an issue in the public repository for privacy questions or deletion requests. Because the app
stores nothing, there is typically nothing to delete beyond the in-memory session.
