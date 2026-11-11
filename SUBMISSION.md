# DEV submission draft

Paste the section below into a new DEV post. Required front matter:

```yaml
---
title: Stillpoint: a two-minute breathing retreat that learns your rhythm
published: false
tags: devchallenge, presagechallenge
---
```

The post must be in English to be eligible for prizes. Replace every `<...>` placeholder before
publishing. Keep the post public, and confirm the repository and demo video are public too.

---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04)*

## What I Built

**Stillpoint** is a two-minute, camera-only breathing retreat. It measures your natural breathing
rate through a webcam, then guides you into a slower rhythm that starts from where you already are.

Most breathing apps ask you to match a fixed pace. Stillpoint does the opposite: it spends 32
seconds quietly learning your rhythm, then eases the guide toward a calmer 10-second breath without
ever making a slow breather go faster. An orb grows and settles with the pace, live pulse and
breathing values appear as they become reliable, and the landscape subtly responds to your
expression if you enable that optional setting.

There is no wearable, no account, no recording, and no upload. The whole experience is designed
around a simple constraint: the camera frames should never leave the machine.

## Demo

[Watch the 2-minute demo (MP4)](https://github.com/pham-canh/stillpoint/releases/download/demo-v1/stillpoint-demo.mp4)

Release page: https://github.com/pham-canh/stillpoint/releases/tag/demo-v1

The demo shows a live session on a Linux x64 machine with a USB camera: the local camera preview,
live SmartSpectra pulse and breathing readings (HRV when the signal is ready), validation hints, the
adaptive pacer, and the summary. The app is shown running locally, which is the intended deployment.
The recording uses a 70-second shortened session via `SETTLE_MS` / `SESSION_MS`; the default is 32
seconds of settling plus 90 seconds of guided breathing.

## Code

https://github.com/pham-canh/stillpoint

Setup:

```bash
git clone https://github.com/pham-canh/stillpoint.git
cd stillpoint
npm install
cp .env.example .env   # add SMARTSPECTRA_API_KEY
npm start
# open http://127.0.0.1:4317
```

Requirements and platform notes are in the README. The SmartSpectra Node SDK ships native
binaries, so the app runs on macOS Apple Silicon, Linux x64/arm64, and Windows x64; Intel Macs are
not supported by the SDK. The UI still loads on unsupported platforms, and a local video can drive
the same pipeline through `DEMO_VIDEO` for testing.

## How It Responds to Human Signals

Stillpoint uses three live SmartSpectra signals by default — **pulse rate**, **breathing rate**, and
**HRV** — plus **expression** when the optional scene setting is enabled. It requests only those
four metrics, not traces, landmarks, blinking, or talking.

The integration path:

1. The local Node process opens the camera with the SDK's native
   `useCamera(CameraSelection.byId(id), { width: 1280, height: 720, fps: 30 })` path. Frames stay
   inside that process; there is no browser-to-server frame hop and no browser camera prompt in the
   default mode.
2. The SDK emits metric buffers. `decodeMetrics` reads
   `metrics.breathing.rate.at(-1)`, `metrics.cardio.pulseRate.at(-1)`,
   `metrics.cardio.hrv.at(-1)`, and, when enabled, `metrics.face.expression.at(-1)`.
3. The SDK's `videoOutput` event provides a processed frame. The server downsamples it to a
   320×240 RGBA preview and sends it to the browser over the loopback control WebSocket, so the
   person can check framing without a second camera consumer.
4. The server pushes deduplicated samples to the browser over Server-Sent Events. The optional
   `CAPTURE_MODE=frames` fallback keeps the original browser `getUserMedia` → 640×480 RGBA →
   `useCustomInput()` / `sendFrame()` path for machines where the server cannot access a camera.

How the experience reacts:

- **Breathing rate becomes the starting pace.** After a 32-second settle, the pacer begins at the
  measured period, clamped to 6–12 seconds. It eases toward 10 seconds by 750 ms per breath. If your
  measured rhythm is slower than 10 seconds, it stays there.
- **The orb is the guide.** Inhale takes 40% of the cycle and exhale 60%. The orb's radius, the
  landscape's mist, and the reflection on the lake all follow the same breath value.
- **Pulse drives subtle ripples.** Reliable pulse samples add heartbeat ripples to the lake, so the
  scene feels connected to the measurement without turning the session into a dashboard.
- **HRV is shown, not scored.** RMSSD appears when confidence is high enough; there is no
  gamification.
- **Expression is optional art direction.** If enabled, the strongest expression label blends the
  scene palette. Turning it off removes the expression metric from the SDK request entirely.
- **Validation hints are actionable.** "Face not centered", "too dark", "chest not visible", and
  similar SDK hints appear on the preview, then fade back to the resting instruction.

The app uses live SDK readings in the default camera mode. The `DEMO_VIDEO` option uses the same
pipeline with `useFile()` and is intended for tests and recordings, not as the primary experience.

## Prize Categories

Entering **both**:

- **Most Creative or Delightful Use** — a webcam becomes a quiet, responsive landscape rather than a
  vitals dashboard. The adaptive pacer starts from the person instead of a preset, and the optional
  expression palette makes the same two minutes look different for different people.
- **Best Thoughtful Real-World Use** — a low-friction two-minute microbreak for desk workers,
  students, and caregivers. No wearable, no account, no streak, no score. The session is short
  enough to repeat, and the privacy design removes the main reason people avoid camera-based tools.

## Consent and Data Handling

**Consent.** The camera is not opened until the person ticks an explicit consent checkbox and
presses **Begin**. In the default native mode the local Stillpoint process opens the camera at that
point; the browser does not request camera access, so there is no extra browser prompt. Expression
analysis is optional and **off by default**; it can be enabled before starting.

**Frames.** Video only, never audio. In the default mode the local Node process opens the camera at
up to 1280×720 and the SDK processes frames in memory. A downsampled 320×240 RGBA preview is sent to
the page over a loopback WebSocket. Frames are not recorded, written to disk, cached, logged, or
uploaded. The live preview is local and can be hidden. The `CAPTURE_MODE=frames` fallback uses
browser capture and a loopback frame WebSocket instead.

**Measurements.** Pulse, breathing, HRV, and optional expression are computed locally by the
SmartSpectra SDK running natively in the Node process. Derived values are held in memory for the
session, shown in the interface, and discarded when the session ends. Stillpoint does not persist
them.

**Network and third parties.** Stillpoint does not send frames or measurements to Presage. The
SmartSpectra SDK authenticates the API key, verifies the subscription, and may obtain its model or
update files from Presage; those requests do not include Stillpoint's frames or measurements.
Stillpoint has no accounts, analytics, ads, or tracking, and uses no optional AI service. The SDK
telemetry option is explicitly disabled (`enableTelemetry: false`). The page loads no external
scripts, fonts, or images.

**Retention and deletion.** There is no stored data to retain or delete. Stopping the session,
pressing Escape, hiding the tab, disconnecting, or finishing normally releases the camera, closes the
sockets, and releases the in-memory session state. Closing the tab clears the rest.

**Security.** The server binds to `127.0.0.1`, origin-checks WebSocket and control requests, and sets
a strict Content Security Policy. The intended URL is `http://127.0.0.1:4317`.

**Demo video.** The recording was made separately, with the participant's consent, outside the app's
data path. Stillpoint itself does not record the session. If the optional `DEMO_VIDEO` setting is
used, it reads a local clip chosen by the operator; that clip is not uploaded.

Full details: `<repository link>/blob/main/PRIVACY.md` and the in-app `/privacy` page.

**Wellness only.** SmartSpectra metrics are not FDA-cleared and are not a diagnosis or treatment.
Stillpoint does not provide medical advice, make medical decisions, or monitor anyone covertly.

## Agent Session

`<optional: upload the curated transcript, then press Make Public and paste the embed here>`

---

# Pre-submit checklist

- [ ] DEV post uses the template headings and front matter.
- [ ] Tags are exactly `devchallenge, presagechallenge`.
- [ ] Repository is public and contains `README.md`, `PRIVACY.md`, `LICENSE`, and the source.
- [ ] No `.env`, API key, personal clip, or secret is committed.
- [ ] Demo video is public and clearly shows live pulse and breathing values from the SDK.
- [ ] Demo video shows the camera consent step and the optional expression setting.
- [ ] Post links to the privacy note and explains storage, sharing, retention, deletion, SDK
      telemetry, and optional AI use.
- [ ] Both prize categories are named in the post.
- [ ] Post is in English.
- [ ] One entry only; no team submission.
- [ ] Add a cover image (optional but recommended).
- [ ] If an agent session is embedded, it is public and free of secrets.
- [ ] Read the post once on a phone-sized screen.

# Demo video shot list (about 2 minutes)

1. **Cold open (10 s).** "Most breathing apps give you a pace. Stillpoint listens first." Show the
   intro card and the three facts: no wearable, on this device, about 2 minutes.
2. **Consent (10 s).** Tick consent, show the optional expression checkbox (off by default), point
   out the privacy link, then press Begin.
3. **Settle (20 s).** Face and upper chest in frame. Show the preview badge, timer, and the first
   pulse/breathing values appearing. Let one validation hint show and correct it.
4. **Guided pace (45 s).** Show the orb, "Breathe in" / "Breathe out", the breathing value, and the
   adaptive note. Keep the real metrics legible. Cut out dead time but keep it honest. Mention that
the SDK opens the camera locally and the preview is a downsampled loopback stream.
5. **Expression, optional (10 s).** If comfortable, toggle it on the intro before the session and
   show the palette shift; otherwise show the neutral scene and explain the option.
6. **Summary (10 s).** Show time, breaths guided, average pulse, breathing rate, HRV, and the
   wellness disclaimer.
7. **Proof of integration (15 s).** Show the repository, the `useCamera()` call, the `videoOutput`
   preview path, the `decodeMetrics` fields, and `enableTelemetry: false`. Show `npm start` and the
   local URL.
8. **Close (5 s).** "Two minutes. No wearable. Nothing leaves the machine."

Recording tips:

- Use a supported host (Linux x64 or Apple Silicon) and a still camera with even front light.
- Record the browser at 1080p or higher; make the metric numbers readable.
- Do not show keys, `.env`, personal notifications, or other people.
- The demo should show live values changing, not a static screenshot.
- Keep the SDK integration on screen long enough for a judge to verify it.
