# Android build toolchain for the Capacitor app (nothing installed permanently).
#   NIXPKGS_ALLOW_UNFREE=1 NIXPKGS_ACCEPT_ANDROID_SDK_LICENSE=1 nix-shell
# scripts/android.sh enters this shell for you.
{ pkgs ? import <nixpkgs> {
    config = { allowUnfree = true; android_sdk.accept_license = true; };
  }
}:
let
  buildToolsVersion = "35.0.0"; # AGP 8.13 default
  android = pkgs.androidenv.composeAndroidPackages {
    platformVersions = [ "36" ]; # = compileSdkVersion in android/variables.gradle
    buildToolsVersions = [ buildToolsVersion ];
    includeEmulator = false;
    includeSystemImages = false;
    includeNDK = false;
  };
  sdk = "${android.androidsdk}/libexec/android-sdk";
in
pkgs.mkShell {
  packages = [ pkgs.jdk21 android.androidsdk pkgs.nodejs ];
  JAVA_HOME = pkgs.jdk21.home;
  ANDROID_HOME = sdk;
  ANDROID_SDK_ROOT = sdk;
  # AGP downloads a dynamically linked aapt2 from Maven that can't run on NixOS;
  # scripts/android.sh passes this patched one via -Pandroid.aapt2FromMavenOverride.
  CVAS_AAPT2 = "${sdk}/build-tools/${buildToolsVersion}/aapt2";
}
