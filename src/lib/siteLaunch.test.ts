import { expect, it } from "vitest";
import { parseSiteLaunch } from "./siteLaunch";

const parse = (search: string, pathname = "/") => parseSiteLaunch({ pathname, search });

it("opens a minimal Site without a node ID", () => {
  expect(parse("?site=1&lat=0&lon=-180&extra=ignored")?.site).toMatchObject({
    name: "Imported Site", position: { lat: 0, lon: -180 },
  });
  expect(parse("?source=868-no&node=%2102eb8e7c")).toBeUndefined();
  expect(parse("?site=1&lat=0&lon=0", "/simulation")).toBeUndefined();
});

it("reads every supported field and decodes attribution", () => {
  const parsed = parse("?site=1&lat=60.12&lon=10.34&name=Hill%20Relay&description=A%26B&groundElevationM=0&antennaHeightM=8&txPowerDbm=22&txGainDbi=4&rxGainDbi=3&cableLossDb=1&antennaMode=directional&antennaAzimuthDeg=90&antennaTiltDeg=-5&antennaHorizontalBeamwidthDeg=70&antennaVerticalBeamwidthDeg=30&antennaMaxAttenuationDb=25&iconKey=antenna&iconColor=%23ABC&source=868.no&sourceUrl=https%3A%2F%2Fmap.868.no%2F");
  expect(parsed).toEqual({
    site: {
      name: "Hill Relay", description: "A&B", position: { lat: 60.12, lon: 10.34 },
      groundElevationM: 0, antennaHeightM: 8, txPowerDbm: 22, txGainDbi: 4, rxGainDbi: 3,
      cableLossDb: 1, antennaMode: "directional", antennaAzimuthDeg: 90, antennaTiltDeg: -5,
      antennaHorizontalBeamwidthDeg: 70, antennaVerticalBeamwidthDeg: 30, antennaMaxAttenuationDb: 25, iconKey: "antenna",
    },
    iconColor: "#aabbcc", source: { label: "868.no", url: "https://map.868.no/" },
  });
});

it.each(["?site=2&lat=0&lon=0", "?site=1&lat=0", "?site=1&lat=91&lon=0",
  "?site=1&lat=0&lon=0&lat=1", "?site=1&lat=0&lon=0&txGainDbi=Infinity",
  "?site=1&lat=0&lon=0&sourceUrl=javascript:alert(1)", "?site=1&lat=0&lon=0&antennaTiltDeg=100",
])("rejects invalid launch %s", (query) => expect(parse(query)).toBeNull());
