import * as React from "react";
import PendingDecisionModal from "../../../components/Modal/PendingDecisionModal";
import { fireEvent, render, screen, waitFor } from "../../test-utils";
import { TStore, testState } from "../../ducks/tutils";
import { ENDPOINTS } from "../../../ducks/rewrite";
import { fetchApi } from "../../../utils";

jest.mock("../../../utils");

const mocked = fetchApi as unknown as jest.Mock & { post: jest.Mock };

function okJson(payload: unknown) {
    return { ok: true, json: async () => payload };
}

function entry(overrides = {}) {
    return {
        token: "tok-1",
        flow_id: "flow-1",
        rule_id: "rule-1",
        rule_name: "Rewrite prices",
        phase: "response",
        host: "shop.example.com",
        path: "/api/price",
        method: "GET",
        created_at: Math.floor(Date.now() / 1000) - 90,
        ...overrides,
    };
}

describe("PendingDecisionModal", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mocked.mockResolvedValue(
            okJson({
                pending: [
                    entry(),
                    entry({
                        token: "tok-2",
                        flow_id: "flow-2",
                        method: "POST",
                        path: "/api/cart",
                        rule_name: "Rewrite cart",
                    }),
                ],
                rules: [
                    {
                        id: "rule-1",
                        name: "Rewrite prices",
                        enabled: true,
                        filter: "~u price",
                        phase: "response",
                        actions: [],
                        decision: "wait",
                    },
                ],
            }),
        );
        mocked.post.mockResolvedValue(okJson({ success: true }));
    });

    it("lists every waiting request with all three outcomes", async () => {
        render(<PendingDecisionModal />);

        await waitFor(() => screen.getByText("Rewrite prices"));

        expect(screen.getByText("Rewrite cart")).toBeInTheDocument();
        expect(screen.getAllByText("shop.example.com")).toHaveLength(2);
        expect(screen.getByText("/api/cart")).toBeInTheDocument();
        // one set of three buttons per row (the intro paragraph names them too,
        // so the buttons are counted by their tooltips)
        expect(screen.getAllByTitle(/Apply the edits/)).toHaveLength(2);
        expect(screen.getAllByTitle(/nothing is forwarded/)).toHaveLength(2);
        expect(screen.getAllByTitle(/Cancel the breakpoint/)).toHaveLength(2);
        expect(fetchApi).toHaveBeenCalledWith(ENDPOINTS.pending);
        expect(fetchApi).toHaveBeenCalledWith(ENDPOINTS.rules);
    });

    it("sends the decision for exactly the row that was clicked", async () => {
        render(<PendingDecisionModal />);
        await waitFor(() => screen.getByText("Rewrite cart"));

        // the intro paragraph also says "Cancel"; the buttons come after it
        fireEvent.click(screen.getAllByTitle(/Cancel the breakpoint/)[1]);

        await waitFor(() =>
            expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.decide, {
                token: "tok-2",
                decision: "cancel",
            }),
        );
        // the decided row leaves the queue, the other one stays
        await waitFor(() =>
            expect(screen.queryByText("Rewrite cart")).toBeNull(),
        );
        expect(screen.getByText("Rewrite prices")).toBeInTheDocument();
    });

    it("keeps the row and shows the reason when the backend refuses a decision", async () => {
        mocked.post.mockResolvedValue(
            okJson({ success: false, error: "Flow is no longer held" }),
        );
        render(<PendingDecisionModal />);
        await waitFor(() => screen.getByText("Rewrite prices"));

        fireEvent.click(screen.getAllByTitle(/Apply the edits/)[0]);

        await waitFor(() => screen.getByRole("alert"));
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Flow is no longer held",
        );
        // the request is still held, so its row must not disappear
        expect(screen.getByText("/api/price")).toBeInTheDocument();
        expect(screen.getAllByTitle(/Apply the edits/)).toHaveLength(2);
    });

    it("shows the empty state when nothing is waiting", async () => {
        mocked.mockResolvedValue(okJson({ pending: [], rules: [] }));

        render(<PendingDecisionModal />);

        await waitFor(() =>
            screen.getByText(/Nothing is waiting for a decision/),
        );
    });

    it("shows the queue's error instead of an empty queue", async () => {
        mocked.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: "Not Found",
        });

        render(<PendingDecisionModal />);

        await waitFor(() => screen.getByRole("alert"));
        expect(screen.getByRole("alert")).toHaveTextContent(
            "HTTP 404 Not Found",
        );
    });

    it("selects the waiting flow when its request is clicked", async () => {
        const flow = { ...testState.flows.list[0], id: "flow-1" };
        const store = TStore({
            ...testState,
            flows: {
                ...testState.flows,
                byId: new Map([[flow.id, flow]]),
            },
        });
        render(<PendingDecisionModal />, { store });
        await waitFor(() => screen.getByText("/api/price"));

        fireEvent.click(screen.getByText("/api/price"));

        expect(store.getState().flows.selected.map((f) => f.id)).toContain(
            "flow-1",
        );
    });
});
