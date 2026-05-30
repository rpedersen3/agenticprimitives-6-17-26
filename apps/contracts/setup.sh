#!/usr/bin/env bash
# Setup script for apps/contracts foundry deps.
# Idempotent: safe to re-run.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d lib ]; then
  mkdir -p lib
fi

echo "Installing OpenZeppelin contracts v5..."
if [ ! -d lib/openzeppelin-contracts ]; then
  git clone --depth 1 --branch v5.0.2 https://github.com/OpenZeppelin/openzeppelin-contracts.git lib/openzeppelin-contracts
fi

echo "Installing forge-std..."
if [ ! -d lib/forge-std ]; then
  git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
fi

echo "Installing ERC-4337 account-abstraction v0.9 (main branch)..."
if [ ! -d lib/account-abstraction ]; then
  # Smart-agent's vendored contracts target v0.9 of BaseAccount. Track main
  # for now; pin to a tag once eth-infinitism cuts a 0.9.x release.
  git clone --depth 1 https://github.com/eth-infinitism/account-abstraction.git lib/account-abstraction
fi

echo "Done. Run 'forge build' to compile."
