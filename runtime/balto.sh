#!/bin/zsh
set -eu

if [[ $# -ne 3 ]]; then
  print -u2 "usage: balto.sh <action> <data-dir> <resources-dir>"
  exit 64
fi

action="$1"
data_dir="$2"
resources_dir="$3"
node_bin="$resources_dir/node/bin/node"

if [[ ! -x "$node_bin" ]]; then
  print -u2 "Balto's private Node runtime is missing. Reinstall Balto Speedrunner."
  exit 70
fi

exec "$node_bin" "$resources_dir/balto.mjs" "$action" "$data_dir" "$resources_dir"
