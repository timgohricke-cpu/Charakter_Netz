#!/usr/bin/env bash
# Alle automatischen Tests von Charakter-Netz ausführen.
#   bash tests/run_all.sh          -> statisch + Datenbank + Oberfläche
# Voraussetzungen: python3, PostgreSQL >= 15 (initdb/psql), node (optional, für Syntax),
#                  pip install playwright (+ Chrome/Chromium; sonst: python3 -m playwright install chromium)
set -u
cd "$(dirname "$0")/.."
python3 -c "import playwright" 2>/dev/null || pip install --quiet playwright 2>/dev/null || pip install --quiet --break-system-packages playwright
fail=0
echo "===== Statische Prüfungen =====";  python3 tests/test_static.py  || fail=1
echo; echo "===== Datenbank =====";        python3 tests/db/test_db.py    || fail=1
echo; echo "===== Oberfläche =====";       python3 tests/ui/test_ui.py    || fail=1
echo
if [ $fail -eq 0 ]; then echo "ALLE TESTS BESTANDEN"; else echo "ES GIBT FEHLER (siehe FAIL-Zeilen oben)"; fi
exit $fail
