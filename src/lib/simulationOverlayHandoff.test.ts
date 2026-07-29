import { describe, expect, it } from "vitest";
import {
  initialSimulationOverlayHandoffState,
  reduceSimulationOverlayHandoff,
} from "./simulationOverlayHandoff";

describe("simulation overlay handoff", () => {
  it("holds a fast replacement until the cloud entrance completes", () => {
    let state = reduceSimulationOverlayHandoff(
      initialSimulationOverlayHandoffState,
      { type: "request", requestKey: "heatmap" },
    );
    state = reduceSimulationOverlayHandoff(state, {
      type: "replacement-ready",
      requestKey: "heatmap",
    });
    expect(state.phase).toBe("entering");
    expect(state.revealReplacement).toBe(false);

    state = reduceSimulationOverlayHandoff(state, {
      type: "cloud-ready",
      requestKey: "heatmap",
    });
    state = reduceSimulationOverlayHandoff(state, {
      type: "cloud-entered",
      requestKey: "heatmap",
    });
    expect(state.phase).toBe("exiting");
    expect(state.revealReplacement).toBe(true);
  });

  it("keeps an entered cloud active while rapid requests replace the target", () => {
    let state = reduceSimulationOverlayHandoff(
      initialSimulationOverlayHandoffState,
      { type: "request", requestKey: "relay" },
    );
    state = reduceSimulationOverlayHandoff(state, {
      type: "cloud-ready",
      requestKey: "relay",
    });
    state = reduceSimulationOverlayHandoff(state, {
      type: "cloud-entered",
      requestKey: "relay",
    });
    state = reduceSimulationOverlayHandoff(state, {
      type: "request",
      requestKey: "heatmap",
    });

    expect(state).toMatchObject({
      phase: "entered",
      requestKey: "heatmap",
      cloudReady: true,
      cloudEntered: true,
      replacementReady: false,
    });
    expect(
      reduceSimulationOverlayHandoff(state, {
        type: "replacement-ready",
        requestKey: "relay",
      }),
    ).toEqual(state);
  });

  it("restores the retained overlay when the latest replacement fails", () => {
    let state = reduceSimulationOverlayHandoff(
      initialSimulationOverlayHandoffState,
      { type: "request", requestKey: "weakest" },
    );
    state = reduceSimulationOverlayHandoff(state, {
      type: "cloud-ready",
      requestKey: "weakest",
    });
    state = reduceSimulationOverlayHandoff(state, {
      type: "request-failed",
      requestKey: "weakest",
    });

    expect(state.phase).toBe("exiting");
    expect(state.revealReplacement).toBe(false);
  });

  it("abandons an unpainted failed request without fading the retained overlay", () => {
    const requested = reduceSimulationOverlayHandoff(
      initialSimulationOverlayHandoffState,
      { type: "request", requestKey: "mesh-extension" },
    );
    expect(
      reduceSimulationOverlayHandoff(requested, {
        type: "request-failed",
        requestKey: "mesh-extension",
      }),
    ).toEqual(initialSimulationOverlayHandoffState);
  });

  it("hides directly without starting a cloud handoff", () => {
    const hiding = reduceSimulationOverlayHandoff(
      initialSimulationOverlayHandoffState,
      { type: "hide" },
    );
    expect(hiding.phase).toBe("hiding");
    expect(hiding.cloudReady).toBe(false);
    expect(
      reduceSimulationOverlayHandoff(hiding, { type: "hidden" }),
    ).toEqual(initialSimulationOverlayHandoffState);
  });

  it("lets an already visible cloud fade out when Hidden is selected", () => {
    let state = reduceSimulationOverlayHandoff(
      initialSimulationOverlayHandoffState,
      { type: "request", requestKey: "relay" },
    );
    state = reduceSimulationOverlayHandoff(state, {
      type: "cloud-ready",
      requestKey: "relay",
    });
    state = reduceSimulationOverlayHandoff(state, { type: "hide" });

    expect(state).toMatchObject({
      phase: "hiding",
      requestKey: "relay",
      cloudReady: true,
    });
    expect(
      reduceSimulationOverlayHandoff(state, {
        type: "exit-complete",
        requestKey: "relay",
      }),
    ).toEqual(state);
  });
});
