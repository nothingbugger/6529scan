# 6529 Scan

6529 Scan is an independent, **unofficial** explorer for the 6529 validator network: daily TDH cycles,
certificates, independent checks and TDH holders. Not affiliated with or endorsed by 6529.

```
docs/                  the static site served by GitHub Pages (no build step, no dependencies)
docs/data/             JSON snapshots written by the collector
collector/collect.py   reads a validator node's loopback API and writes public JSON
collector/publish.sh   runs the collector and pushes new data to this repository
```

## Where the data comes from

- **Cycles and certificates** — snapshots from one 6529 validator node, read from its local API
  (loopback only; the port is detected automatically). The collector writes a whitelist of network-wide fields only:
  cycle header, roots, certificate, dual-run and 6529.io comparison outcomes. It never publishes
  the node's keys, peers, servers, location or account.
- **Holders** — the public read-only API at `api.6529.io`, queried live by the visitor's browser.
- **Releases** — 6529's release list at `6529.io/validator/releases.json`.

The site never connects to the node: the node pushes static files out, nothing comes in.
Check anything important yourself with `validator verify cert`.

## Run it yourself

Collector (Python 3.9+, standard library only), next to a running validator:

```
python3 collector/collect.py --out docs/data
```

Preview:

```
cd docs && python3 -m http.server 8765 --bind 127.0.0.1
```

Licence: MIT.
