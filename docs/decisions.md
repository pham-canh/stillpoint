# Design decisions

## Start from the measured rhythm

The pacer begins at the breathing period measured during the 32-second settle, clamped to 6–12
seconds. It only eases toward a 10-second period when the measured period is shorter than 10
seconds. A person already breathing at 10–12 seconds keeps their own pace; the guide does not
shorten it. The 12-second cap keeps the interface usable for very slow natural rhythms.

## Two minutes, no score

A session is 32 seconds of settling plus 90 seconds of guided breathing. The summary shows time,
breaths guided, average pulse, breathing rate, optional HRV, and signal quality. There is no score,
streak, account, or history; the value is the pause itself.

## Local-only by default

The Node process opens the camera through the SmartSpectra SDK. Frames stay in that process and a
downsampled preview travels only over a loopback WebSocket. The browser is the UI, not a second
camera consumer. The `CAPTURE_MODE=frames` fallback exists for machines where the server cannot
open the camera, but it keeps the same loopback-only path.

## Consent before capture

The camera does not open until the person checks the consent box and presses Begin. Expression
analysis is optional and off by default; when off, the metric is not requested from the SDK. The
in-app privacy page and `PRIVACY.md` describe frames, measurements, retention, deletion, telemetry,
and third parties.

## HRV is shown, not interpreted

HRV is displayed only when the SDK's confidence is high enough. The summary uses the same threshold
instead of presenting an unreliable number. Stillpoint does not diagnose, treat, or make medical
decisions.

## Testing strategy

`public/lib/pacer.js` is pure and covered by unit tests for slow, fast, and clamped rhythms. Server
and session code are exercised through the smoke script and a real camera session on the supported
Linux host. The demo uses the same SDK pipeline with a shortened session so the recording stays
tight; the default experience remains two minutes.
