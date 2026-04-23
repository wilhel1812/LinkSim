// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { SiteBeamVisualizerPopover } from "./SiteBeamVisualizer";

const initialValues = {
  antennaHeightM: 2,
  txPowerDbm: 20,
  txGainDbi: 2,
  rxGainDbi: 2,
  cableLossDb: 1,
};

function Harness() {
  const [open, setOpen] = useState(false);
  const [txPowerDbm, setTxPowerDbm] = useState(initialValues.txPowerDbm);
  const triggerRef = useRef<HTMLInputElement | null>(null);

  return (
    <div>
      <label>
        Site name
        <input aria-label="Site name" />
      </label>
      <label>
        Tx power
        <input
          aria-label="Tx power"
          onChange={(event) => setTxPowerDbm(Number(event.target.value))}
          onFocus={() => setOpen(true)}
          ref={triggerRef}
          type="number"
          value={txPowerDbm}
        />
      </label>
      <SiteBeamVisualizerPopover
        onClose={() => setOpen(false)}
        open={open}
        triggerRef={triggerRef}
        values={{ ...initialValues, txPowerDbm }}
      />
    </div>
  );
}

describe("SiteBeamVisualizerPopover", () => {
  it("opens from relevant field focus and ignores unrelated fields", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByLabelText("Site name"));
    expect(screen.queryByText("Beam preview")).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Tx power"));
    expect(await screen.findByText("Beam preview")).toBeInTheDocument();
    expect(screen.getByText(/Gray outline: Heltec v3 baseline/)).toBeInTheDocument();
    expect(screen.getByText("Not to scale, illustration only.")).toBeInTheDocument();
  });

  it("keeps non-real numeric readouts out of the educational preview", async () => {
    render(<Harness />);

    const input = screen.getByLabelText("Tx power");
    await userEvent.click(input);
    expect(await screen.findByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(screen.queryByText(/Budget/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Width/i)).not.toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, "28");
    expect(screen.queryByText(/Budget/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Width/i)).not.toBeInTheDocument();
  });
});
