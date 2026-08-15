#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
runtime_root="$repo_root/runtime"
node_root="$runtime_root/node"
uv_root="$runtime_root/uv"
node_version="22.22.1"
uv_version="0.11.3"

if [[ ! -x "$node_root/bin/node" || "$($node_root/bin/node --version 2>/dev/null || true)" != "v$node_version" ]]; then
  temporary="$(mktemp -d)"
  trap 'rm -rf "$temporary"' EXIT
  archive="node-v$node_version-darwin-arm64.tar.gz"
  base_url="https://nodejs.org/dist/v$node_version"
  curl --fail --location --retry 3 --silent --show-error "$base_url/$archive" --output "$temporary/$archive"
  curl --fail --location --retry 3 --silent --show-error "$base_url/SHASUMS256.txt" --output "$temporary/SHASUMS256.txt"
  expected="$(awk -v archive="$archive" '$2 == archive { print $1 }' "$temporary/SHASUMS256.txt")"
  actual="$(shasum -a 256 "$temporary/$archive" | awk '{ print $1 }')"
  [[ -n "$expected" && "$actual" == "$expected" ]] || { echo "Node runtime checksum verification failed." >&2; exit 1; }
  tar -xzf "$temporary/$archive" -C "$temporary"
  if [[ -e "$node_root" ]]; then mv "$node_root" "$temporary/old-node"; fi
  mv "$temporary/node-v$node_version-darwin-arm64" "$node_root"
fi

if [[ ! -x "$uv_root/uv" || "$($uv_root/uv --version 2>/dev/null | awk '{print $2}' || true)" != "$uv_version" ]]; then
  temporary_uv="$(mktemp -d)"
  trap 'rm -rf "$temporary_uv"' EXIT
  archive="uv-aarch64-apple-darwin.tar.gz"
  url="https://github.com/astral-sh/uv/releases/download/$uv_version/$archive"
  curl --fail --location --retry 3 --silent --show-error "$url" --output "$temporary_uv/$archive"
  tar -xzf "$temporary_uv/$archive" -C "$temporary_uv"
  mkdir -p "$uv_root"
  install -m 0755 "$temporary_uv/uv-aarch64-apple-darwin/uv" "$uv_root/uv"
  if [[ -f "$temporary_uv/uv-aarch64-apple-darwin/uvx" ]]; then
    install -m 0755 "$temporary_uv/uv-aarch64-apple-darwin/uvx" "$uv_root/uvx"
  fi
fi

echo "Prepared Node v$node_version and uv $uv_version for Apple Silicon."
