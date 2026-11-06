#!/usr/bin/env python3
"""Collect PUBLIC network data from a local 6529 validator node into static JSON.

Runs next to the node and reads only its loopback API.
Writes only network-wide facts: cycle headers, roots, certificates and
verification outcomes. It never writes this node's keys, peers, servers,
location, account or anything else that identifies the machine.

Python 3.9+, standard library only.

    python3 collect.py --out /path/to/site/data [--api http://127.0.0.1:6529/api/v1]
"""
import argparse
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

DEFAULT_API = "http://127.0.0.1:6529/api/v1"

CERT_FIELDS = (
    "cycle_day", "cycle_root", "level", "signed_weight", "w", "raw_signed_tdh",
    "raw_registered_tdh", "network_tdh", "signing_accounts", "roster_count",
    "roster_root", "weight_basis", "flags", "excluded_accounts", "key_count",
    "signed_keys", "roster_accounts", "signer_weights", "unsigned_weights",
    "strong_unix",
)
HEADER_FIELDS = (
    "cycle_day", "boundary", "tdh_rule_id", "cutoff_number", "cutoff_hash",
    "cutoff_timestamp", "wallet_root", "wallet_count", "identity_count",
    "total_tdh", "token_root", "token_count",
)


def get(api, path, timeout=20):
    req = urllib.request.Request(api.rstrip("/") + "/" + path.lstrip("/"),
                                 headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def pick(d, fields):
    if not isinstance(d, dict):
        return None
    return {k: d.get(k) for k in fields if k in d}


def clean_cert(c):
    return pick(c, CERT_FIELDS)


def clean_cycle(rec):
    """Whitelist the public parts of one cycle record."""
    out = {
        "day": rec.get("day"),
        "state": rec.get("state"),
        "window": pick(rec.get("window"), ("opens", "closes", "final_at", "frozen_at")),
        "finalized_unix": rec.get("finalized_unix"),
        "header": pick(rec.get("header"), HEADER_FIELDS),
        "cycle_root": rec.get("cycle_root"),
        "history_root": rec.get("history_root"),
        "history_count": rec.get("history_count"),
        "certificate": clean_cert(rec.get("certificate")),
        "other_roots": len(rec.get("other_roots") or []),
    }
    dr = rec.get("dual_run")
    if isinstance(dr, dict):
        out["dual_run"] = {
            "implementations": dr.get("implementations"),
            "outcome": dr.get("outcome"),
            "differences": len(dr.get("differences") or []),
        }
    cmp_ = rec.get("compare")
    if isinstance(cmp_, dict):
        out["compare"] = pick(cmp_, ("status", "identities_compared", "identities_differing",
                                     "wallets_compared", "wallets_differing", "totals"))
    return out


def summary(c):
    cert = c.get("certificate") or {}
    hdr = c.get("header") or {}
    net = cert.get("network_tdh") or hdr.get("total_tdh")
    signed = cert.get("raw_signed_tdh")
    return {
        "day": c["day"],
        "state": c.get("state"),
        "level": cert.get("level"),
        "cycle_root": c.get("cycle_root") or cert.get("cycle_root"),
        "signing_accounts": cert.get("signing_accounts"),
        "roster_accounts": cert.get("roster_accounts"),
        "signed_keys": cert.get("signed_keys"),
        "key_count": cert.get("key_count"),
        "signed_tdh": signed,
        "registered_tdh": cert.get("raw_registered_tdh"),
        "network_tdh": net,
        "signed_share": (signed / net) if (signed and net) else None,
        "identities": hdr.get("identity_count"),
        "wallets": hdr.get("wallet_count"),
        "tokens": hdr.get("token_count"),
        "cutoff_number": hdr.get("cutoff_number"),
        "boundary": hdr.get("boundary"),
    }


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, path)
    os.chmod(path, 0o644)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="site data directory")
    ap.add_argument("--api", default=DEFAULT_API)
    a = ap.parse_args()
    out = os.path.abspath(a.out)

    try:
        status = get(a.api, "status")
        network = get(a.api, "network")
    except (urllib.error.URLError, OSError, ValueError) as e:
        print("node API not reachable: %s" % e, file=sys.stderr)
        return 1

    today = status.get("today")
    first = network.get("first_day") or today
    cycles_dir = os.path.join(out, "cycles")
    os.makedirs(cycles_dir, exist_ok=True)

    days = set()
    for name in os.listdir(cycles_dir):
        if name.endswith(".json") and name[:-5].isdigit():
            days.add(int(name[:-5]))

    for day in range(int(first), int(today) + 1):
        try:
            rec = get(a.api, "cycles/%d" % day).get("record")
        except (urllib.error.URLError, OSError, ValueError):
            continue
        if not rec:
            continue
        c = clean_cycle(rec)
        if not c.get("header") and not c.get("certificate"):
            continue  # nothing public to show yet
        write_json(os.path.join(cycles_dir, "%d.json" % day), c)
        days.add(day)

    index = []
    for day in sorted(days, reverse=True):
        try:
            with open(os.path.join(cycles_dir, "%d.json" % day)) as f:
                index.append(summary(json.load(f)))
        except (OSError, ValueError):
            pass
    write_json(os.path.join(cycles_dir, "index.json"), index)

    netinfo = status.get("network") or {}
    write_json(os.path.join(out, "network.json"), {
        "generated_unix": int(time.time()),
        "release": status.get("release"),
        "rule_version": status.get("rule_version"),
        "chain_id": netinfo.get("chain_id"),
        "network_id": netinfo.get("network_id"),
        "today": today,
        "first_day": network.get("first_day"),
        "latest_certified_day": network.get("latest_certified_day"),
        "latest_final_day": network.get("latest_final_day"),
        "next_keys": network.get("next_keys"),
    })
    print("ok: %d cycles, latest certified %s" % (len(index), network.get("latest_certified_day")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
