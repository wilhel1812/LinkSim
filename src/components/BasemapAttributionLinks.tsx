import type { BasemapAttributionCredit } from "../lib/basemaps";

type BasemapAttributionLinksProps = {
  credits: BasemapAttributionCredit[];
  includeMapLibre?: boolean;
};

const MAPLIBRE_CREDIT: BasemapAttributionCredit = {
  text: "MapLibre",
  url: "https://github.com/maplibre/maplibre-gl-js",
};

export function BasemapAttributionLinks({ credits, includeMapLibre = true }: BasemapAttributionLinksProps) {
  const displayedCredits = includeMapLibre ? [...credits, MAPLIBRE_CREDIT] : credits;
  return displayedCredits.map((credit, index) => (
    <span key={`${credit.text}:${credit.url}`}>
      {index > 0 ? <span> · </span> : null}
      {credit.url ? (
        <a href={credit.url} rel="noreferrer" target="_blank">{credit.text}</a>
      ) : (
        <span>{credit.text}</span>
      )}
    </span>
  ));
}
