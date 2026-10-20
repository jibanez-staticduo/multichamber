#!/usr/bin/env bash
# Multichamber Install Script
# Usage: curl -fsSL https://raw.githubusercontent.com/jibanez-staticduo/multichamber/main/scripts/install.sh | bash

set -euo pipefail

PACKAGE_ARCHIVE="https://github.com/jibanez-staticduo/multichamber/releases/latest/download/multichamber-web.tgz"
BIN_NAME="multichamber"
LEGACY_BIN_NAME="openchamber"
MIN_NODE_MAJOR=24
MIN_NODE_MINOR=14
MIN_NODE_VERSION="$MIN_NODE_MAJOR.$MIN_NODE_MINOR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() {
  echo -e "${BLUE}info${NC}  $1"
}

success() {
  echo -e "${GREEN}success${NC}  $1"
}

warn() {
  echo -e "${YELLOW}warn${NC}  $1"
}

error() {
  echo -e "${RED}error${NC}  $1"
}

# Check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Get Node.js version as "major.minor", or "0.0" when Node.js is missing
get_node_version() {
  if command_exists node; then
    local version
    version=$(node -v 2>/dev/null || true)
    version=${version#v}
    if [[ "$version" =~ ^([0-9]+)\.([0-9]+) ]]; then
      echo "${BASH_REMATCH[1]}.${BASH_REMATCH[2]}"
    else
      echo "0.0"
    fi
  else
    echo "0.0"
  fi
}

# Whether a "major.minor" version meets the minimum
node_version_supported() {
  local major=${1%%.*}
  local minor=${1#*.}
  [ "$major" -gt "$MIN_NODE_MAJOR" ] || { [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ]; }
}

# Detect preferred package manager
detect_package_manager() {
  # Check if running inside an npm/pnpm/yarn/bun context
  if [ -n "${npm_config_user_agent:-}" ]; then
    case "$npm_config_user_agent" in
      pnpm*) echo "pnpm"; return ;;
      yarn*) echo "yarn"; return ;;
      bun*) echo "bun"; return ;;
      npm*) echo "npm"; return ;;
    esac
  fi

  # Check for lockfiles in current directory (user preference)
  if [ -f "pnpm-lock.yaml" ]; then
    echo "pnpm"; return
  elif [ -f "yarn.lock" ]; then
    echo "yarn"; return
  elif [ -f "bun.lock" ] || [ -f "bun.lockb" ]; then
    echo "bun"; return
  elif [ -f "package-lock.json" ]; then
    echo "npm"; return
  fi

  # Check which package managers are available (prefer pnpm > bun > yarn > npm)
  if command_exists pnpm; then
    echo "pnpm"
  elif command_exists bun; then
    echo "bun"
  elif command_exists yarn; then
    echo "yarn"
  elif command_exists npm; then
    echo "npm"
  else
    echo "none"
  fi
}

# Flags that approve the dependency builds pnpm 10+ blocks; pnpm 11+ stops to
# ask about them in a terminal. `--allow-build` exists since pnpm 10.4.0; older
# versions reject it, and pnpm 9 and older run the builds without approval.
# Keep the list in sync with packages/web/server/lib/package-manager.js.
get_pnpm_allow_build_flags() {
  local version major minor
  version=$(pnpm --version 2>/dev/null || true)
  if [[ "$version" =~ ^([0-9]+)\.([0-9]+)\. ]]; then
    major=${BASH_REMATCH[1]}
    minor=${BASH_REMATCH[2]}
    if [ "$major" -gt 10 ] || { [ "$major" -eq 10 ] && [ "$minor" -ge 4 ]; }; then
      echo " --allow-build=msgpackr-extract --allow-build=node-pty"
    fi
  fi
}

# Get install command for package manager
get_install_command() {
  local pm=$1
  case "$pm" in
    pnpm) echo "pnpm add -g$(get_pnpm_allow_build_flags) $PACKAGE_ARCHIVE" ;;
    yarn) echo "yarn global add $PACKAGE_ARCHIVE" ;;
    bun) echo "bun add -g $PACKAGE_ARCHIVE" ;;
    npm) echo "npm install -g $PACKAGE_ARCHIVE" ;;
    *) echo "" ;;
  esac
}

# Resolve ownership from the actual executable, never from the shell's lockfile
# or an old installation's updater, which may still download upstream packages.
detect_installed_package_manager() {
  node --input-type=module - "$(command -v "$BIN_NAME")" <<'NODE'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const real = (value) => { try { return fs.realpathSync(value); } catch { return null; } };
const executable = real(process.argv[2]);
if (!executable) process.exit(1);
let directory = path.dirname(executable);
let installed;
while (directory !== path.dirname(directory)) {
  try {
    if (['@multichamber/web', '@openchamber/web'].includes(JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).name)) {
      installed = directory;
      break;
    }
  } catch {}
  directory = path.dirname(directory);
}
if (!installed) process.exit(1);
const commandOutput = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000 });
  return result.status === 0 ? result.stdout.trim() : '';
};
for (const manager of ['pnpm', 'bun', 'yarn', 'npm']) {
  const roots = manager === 'bun'
    ? [path.join(process.env.BUN_INSTALL || path.join(os.homedir(), '.bun'), 'install/global/node_modules')]
    : manager === 'yarn'
      ? [path.join(commandOutput('yarn', ['global', 'dir']), 'node_modules')]
      : [commandOutput(manager, ['root', '-g'])];
  if (roots.some((root) => root && ['@multichamber/web', '@openchamber/web'].some((name) => real(path.join(root, name)) === installed))) {
    console.log(manager);
    process.exit(0);
  }
}
process.exit(1);
NODE
}

# Install Node.js suggestion
suggest_node_install() {
  echo ""
  error "Node.js $MIN_NODE_VERSION+ is required but not found."
  echo ""
  echo "Install Node.js using one of these methods:"
  echo ""
  
  if [[ "${OSTYPE:-}" == "darwin"* ]]; then
    echo "  Using Homebrew:"
    echo "    brew install node"
    echo ""
  fi
  
  echo "  Using nvm (recommended):"
  echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  echo "    nvm install $MIN_NODE_MAJOR"
  echo ""
  echo "  Using fnm:"
  echo "    curl -fsSL https://fnm.vercel.app/install | bash"
  echo "    fnm install $MIN_NODE_MAJOR"
  echo ""
  echo "  Official installer:"
  echo "    https://nodejs.org/"
  echo ""
  exit 1
}

# Install package manager suggestion
suggest_pm_install() {
  echo ""
  error "No package manager found (npm, pnpm, yarn, or bun)."
  echo ""
  echo "Install a package manager:"
  echo ""
  echo "  npm (comes with Node.js):"
  echo "    Install Node.js from https://nodejs.org/"
  echo ""
  echo "  pnpm (recommended):"
  echo "    curl -fsSL https://get.pnpm.io/install.sh | sh -"
  echo ""
  echo "  bun:"
  echo "    curl -fsSL https://bun.sh/install | bash"
  echo ""
  echo "  yarn:"
  echo "    npm install -g yarn"
  echo ""
  exit 1
}

main() {
  echo ""
  echo "  ╭───────────────────────────────────╮"
  echo "  │                                   │"
  echo "  │   Multichamber Installer           │"
  echo "  │   Web interface for OpenCode      │"
  echo "  │                                   │"
  echo "  ╰───────────────────────────────────╯"
  echo ""

  # Check Node.js
  info "Checking Node.js..."
  NODE_VERSION=$(get_node_version)

  if ! node_version_supported "$NODE_VERSION"; then
    if [ "$NODE_VERSION" = "0.0" ]; then
      suggest_node_install
    else
      error "Node.js $MIN_NODE_VERSION+ required, found v$NODE_VERSION"
      suggest_node_install
    fi
  fi
  success "Node.js v$NODE_VERSION found"

  # Existing installations keep their owner, including the legacy CLI alias.
  if ! command_exists "$BIN_NAME" && command_exists "$LEGACY_BIN_NAME"; then
    BIN_NAME="$LEGACY_BIN_NAME"
  fi

  # Preserve the manager that owns an existing installation, including upstream.
  if command_exists "$BIN_NAME"; then
    if ! PM=$(detect_installed_package_manager); then
      error "Cannot identify the package manager owning the installed Multichamber. No changes made."
      exit 1
    fi
    info "Replacing the installed package with the fork using $PM..."
  else
    info "Detecting package manager..."
    PM=$(detect_package_manager)
  fi
  
  if [ "$PM" = "none" ]; then
    suggest_pm_install
  fi
  success "Using $PM"

  # Get install command
  INSTALL_CMD=$(get_install_command "$PM")
  
  if [ -z "$INSTALL_CMD" ]; then
    error "Could not determine install command"
    exit 1
  fi

  # Install
  echo ""
  info "Installing Multichamber..."
  echo "  Running: $INSTALL_CMD"
  echo ""
  
  if eval "$INSTALL_CMD"; then
    echo ""
    # Wordmark (toilet "pagga", "Open"/"Chamber" stacked).
    # Hardcoded so the user needs no extra tools.
    printf '%b' "$BLUE"
    cat <<'EOF'
  ░█▀█░█▀█░█▀▀░█▀█
  ░█░█░█▀▀░█▀▀░█░█
  ░▀▀▀░▀░░░▀▀▀░▀░▀
  ░█▀▀░█░█░█▀█░█▄█░█▀▄░█▀▀░█▀▄
  ░█░░░█▀█░█▀█░█░█░█▀▄░█▀▀░█▀▄
  ░▀▀▀░▀░▀░▀░▀░▀░▀░▀▀░░▀▀▀░▀░▀
EOF
    printf '%b\n' "$NC"
    success "Multichamber installed successfully!"
    echo ""

    # Verify the binary is actually reachable. Global installs frequently
    # land in a directory that isn't on PATH — surface that instead of
    # letting the user hit a confusing "command not found".
    if command_exists "$BIN_NAME"; then
      echo "  Get started:"
      echo "    multichamber              # Start server on port 3000"
      echo "    multichamber --help       # Show all options"
    else
      warn "'$BIN_NAME' was installed but isn't on your PATH yet."
      echo ""
      bin_dir=""
      case "$PM" in
        npm)  bin_dir=$(npm prefix -g 2>/dev/null)/bin ;;
        pnpm) bin_dir=$(pnpm bin -g 2>/dev/null || true) ;;
        yarn) bin_dir=$(yarn global bin 2>/dev/null || true) ;;
        bun)  bin_dir="${BUN_INSTALL:-$HOME/.bun}/bin" ;;
      esac
      if [ -n "$bin_dir" ]; then
        echo "  Add it to your PATH (then restart your terminal):"
        echo "    export PATH=\"$bin_dir:\$PATH\""
      else
        echo "  Add your package manager's global bin directory to PATH,"
        echo "  then restart your terminal and run: multichamber"
      fi
    fi
    echo ""
    echo "  Prerequisites:"
    echo "    Make sure OpenCode is running: opencode serve"
    echo ""
  else
    echo ""
    error "Installation failed"
    echo ""
    echo "  Try running manually:"
    echo "    $INSTALL_CMD"
    echo ""
    echo "  If you get permission errors, see:"
    echo "    https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"
    echo ""
    exit 1
  fi
}

main "$@"
