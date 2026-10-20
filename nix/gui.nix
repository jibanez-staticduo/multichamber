# Multichamber Desktop: the Electron GUI, packaged the way the Linux AppImage
# is assembled (see packages/electron/README.md "Packaging" and the Linux job
# in .github/workflows/release.yml), but using nixpkgs' Electron instead of
# electron-builder's runtime download.
#
# Recipe parity with the AppImage build:
#   1. build:web-assets    -> done by multichamberCore (packages/web build)
#   2. prepare:opencode-cli -> opencodeCli: the OpenCode CLI built from
#                             upstream's flake at the pinned tag
#   3. bundle:main         -> bun ./scripts/bundle-main.mjs
#   4. rebuild:native      -> node-pty rebuilt against the Electron headers
#   5. electron-builder    -> replaced by a plain Electron tree at
#                             $out/share/multichamber (resources/app instead
#                             of app.asar); the renamed executable is what
#                             makes Electron treat it as a packaged app.
#
# Wayland / hardware acceleration: electron's ozone platform hint defaults
# to "auto", which picks native Wayland (GPU-accelerated) on Wayland
# sessions and falls back to X11 elsewhere. `ozonePlatformHint` overrides
# the default for the baked-in launcher, `extraCommandLineFlags` appends
# chromium/electron flags (e.g. [ "--ozone-platform=wayland" ] to force
# Wayland, or [ "--disable-gpu" ] for software rendering). Both are also
# reachable at runtime without rebuilding: the env var
# ELECTRON_OZONE_PLATFORM_HINT and trailing command-line arguments are
# passed straight through.
{
  lib,
  stdenv,
  makeWrapper,
  makeDesktopItem,
  bun,
  nodejs,
  python3,
  electron,
  git,
  openssh,
  cloudflared,
  less,
  bash,
  coreutils,
  gnutar,
  bzip2,
  self,
  version,
  src,
  multichamberCore,
  opencodeCli,
  ozonePlatformHint ? "auto",
  extraCommandLineFlags ? [ ],
}:

let
  # The desktop prefers its bundled OpenCode CLI over PATH, so nixpkgs
  # opencode is deliberately not injected here (it is a different major).
  runtimePath = lib.makeBinPath [
    git
    openssh
    nodejs
    python3
    cloudflared
    less
    bash
    coreutils
    # tar + bzip2: the Docker recipe installs them for local dictation
    # model extraction (a .tar.bz2 unpacked via tar, #2887).
    gnutar
    bzip2
  ];

  # Must match the tag the opencode flake input is pinned to in flake.nix;
  # asserted against the staged binary below.
  opencodeCliVersion =
    (builtins.fromJSON (builtins.readFile "${self}/packages/electron/package.json"))
    .opencodeCli.version;

  desktopItem = makeDesktopItem {
    name = "multichamber";
    desktopName = "Multichamber";
    comment = "Desktop runtime for Multichamber";
    exec = "multichamber-desktop %U";
    icon = "multichamber";
    categories = [ "Development" ];
    startupWMClass = "multichamber";
    mimeTypes = [ "x-scheme-handler/multichamber" ];
    terminal = false;
  };
in
stdenv.mkDerivation {
  pname = "multichamber-desktop";
  inherit version src;

  nativeBuildInputs = [
    bun
    nodejs
    python3
    makeWrapper
  ];

  configurePhase = ":";

  buildPhase = ''
    # Runtime tree: the same layout the server CLI ships...
    cp -a "${multichamberCore}/lib/multichamber" ./app
    chmod -R u+w ./app

    # Add the electron sources so bundle:main resolves its inlined deps
    # (electron-context-menu, electron-log, electron-updater) from the
    # hoisted node_modules, as in the workspace. Bun keeps those deps in the
    # per-package node_modules (relative symlinks into the root .bun store),
    # so overlay them from the pinned deps tree.
    cp -a packages/electron ./app/packages/electron
    cp -a "${multichamberCore.passthru.bunDeps}/packages/electron/node_modules" \
      ./app/packages/electron/node_modules

    # bundle:main — small electron-* deps get inlined; @multichamber/web and
    # the native modules stay external and resolve from node_modules at
    # runtime, exactly as in the packaged AppImage.
    (
      cd ./app/packages/electron
      bun ./scripts/bundle-main.mjs
    )

    # ...plus rebuild:native. Under Electron the server runs on Node, so
    # node-pty must exist as a compiled addon. bun-pty stays untouched: its
    # import is guarded by isBunRuntime and never reached under Electron.
    nodePtyDir=$(readlink -f ./app/node_modules/node-pty)
    (
      cd "$nodePtyDir"
      node "${nodejs}/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js" rebuild \
        --nodedir="${electron.headers}" --release
    )
  '';

  installPhase = ''
    tree="$out/share/multichamber"
    mkdir -p "$tree/resources"

    # Copy the nixpkgs Electron dist and rename the executable; the renamed
    # binary is what makes Electron treat this as a packaged app
    # (app.isPackaged, process.resourcesPath), matching the AppImage.
    cp -a "${electron.dist}"/. "$tree/"
    chmod -R u+w "$tree"
    mv "$tree/electron" "$tree/multichamber"

    # resources/app = the unpacked equivalent of app.asar: the electron
    # package.json (main: dist-bundle/entry.mjs), the bundled main process,
    # preload, and the production node_modules.
    app="$tree/resources/app"
    mkdir -p "$app"
    cp "${self}/packages/electron/package.json" "$app/package.json"
    cp -a ./app/packages/electron/dist-bundle "$app/dist-bundle"
    cp "${self}/packages/electron/preload.mjs" "$app/preload.mjs"
    cp -a ./app/node_modules "$app/node_modules"

    # Keep the workspace geometry (root package.json + node_modules +
    # packages/* side by side) so bun's relative links — e.g.
    # packages/web/node_modules/reflect-metadata -> ../../../node_modules/.bun
    # — keep resolving, and expose the workspace packages the way bun does.
    mkdir -p "$app/packages" "$app/node_modules/@multichamber"
    cp -a ./app/packages/web "$app/packages/web"
    cp -a ./app/packages/sdk "$app/packages/sdk"
    ln -s ../../packages/web "$app/node_modules/@multichamber/web"
    ln -s ../../packages/sdk "$app/node_modules/@multichamber/sdk"

    # extraResources (same set as the electron-builder config).
    cp -a ./app/packages/web/dist "$tree/resources/web-dist"
    mkdir -p "$tree/resources/icons"
    cp -a "${self}/packages/electron/resources/icons/icon.png" \
      "${self}/packages/electron/resources/icons/app-icon.png" \
      "${self}/packages/electron/resources/icons/tray" "$tree/resources/icons/"
    mkdir -p "$tree/resources/opencode-cli"
    cp "${opencodeCli}/bin/opencode" "$tree/resources/opencode-cli/opencode"
    chmod 0755 "$tree/resources/opencode-cli/opencode"

    # Pin invariant: the bundled CLI must be the version
    # packages/electron/package.json asks for (upstream's flake appends the
    # git rev, hence the substring match). The CLI needs a writable HOME
    # even for --version.
    stagedVersion="$(
      HOME="$(mktemp -d)" OPENCODE_DISABLE_MODELS_FETCH=1 "$tree/resources/opencode-cli/opencode" --version 2>/dev/null
    )"
    case "$stagedVersion" in
      *"v${opencodeCliVersion}"*) ;;
      *)
        echo "opencode CLI version mismatch: staged '$stagedVersion', want ${opencodeCliVersion}"
        exit 1
        ;;
    esac

    mkdir -p "$out/bin"
    makeWrapper "$tree/multichamber" "$out/bin/multichamber-desktop" \
      --prefix PATH : "${runtimePath}" \
      --set CHROME_DEVEL_SANDBOX "$tree/chrome-sandbox" \
      --set NODE_ENV production \
      --set-default ELECTRON_OZONE_PLATFORM_HINT "${ozonePlatformHint}" \
      ${lib.strings.concatStringsSep " " (
        map (flag: "--add-flags ${lib.strings.escapeShellArg flag}") extraCommandLineFlags
      )}

    # Desktop identity, same as the AppImage: executable multichamber, desktop
    # entry multichamber.desktop, StartupWMClass=multichamber.
    install -Dm644 "${desktopItem}/share/applications/multichamber.desktop" \
      "$out/share/applications/multichamber.desktop"
    install -Dm644 "${self}/packages/electron/resources/icons/app-icon.png" \
      "$out/share/icons/hicolor/512x512/apps/multichamber.png"
    install -Dm644 "${self}/packages/electron/resources/icons/app-icon.png" \
      "$out/share/pixmaps/multichamber.png"
  '';

  # Prebuilt Electron tree plus plain JS: keep everything pristine.
  dontFixup = true;

  passthru = {
    inherit opencodeCli multichamberCore;
  };

  meta = {
    description = "Multichamber desktop GUI (Electron) for OpenCode";
    homepage = "https://github.com/jibanez-staticduo/multichamber";
    license = lib.licenses.mit;
    mainProgram = "multichamber-desktop";
    # x86_64-linux only: the aarch64 dependency hash is unverified.
    platforms = [ "x86_64-linux" ];
  };
}
