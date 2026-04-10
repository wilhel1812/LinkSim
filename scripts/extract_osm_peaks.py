#!/usr/bin/env python3
import argparse
import json
import osmium

class PeakExtractor(osmium.SimpleHandler):
    def __init__(self, writer):
        super().__init__()
        self.writer = writer
        self.counts = {"node": 0, "way": 0, "relation_skipped": 0}

    def _kind(self, tags):
        natural = tags.get("natural")
        if natural == "peak":
            return "peak"
        if natural == "volcano":
            return "volcano"
        return None

    def node(self, n):
        kind = self._kind(n.tags)
        name = n.tags.get("name")
        if not kind or not name:
            return
        if not n.location.valid():
            return
        item = {
            "id": f"node:{n.id}",
            "kind": kind,
            "name": str(name).strip(),
            "lat": n.location.lat,
            "lon": n.location.lon,
            "elevationM": self._parse_ele(n.tags.get("ele")),
        }
        self.writer.write(json.dumps(item, ensure_ascii=False) + "\n")
        self.counts["node"] += 1

    def way(self, w):
        kind = self._kind(w.tags)
        name = w.tags.get("name")
        if not kind or not name:
            return
        coords = [(node.lon, node.lat) for node in w.nodes if node.location.valid()]
        if len(coords) < 2:
            return
        lon = sum(c[0] for c in coords) / len(coords)
        lat = sum(c[1] for c in coords) / len(coords)
        item = {
            "id": f"way:{w.id}",
            "kind": kind,
            "name": str(name).strip(),
            "lat": lat,
            "lon": lon,
            "elevationM": self._parse_ele(w.tags.get("ele")),
        }
        self.writer.write(json.dumps(item, ensure_ascii=False) + "\n")
        self.counts["way"] += 1

    def relation(self, r):
        kind = self._kind(r.tags)
        name = r.tags.get("name")
        if kind and name:
            # Relation center extraction requires full geometry assembly; skipped in this extractor.
            self.counts["relation_skipped"] += 1

    def _parse_ele(self, value):
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        filtered = "".join(ch for ch in text if ch.isdigit() or ch in ".+-")
        if not filtered:
            return None
        try:
            return round(float(filtered))
        except ValueError:
            return None


def main():
    parser = argparse.ArgumentParser(description="Extract named OSM peaks/volcanoes to NDJSON")
    parser.add_argument("--input", required=True, help="Input .osm.pbf file")
    parser.add_argument("--output", required=True, help="Output NDJSON file")
    args = parser.parse_args()

    with open(args.output, "w", encoding="utf-8") as out:
        handler = PeakExtractor(out)
        handler.apply_file(args.input, locations=True)
        print(json.dumps(handler.counts))


if __name__ == "__main__":
    main()
