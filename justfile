[private]
default:
    @just --list

# Serve the app on the local network.
dev port="8000" bind="0.0.0.0":
    #!/bin/sh
    set -eu
    web_root=$(mktemp -d)
    trap 'rm -rf -- "$web_root"' EXIT
    ln -s "$PWD"/index.html "$PWD"/styles.css "$PWD"/app.mjs "$PWD"/timer.mjs \
        "$PWD"/cues.mjs "$PWD"/pwa.mjs "$PWD"/version.js "$PWD"/sw.js \
        "$PWD"/manifest.webmanifest "$PWD"/assets "$web_root"
    uv run python -m http.server {{ quote(port) }} --bind {{ quote(bind) }} --directory "$web_root"

# Check JavaScript syntax and validate the web app manifest JSON.
check:
    node --check app.mjs
    node --check cues.mjs
    node --check pwa.mjs
    node --check version.js
    node --check timer.mjs
    node --check sw.js
    uv run python -m json.tool manifest.webmanifest > /dev/null

# Run the full test suite.
test:
    npm test

# Run fast unit and service worker contract tests.
test-unit:
    npm run test:unit

# Run the browser suite in Chromium, Firefox, and WebKit.
test-browser:
    npm run test:browser
