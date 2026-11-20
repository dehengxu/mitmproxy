import * as React from "react";
import ThrottleModal from "../../../components/Modal/ThrottleModal";
import { render, screen } from "../../test-utils";
import { TStore, testState } from "../../ducks/tutils";

describe("ThrottleModal Component", () => {
    it("shows the current throttle settings", () => {
        const store = TStore({
            ...testState,
            options: {
                ...testState.options,
                throttle_bytes_per_sec: 1000,
                throttle_latency_ms: 100,
            },
        });
        render(<ThrottleModal />, { store });

        expect(
            screen.getByLabelText("Bandwidth").closest("div"),
        ).toBeTruthy();
        const bandwidth = document.getElementById(
            "throttle_bytes_per_sec",
        ) as HTMLInputElement;
        const latency = document.getElementById(
            "throttle_latency_ms",
        ) as HTMLInputElement;
        expect(bandwidth.value).toBe("1000");
        expect(latency.value).toBe("100");
    });

    it("warns about response streaming when a bandwidth limit is set", () => {
        const store = TStore({
            ...testState,
            options: {
                ...testState.options,
                throttle_bytes_per_sec: 1000,
                throttle_latency_ms: 0,
            },
        });
        render(<ThrottleModal />, { store });

        expect(screen.getByText(/response streaming/i)).toBeInTheDocument();
    });

    it("does not warn when no bandwidth limit is set", () => {
        const store = TStore({
            ...testState,
            options: {
                ...testState.options,
                throttle_bytes_per_sec: 0,
                throttle_latency_ms: 0,
            },
        });
        render(<ThrottleModal />, { store });

        expect(screen.queryByText(/response streaming/i)).toBeNull();
    });
});
