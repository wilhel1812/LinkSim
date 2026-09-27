export const supportsWebgl2 = (): boolean => {
  try {
    if (typeof document === "undefined") return false;
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
};
