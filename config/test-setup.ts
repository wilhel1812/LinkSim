import "@testing-library/jest-dom/vitest";

// jsdom does not implement window.matchMedia. Provide a no-op stub so
// components that call it at render time (e.g. useSystemTheme, useIsNarrow)
// don't throw. Tests that need specific match results can override this
// per-test with vi.mocked(window.matchMedia).mockReturnValue(...).
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
