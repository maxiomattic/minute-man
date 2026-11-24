# Mobile apps (Capacitor)

The Android and iOS apps wrap the same web app in `public/`. There's no web build step: `npx cap sync` copies `public/` into each native project.

## What's shared and what's native

- **Shared:** all UI and logic (`public/`). On native, `public/core.js` sees `window.Capacitor.isNativePlatform()`, calls the deployed API at `https://cvas.careride.workers.dev` with a Bearer token, skips the service worker, and uses the Haptics plugin.
- **Native:** `android/` and `ios/` projects, app id `org.cvas.app`, name `CVAS`, icons and splash images (regenerate them from `public/icon.svg` with `scripts/icons.sh`), and plugin settings in `capacitor.config.json` (splash, status bar, system bars and safe areas).
- Plugins: haptics, local-notifications, status-bar, splash-screen.

## Android (on the Surface or any NixOS/Linux machine)

```sh
scripts/android.sh [device-serial]
```

The script enters `shell.nix` (JDK 21 and Android SDK 36 from nixpkgs, with nothing installed permanently). Then it runs `npx cap sync android`, builds with `./gradlew assembleDebug`, installs with `adb install -r`, and launches the app. Set `BUILD_ONLY=1` to only build the APK, which ends up at `android/app/build/outputs/apk/debug/app-debug.apk`.

To install on the Pixel over Tailscale, first turn on Wireless debugging on the phone. Then run `adb connect <tailscale-ip>:<port>`, using the port shown on that screen. If the machine isn't paired yet, run `adb pair <ip>:<pair-port> <code>` first.

NixOS note: AGP downloads an `aapt2` binary from Maven, and that binary won't run on NixOS. The script passes `-Pandroid.aapt2FromMavenOverride` so the build uses the SDK's patched `aapt2` instead.

## iOS (needs a Mac with Xcode)

```sh
npm ci
npx cap sync ios
npx cap open ios
```

The project uses Swift Package Manager, so there's no `pod install`. In Xcode, choose the **App** target, then **Signing & Capabilities**, then pick your Team. The bundle id is `org.cvas.app`, and you'll need to change it if that id is taken on your account. Then run the app on a device or simulator, or use Product > Archive for TestFlight.
