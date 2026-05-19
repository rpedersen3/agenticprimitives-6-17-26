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

echo "Installing ERC-4337 account-abstraction v0.8..."
if [ ! -d lib/account-abstraction ]; then
  git clone --depth 1 --branch v0.8.0 https://github.com/eth-infinitism/account-abstraction.git lib/account-abstraction
fi

echo "Done. Run 'forge build' to compile."
