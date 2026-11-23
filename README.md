# Cadence

A mobile-first workout timer for Rounds, Tabata, and stopwatch laps. Install it from your browser and use it offline after it has finished preparing on the first visit.

## Run locally

With Just and uv installed, run this from the project folder. uv manages the Python interpreter for the local server.

```sh
just dev
```

Open the app on your computer at localhost on port 8000. On a phone connected to the same local network, open your computer’s local IP address on port 8000, for example `http://192.168.1.10:8000/`. Run `just dev 8080` to change the port or `just dev 8000 127.0.0.1` to serve only on your computer. [Open the local app](http://127.0.0.1:8000/)

The app has no build step, runtime dependencies, or backend. Local network HTTP works for testing the layout and timers on a phone. Use a trusted HTTPS URL on the phone to test offline caching and screen wake lock.

Run `just check` with Node.js and uv to check JavaScript syntax and validate the manifest JSON. Run `just` to list the available recipes.

## Run tests

Use Node.js 22 or newer. Run `just test-unit` for the timer, cues, wake-lock, and service worker unit tests. These use Node’s built-in test runner.

To set up the full suite, install the test dependencies and browsers from the project folder.

```sh
npm ci
npx playwright install
just test
```

Run `just test-browser` for the browser suite on its own, or `npm run test:browser -- --project=webkit` to target one engine. Browser tests start their own loopback servers and cover full workout flows, preset storage, offline reloads after the server stops, keyboard access, automated accessibility, and countdown layout. Service workers are enabled in `pwa.spec.mjs`, which covers installation, updates, and an offline workout. Failed tests save screenshots. GitHub Actions captures a trace on the first retry and flags flaky tests as failures. For a local trace, add `--trace=on` to the targeted browser command. [Playwright browser setup](https://playwright.dev/docs/browsers)

## Publish on GitHub Pages

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Private repositories require a GitHub plan that supports Pages, and the published site can be public even when the source repository is private. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

The **Test and deploy** workflow runs Chromium, Firefox, and WebKit in parallel and runs unit tests in the Chromium job. Publishing on pushes to `main` requires all three jobs to pass. Pull requests run the same tests and cancel superseded runs. To redeploy manually, run the workflow from `main` in the **Actions** tab. The site URL appears in the `github-pages` deployment and in Pages settings. Relative assets and service worker scope support repository URLs such as `https://username.github.io/cadence/`.

When hosting Cadence at `https://fourat.dev/cadence/`, redirect `/cadence` to `/cadence/` so the page's relative manifest and icon links resolve inside Cadence. The manifest uses the stable ID `/cadence/`, with its launch URL and scope pointing to the directory containing the manifest. Its PNG icons and the page's Apple touch icon are served from Cadence's own `assets/` directory. [Web App Manifest specification](https://www.w3.org/TR/appmanifest/#id-member) · [WebKit home screen icons](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/#new-fallback-icon)

If the main site has a root service worker, let requests for `/cadence` and `/cadence/…` reach the network so Cadence can load and register its own worker. If the main PWA has manifest scope `/`, Chrome can suppress Cadence's install prompt when the main PWA is installed. Non-overlapping scopes, such as `/app/` and `/cadence/`, or separate origins allow independent installation prompts. [Chrome guidance for multiple PWAs](https://web.dev/articles/building-multiple-pwas-on-the-same-domain)

Set the release version in [version.js](./version.js) before publishing changes to the app. Start from `1.0.0` and use semantic versioning. The header displays the version of the files currently loaded, and the service worker uses it for the offline cache. Update the asset list in `sw.js` when adding or removing files.

When a new version finishes downloading, Cadence prompts you to update when you pause or finish a running timer. Choosing **Update** reloads the app with the new files. The browser can also activate a waiting update after all Cadence windows close. For the first release with update prompts, close any windows still running the older app before reopening Cadence.

## Install

On the first visit over HTTPS, Cadence offers installation. The install action opens the browser’s prompt when supported or shows the steps in **More**. Open the app once online and wait for **More → Available offline** before going offline.

- **iOS and iPadOS** · In Safari, Chrome, or Firefox, open the browser’s Share menu and choose **Add to Home Screen**. Leave **Open as Web App** enabled if offered. [Apple](https://support.apple.com/guide/iphone/iphea86e5236/ios) · [Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DiOS) · [Firefox](https://support.mozilla.org/kb/add-website-shortcut-your-home-screen-ios)
- **Android** · In Chrome, use **Install and create shortcut → Install** or **Add to Home screen**. In Firefox, use **Menu → Install**. [Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid) · [Firefox](https://support.mozilla.org/kb/use-web-apps-firefox-android)
- **Desktop** · Use the timer in your browser. On a browser that supports installation, look in its address bar or app menu. Safari on macOS supports **File → Add to Dock**. [Apple](https://support.apple.com/en-us/104996)

## Progress

### Implemented

- Rounds and Tabata with editable preparation, work, rest, round count, and cooldown. Tabata adds a cycle count and a recovery interval between cycles. The default Tabata has three cycles of eight rounds and takes 18 minutes and 50 seconds.
- Edge-to-edge interval countdown on phones in portrait, with tall, condensed digits and a larger next-phase preview.
- Rounds, Tabata, and Stopwatch fit between the pinned Cadence header and mode bar. Settings, the timer editor, and lap history can scroll independently.
- The phase panel shows the main clock and time left in the workout. The bottom bar identifies the timer mode, and a small heading identifies the loaded preset.
- The mobile app shell follows the visible viewport as browser bars move, and the mode bar includes space for the home indicator.
- Start, pause, resume, skip, reset, and automatic phase changes. The countdown recalculates from elapsed time after a browser interruption. Session state survives a reload in the same tab or app window.
- Stopwatch with an adjustable preparation countdown and recurring lap bells. Both can be set to zero. Use **Lap** to record individual splits and cumulative times.
- Create, edit, copy, delete, and load named timers in **More**. Presets and settings are stored on the device.
- Short bips at 3, 2, and 1 seconds, followed by a cue at the phase change. Choose tubular bells, hand chimes, soft chimes, or **Sport / Military** in **Settings**. The Sport / Military style starts work with a sustained whistle and uses shorter whistles for the other phases. Adjust the volume or tap **Preview**. Bundled English spoken cues and a screen flash are optional. The flash respects reduced-motion settings.
- On iPhone and iPad, **Start**, **Resume**, and **Preview** enable media playback for the selected cues. Cadence renders them from its bundled audio, with the selected volume applied before playback.
- Screen Wake Lock during running timers, requested again when you return. If the browser denies it, the app displays a message. A manually locked or suspended device can miss cues even though the timer catches up on return. [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) · [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- Standalone install manifest and offline caching for the app, font, icons, and voice cues. On devices where the installed app uses a separate storage container, add your presets in the app window you plan to use.
- First-visit install prompt, optional updates after a new version downloads, and the served version beside the Cadence name.

### Verified

- Chromium, Firefox, and WebKit completed an interval workout, recorded stopwatch laps, and edited, loaded, and deleted a saved timer. All three reloaded at a repository subpath after the local server stopped.
- Chromium passed the manifest checks and automated accessibility scans for the workout, editor, and settings. The countdown fits at desktop, mobile, compact mobile, and landscape viewport sizes.
- A simulated interruption verified that the countdown catches up and requests a new wake lock on return. The browser test also verified that a bundled voice clip decoded and started playing.
- Chromium, Firefox, and WebKit verified the timing of all three bips before the bell, including a pause and resume during the countdown.
- Browser tests cover Tabata recovery and cycle progression, plus Stopwatch preparation, timed lap bells, and saved Stopwatch presets.

### Planned or to investigate

- Exercise names or spoken labels, and device-local voice selection for additional languages.
- Vibration cues where supported.
- Camera torch as a foreground cue where hardware and permissions allow.
- Orientation lock where supported. The current layout works in portrait and landscape.
- Evaluate the Audio Session API for OS-managed music ducking on browsers that support it. [Audio Session API](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type)
- Physical-device verification for install flows, low-power wake lock behavior, and cue playback on iOS and Android.

Barlow Condensed and the Bebas Neue countdown digits are bundled under the SIL Open Font License. [Barlow Condensed license](./assets/OFL-Barlow.txt) · [Bebas Neue license](./assets/OFL-Bebas-Neue.txt)

The bell melodies use real hand chime and tubular bell recordings from the Versilian Community Sample Library, released under CC0. The samples are trimmed and bundled for offline use. [Versilian Studios](https://versilian-studios.com/vcsl/) · [Hand chime recording](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Hand%20Chimes/sus_A4_r01_main.wav) · [Tubular bell recording](https://github.com/sgossner/VCSL/blob/c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e/Idiophones/Struck%20Idiophones/Tubular%20Bells%201/chimes_E4_pp_rr3.wav)

Sport / Military uses a CC0 whistle recording by Rosa-Orenes256. Cadence trims and extends the recording into two mono WAV clips for offline use. [Referee whistle](https://freesound.org/people/Rosa-Orenes256/sounds/538422/)

The short English cues were generated using meSpeak and are bundled as audio files. [meSpeak](https://www.masswerk.at/mespeak/)
