#!/usr/bin/env bash
# Baked once into the sandbox snapshot by `mda dev` / `mda deploy`; every new
# conversation's sandbox clones it, so these are installed before the agent's
# first command. Without them the lead spends approvals on `pip install`.
# Restart `mda dev` after changing this file.
set -euo pipefail

python3 -m pip install --quiet --break-system-packages \
  pandas numpy openpyxl
python3 -c "import pandas, numpy, openpyxl; print('sandbox ready: pandas', pandas.__version__)"
