# Sports Timer

A mobile-first workout timer for Rounds, Tabata, and stopwatch laps. Install it from your browser and use it offline after it has finished preparing on the first visit.

## Run locally

From the project folder, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [localhost port 8000](http://127.0.0.1:8000/). The app has no build step, runtime dependencies, or backend. Use localhost for local service worker testing and HTTPS when serving to a phone.

## Publish on GitHub Pages

Put the project in a GitHub repository. In **Settings → Pages**, choose **Deploy from a branch**, select your publishing branch and **/ (root)**, then save. The published URL appears in Pages after deployment. Relative asset URLs and a relative service worker scope support repository URLs such as `https://username.github.io/sports-timer/`. The included `.nojekyll` file serves the project as static assets. [GitHub Pages publishing documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

When shipping changes to cached files, bump the version in `sw.js` and update its asset list if needed. A pending update takes over after the old app windows close. Open the app once online and wait for **More → Available offline** before going offline.

## Install

- **iOS and iPadOS** · In Safari, Chrome, or Firefox, open the browser’s Share menu and choose **Add to Home Screen**. Leave **Open as Web App** enabled if offered. [Apple](https://support.apple.com/guide/iphone/iphea86e5236/ios) · [Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DiOS) · [Firefox](https://support.mozilla.org/kb/add-website-shortcut-your-home-screen-ios)
- **Android** · In Chrome, use **Install and create shortcut → Install** or **Add to Home screen**. In Firefox, use **Menu → Install**. [Chrome](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid) · [Firefox](https://support.mozilla.org/kb/use-web-apps-firefox-android)
- **Desktop** · Use the timer in your browser. On a browser that supports installation, look in its address bar or app menu. Safari on macOS supports **File → Add to Dock**. [Apple](https://support.apple.com/en-us/104996)

## Progress

### Implemented

- Rounds and Tabata with editable preparation, work, rest, round count, and cooldown. Rest runs between work rounds and cooldown follows the last round. The default Tabata takes four minutes.
- Start, pause, resume, skip, reset, and automatic phase changes. The countdown recalculates from elapsed time after a browser interruption. Session state survives a reload in the same tab or app window.
- Stopwatch with elapsed time, individual lap splits, and cumulative lap times.
- Create, edit, copy, delete, and load named timers in **More**. Presets and settings are stored on the device.
- Three beep styles, optional bundled English spoken cues, a cue volume slider and preview, and an optional in-app screen flash. The flash respects reduced-motion settings.
- Screen Wake Lock during running timers, requested again when you return. If the browser denies it, the app displays a message. A manually locked or suspended device can miss cues even though the timer catches up on return. [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API) · [Chrome Page Lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- Standalone install manifest and offline caching for the app, font, icons, and voice cues. On devices where the installed app uses a separate storage container, add your presets in the app window you plan to use.

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

Barlow Condensed is bundled under the [SIL Open Font License](./assets/OFL-Barlow.txt). The short English cues were generated using [meSpeak](https://www.masswerk.at/mespeak/) and are bundled as audio files.
