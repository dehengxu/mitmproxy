import * as React from "react";
import PendingDecisionModal, {
    formatCountdown,
} from "../../../components/Modal/PendingDecisionModal";
import { fireEvent, render, screen, waitFor } from "../../test-utils";
import { pendingHoldReason } from "../../../ducks/rewrite";
import { ENDPOINTS } from "../../../ducks/rewrite";
import { fetchApi } from "../../../utils";

jest.mock("../../../utils");

const mocked = fetchApi as unknown as jest.Mock & { post: jest.Mock };

function okJson(payload: unknown) {
    return { ok: true, json: async () => payload };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

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
        created_at: nowSeconds() - 90,
        // The backend's own pairing: expire_at = created_at + 300.
        expire_at: nowSeconds() - 90 + 300,
        state: "pending",
        ...overrides,
    };
}

describe("pendingHoldReason", () => {
    const now = 1_700_000_000;

    it("leaves a row decidable while it is pending and inside its wait", () => {
        expect(
            pendingHoldReason({ expire_at: now + 60, state: "pending" }, now),
        ).toBeNull();
    });

    it("treats a missing expire_at and state as still pending", () => {
        expect(pendingHoldReason({}, now)).toBeNull();
        expect(
            pendingHoldReason({ expire_at: null, state: null }, now),
        ).toBeNull();
    });

    it("expires the row the moment now reaches expire_at", () => {
        expect(
            pendingHoldReason({ expire_at: now, state: "pending" }, now),
        ).toBe("Expired");
        expect(
            pendingHoldReason({ expire_at: now - 1, state: "pending" }, now),
        ).toBe("Expired");
    });

    it("names any state the backend reports instead of pending", () => {
        expect(pendingHoldReason({ state: "expired" }, now)).toBe("Expired");
        expect(pendingHoldReason({ state: "disconnected" }, now)).toBe(
            "No longer pending (disconnected)",
        );
    });

    it("reads an ISO expire_at the same as epoch seconds", () => {
        const iso = new Date((now + 10) * 1000).toISOString();
        expect(
            pendingHoldReason({ expire_at: iso, state: "pending" }, now),
        ).toBeNull();
        const past = new Date((now - 10) * 1000).toISOString();
        expect(
            pendingHoldReason({ expire_at: past, state: "pending" }, now),
        ).toBe("Expired");
    });
});

describe("formatCountdown", () => {
    it("counts down in seconds and then minutes", () => {
        expect(formatCountdown(0)).toBe("expires now");
        expect(formatCountdown(12)).toBe("expires in 12s");
        expect(formatCountdown(240)).toBe("expires in 4m");
    });
});

describe("PendingDecisionModal hold annotation", () => {
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
                        // Ran out of its five minutes.
                        expire_at: nowSeconds() - 5,
                    }),
                ],
                rules: [],
            }),
        );
        mocked.post.mockResolvedValue(okJson({ success: true }));
    });

    const rows = () => screen.getAllByRole("row").slice(1);

    it("greys the expired row and says why, next to the row that is still live", async () => {
        render(<PendingDecisionModal />);
        await waitFor(() => screen.getByText("Rewrite cart"));

        const [live, expired] = rows();
        expect(live).toHaveAttribute("data-state", "pending");
        expect(live).not.toHaveClass("pending-expired");
        expect(live).not.toHaveTextContent("Expired");

        expect(expired).toHaveClass("pending-expired");
        expect(expired).toHaveAttribute("data-state", "expired");
        expect(expired).toHaveTextContent("Expired");
    });

    it("keeps the expired row and its buttons: it is shown, not removed", async () => {
        render(<PendingDecisionModal />);
        await waitFor(() => screen.getByText("Rewrite cart"));

        expect(screen.getByText("/api/cart")).toBeInTheDocument();
        expect(screen.getAllByTitle(/Apply the edits/)).toHaveLength(2);
    });

    it("names the state when the backend no longer calls the row pending", async () => {
        mocked.mockResolvedValue(
            okJson({
                pending: [
                    entry({
                        token: "tok-3",
                        flow_id: "flow-3",
                        path: "/api/gone",
                        rule_name: "Rewrite gone",
                        expire_at: nowSeconds() + 120,
                        state: "disconnected",
                    }),
                ],
                rules: [],
            }),
        );
        render(<PendingDecisionModal />);
        await waitFor(() => screen.getByText("Rewrite gone"));

        expect(
            screen.getByText("No longer pending (disconnected)"),
        ).toBeInTheDocument();
    });

    it("shows the backend's own refusal words against the clicked row", async () => {
        // Both rows are still live, so the marking under test is the refusal.
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
                        expire_at: nowSeconds() + 200,
                    }),
                ],
                rules: [],
            }),
        );
        mocked.post.mockResolvedValue(
            okJson({
                success: false,
                error: "待决策已过期（TTL 5 分钟），已自动清理",
            }),
        );
        render(<PendingDecisionModal />);
        await waitFor(() => screen.getByText("Rewrite cart"));

        fireEvent.click(screen.getAllByTitle(/Apply the edits/)[0]);

        await waitFor(() => screen.getByRole("alert"));
        expect(screen.getByRole("alert")).toHaveTextContent(
            "待决策已过期（TTL 5 分钟），已自动清理",
        );
        // No generic "unknown error" when the backend said something.
        expect(screen.getByRole("alert")).not.toHaveTextContent("unknown");
        expect(screen.getByRole("alert")).toHaveTextContent(
            "GET shop.example.com/api/price",
        );
        // The row is still there, marked as refused.
        expect(screen.getByText("/api/price")).toBeInTheDocument();
        const refusedRow = rows()[0];
        expect(refusedRow).toHaveClass("pending-expired");
        expect(refusedRow).toHaveTextContent("Decision refused");
        // The other row is untouched.
        expect(rows()[1]).not.toHaveClass("pending-expired");
    });

    it("reports a client disconnect instead of an unknown error", async () => {
        mocked.post.mockResolvedValue(
            okJson({ success: false, error: "客户端已断开，待决策已取消" }),
        );
        render(<PendingDecisionModal />);
        await waitFor(() => screen.getByText("Rewrite cart"));

        fireEvent.click(screen.getAllByTitle(/nothing is forwarded/)[1]);

        await waitFor(() => screen.getByRole("alert"));
        expect(screen.getByRole("alert")).toHaveTextContent(
            "客户端已断开，待决策已取消",
        );
        expect(screen.getByText("/api/cart")).toBeInTheDocument();
    });

    it("counts down the time a live row has left", async () => {
        mocked.mockResolvedValue(
            okJson({
                pending: [
                    entry({
                        expire_at: nowSeconds() + 240,
                        created_at: nowSeconds(),
                    }),
                ],
                rules: [],
            }),
        );
        render(<PendingDecisionModal />);
        await waitFor(() => screen.getByText("/api/price"));

        expect(screen.getByText(/expires in [34]m/)).toBeInTheDocument();
        expect(screen.getByText(/expires in/).closest("tr")).toHaveAttribute(
            "data-state",
            "pending",
        );
    });

    it("does not invent a countdown when the backend sends no expire_at", async () => {
        mocked.mockResolvedValue(
            okJson({
                pending: [entry({ expire_at: undefined, state: undefined })],
                rules: [],
            }),
        );
        render(<PendingDecisionModal />);
        await waitFor(() => screen.getByText("/api/price"));

        expect(screen.queryByText(/expires in/)).toBeNull();
        expect(rows()[0]).toHaveAttribute("data-state", "pending");
        expect(fetchApi).toHaveBeenCalledWith(ENDPOINTS.pending);
    });
});
