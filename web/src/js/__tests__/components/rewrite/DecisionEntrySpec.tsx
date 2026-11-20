import * as React from "react";
import PendingDecisionEntry from "../../../components/Header/PendingDecisionEntry";
import { render, waitFor } from "../../test-utils";
import { fireEvent, screen } from "@testing-library/react";
import { TStore, testState, TFlow } from "../../ducks/tutils";
import { fetchApi } from "../../../utils";

jest.mock("../../../utils");

const mocked = fetchApi as unknown as jest.Mock & { post: jest.Mock };

function storeWithHeld(count: number) {
    const flows = [TFlow(), TFlow(), TFlow()];
    flows[0].id = "held-1";
    flows[0].intercepted = true;
    flows[1].id = "held-2";
    flows[1].intercepted = true;
    flows[2].id = "plain";
    flows[2].intercepted = false;
    const held = flows.slice(0, count);
    const plain = flows[2];
    return TStore({
        ...testState,
        flows: {
            ...testState.flows,
            list: [...held, plain],
            view: [...held, plain],
        },
    });
}

describe("PendingDecisionEntry", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mocked.mockResolvedValue({ ok: true, json: async () => ({ pending: [] }) });
    });

    it("counts the flows that are really held", () => {
        render(<PendingDecisionEntry />, { store: storeWithHeld(2) });

        expect(screen.getByText("Pending")).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
        expect(
            screen.getByTitle("2 requests waiting for a decision"),
        ).toBeInTheDocument();
    });

    it("stays quiet when nothing is held", () => {
        render(<PendingDecisionEntry />, { store: storeWithHeld(0) });

        expect(screen.queryByText(/^\d+$/)).toBeNull();
        expect(
            screen.getByTitle("No requests are waiting for a decision"),
        ).toBeInTheDocument();
    });

    it("opens the queue and reads it when clicked", async () => {
        const store = storeWithHeld(1);
        render(<PendingDecisionEntry />, { store });

        fireEvent.click(screen.getByText("Pending"));

        expect(store.getState().ui.modal.activeModal).toBe(
            "PendingDecisionModal",
        );
        await waitFor(() =>
            expect(fetchApi).toHaveBeenCalledWith("/rewrite/pending"),
        );
    });
});
