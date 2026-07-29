export const copernicus30PathForTileKey = (tileKey: string): string => {
  const match = /^([NS])(\d{2})([EW])(\d{3})$/.exec(tileKey);
  if (!match) throw new Error(`Invalid terrain tile key: ${tileKey}`);
  const [, ns, lat, ew, lon] = match;
  const objectName = `Copernicus_DSM_COG_10_${ns}${lat}_00_${ew}${lon}_00_DEM`;
  return `/copernicus/30m/${objectName}/${objectName}.tif`;
};
