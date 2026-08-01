export type SimulationOverlayHandoffPhase =
  | "idle"
  | "entering"
  | "entered"
  | "exiting"
  | "hiding";

export type SimulationOverlayHandoffState = {
  phase: SimulationOverlayHandoffPhase;
  requestKey: string | null;
  cloudReady: boolean;
  cloudEntered: boolean;
  replacementReady: boolean;
  revealReplacement: boolean;
};

export type SimulationOverlayHandoffEvent =
  | { type: "request"; requestKey: string }
  | { type: "cloud-ready"; requestKey: string }
  | { type: "cloud-entered"; requestKey: string }
  | { type: "replacement-ready"; requestKey: string }
  | { type: "request-failed"; requestKey: string }
  | { type: "exit-complete"; requestKey: string }
  | { type: "hide" }
  | { type: "hidden" };

export const initialSimulationOverlayHandoffState: SimulationOverlayHandoffState = {
  phase: "idle",
  requestKey: null,
  cloudReady: false,
  cloudEntered: false,
  replacementReady: false,
  revealReplacement: false,
};

export const reduceSimulationOverlayHandoff = (
  state: SimulationOverlayHandoffState,
  event: SimulationOverlayHandoffEvent,
): SimulationOverlayHandoffState => {
  switch (event.type) {
    case "request": {
      const keepEnteredCloud =
        state.phase === "entering" || state.phase === "entered";
      return {
        phase:
          keepEnteredCloud && state.cloudEntered
            ? "entered"
            : "entering",
        requestKey: event.requestKey,
        cloudReady: keepEnteredCloud && state.cloudReady,
        cloudEntered: keepEnteredCloud && state.cloudEntered,
        replacementReady: false,
        revealReplacement: false,
      };
    }
    case "cloud-ready":
      if (state.requestKey !== event.requestKey) return state;
      return { ...state, cloudReady: true };
    case "cloud-entered":
      if (state.requestKey !== event.requestKey) return state;
      if (state.replacementReady) {
        return {
          ...state,
          phase: "exiting",
          cloudEntered: true,
          revealReplacement: true,
        };
      }
      return { ...state, phase: "entered", cloudEntered: true };
    case "replacement-ready":
      if (state.requestKey !== event.requestKey) return state;
      if (state.cloudEntered) {
        return {
          ...state,
          phase: "exiting",
          replacementReady: true,
          revealReplacement: true,
        };
      }
      return { ...state, replacementReady: true };
    case "request-failed":
      if (state.requestKey !== event.requestKey) return state;
      if (!state.cloudReady) return initialSimulationOverlayHandoffState;
      return {
        ...state,
        phase: "exiting",
        replacementReady: false,
        revealReplacement: false,
      };
    case "exit-complete":
      if (
        state.phase !== "exiting" ||
        state.requestKey !== event.requestKey
      ) return state;
      return initialSimulationOverlayHandoffState;
    case "hide":
      return {
        ...state,
        phase: "hiding",
        replacementReady: false,
        revealReplacement: false,
      };
    case "hidden":
      if (state.phase !== "hiding") return state;
      return initialSimulationOverlayHandoffState;
  }
};
