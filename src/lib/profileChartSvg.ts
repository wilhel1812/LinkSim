export type ProfileChartSvgProps = {
  width: number;
  height: number;
  viewBox: string;
  preserveAspectRatio: "none";
};

const toSafeSize = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
};

export const buildProfileChartSvgProps = (width: number, height: number): ProfileChartSvgProps => {
  const safeWidth = toSafeSize(width);
  const safeHeight = toSafeSize(height);
  return {
    width: safeWidth,
    height: safeHeight,
    viewBox: `0 0 ${safeWidth} ${safeHeight}`,
    preserveAspectRatio: "none",
  };
};
