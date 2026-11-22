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

Run `just test-browser` for the browser suite on its own, or `npm run test:browser -- --project=webkit` to target one engine. Browser tests start their own loopback servers and cover full workout flows, preset storage, offline reloads after the server stops, keyboard access, automated accessibility, and countdown layout. GitHub Actions runs the suites on pushes to `main` and pull requests, and saves browser traces when tests fail. [Playwright browser setup](https://playwright.dev/docs/browsers)

## Publish on GitHub Pages

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Private repositories require a GitHub plan that supports Pages, and the published site can be public even when the source repository is private. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

The **Test and deploy** workflow runs the unit and browser suites before publishing the static app on pushes to `main`. Pull requests run the tests. To redeploy manually, run the workflow from `main` in the **Actions** tab. The site URL appears in the `github-pages` deployment and in Pages settings. Relative assets and service worker scope support repository URLs such as `https://username.github.io/cadence/`.

Set the release version in [version.js](./version.js) before publishing changes to the app. Start from `1.0.0` and use semantic versioning. The header displays the version of the files currently loaded, and the service worker uses it for the offline cache. Update the asset list in `sw.js` when adding or removing files.

When a new version finishes downloading, Cadence prompts you to update when you pause or finish a running timer. Choosing **Update** reloads the app with the new files. The browser can also activate a waiting update after all Cadence windows close. For the first release with update prompts, close any windows still running the older app before reopening Cadence.

## Install

On the first visit over HTTPS, Cadence offers installation. The install action opens the browser’s prompt when supported or shows the steps in **More**. Open the app once online and wait for **More → Available offline** before going offline.

- **iOS and iPadOS** · In Safari, Chrome, or Firefox, open the browser’s Share menu and choose **Add to Home Screen**. Leave **Open as Web App** enabled if offered. [Apple](https://support.apple.com/guide/iphone/iphea86e5236/ios) · [Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DiOS) · [Firefox](https://support.mozilla.org/kb/add-website-shortcut-your-home-screen-ios)
- **Android** · In Chrome, use **Install and create shortcut → Install** or **Add to Home screen**. In Firefox, use **Menu → Install**. [Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid) · [Firefox](https://support.mozilla.org/kb/use-web-apps-firefox-android)
- **Desktop** · Use the timer in your browser. On a browser that supports installation, look in its address bar or app menu. Safari on macOS supports **File → Add to Dock**. [Apple](https://support.apple.com/en-us/104996)

## Progress

### Implemented

- Rounds and Tabata with editable preparation, work, rest, round count, and cooldown. Rest runs between work rounds and cooldown follows the last round. The default Tabata takes four minutes.
- Edge-to-edge interval countdown on phones in portrait, with tall, condensed digits and a larger next-phase preview.
- Start, pause, resume, skip, reset, and automatic phase changes. The countdown recalculates from elapsed time after a browser interruption. Session state survives a reload in the same tab or app window.
- Stopwatch with elapsed time, individual lap splits, and cumulative lap times.
- Create, edit, copy, delete, and load named timers in **More**. Presets and settings are stored on the device.
- Three beep styles, optional bundled English spoken cues, a cue volume slider and preview, and an optional in-app screen flash. The flash respects reduced-motion settings.
- Screen Wake Lock during running timers, requested again when you return. If the browser denies it, the app displays a message. A manually locked or suspended device can miss cues even though the timer catches up on return. [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) · [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- Standalone install manifest and offline caching for the app, font, icons, and voice cues. On devices where the installed app uses a separate storage container, add your presets in the app window you plan to use.
- First-visit install prompt, optional updates after a new version downloads, and the served version beside the Cadence name.

### Verified

- Chromium, Firefox, and WebKit completed an interval workout, recorded stopwatch laps, and edited, loaded, and deleted a saved timer. All three reloaded at a repository subpath after the local server stopped.
- Chromium passed the manifest checks and automated accessibility scans for the workout, editor, and settings. The countdown fits at desktop, mobile, compact mobile, and landscape viewport sizes.
- A simulated interruption verified that the countdown catches up and requests a new wake lock on return. The browser test also verified that a bundled voice clip decoded and started playing.

### Planned or to investigate

- Exercise names or spoken labels, and device-local voice selection for additional languages.
- Final-seconds ticking and vibration where supported.
- Camera torch as a foreground cue where hardware and permissions allow.
- Orientation lock where supported. The current layout works in portrait and landscape.
- Evaluate the Audio Session API for OS-managed music ducking on browsers that support it. [Audio Session API](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type)
- Physical-device verification for install flows, low-power wake lock behavior, and cue playback on iOS and Android.

Barlow Condensed and the Bebas Neue countdown digits are bundled under the SIL Open Font License. [Barlow Condensed license](./assets/OFL-Barlow.txt) · [Bebas Neue license](./assets/OFL-Bebas-Neue.txt)

The short English cues were generated using meSpeak and are bundled as audio files. [meSpeak](https://www.masswerk.at/mespeak/)
