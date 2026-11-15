# Signalsmith Stretch Web 1.3.2

Official Web Audio / WASM distribution by Geraint Luff / Signalsmith Audio Ltd.

- Package: https://www.npmjs.com/package/signalsmith-stretch/v/1.3.2
- Download: https://registry.npmjs.org/signalsmith-stretch/-/signalsmith-stretch-1.3.2.tgz
- Source: https://github.com/Signalsmith-Audio/signalsmith-stretch/tree/222093b4cc13ddb4d07c826bc3c1559326091731
- License: MIT; upstream `LICENSE.txt` is included.

`SignalsmithStretch.mjs`, `README.md` and `package.json` are unmodified files
from the official package. The module embeds the WASM binary and registers its
own AudioWorklet processor. One4All loads this local file on both threads, so
normal use requires no network download or externally hosted script.

One4All's integration is in `app/voice-natural-pitch.js`. It configures a 40 ms
analysis block with a 10 ms interval and split computation for live speech.
The reported `latencySeconds` is the algorithm's input-plus-output latency;
it does not include microphone, output device, noise suppression or monitoring
buffers. Formant compensation is explicitly enabled independently of the
additional formant shift. A zero `formantBaseHz` uses upstream pitch tracking.

`node scripts/voice-natural-pitch-smoke.cjs` exercises the bundled processor in
Electron with synthetic signals and an explicitly silent audio sink. It checks
live pitch changes, independent spectral-envelope changes without changing the
fundamental, and formant compensation during pitch shifting. At 48 kHz this
configuration reports 50 ms of algorithm latency. This is a signal-path test,
not an assessment of voice quality on any person's recording.
