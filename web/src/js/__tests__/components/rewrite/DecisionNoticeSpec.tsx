import * as React from "react";
import DecisionNotice from "../../../components/rewrite/DecisionNotice";
import { fireEvent, render, screen, waitFor } from "../../test-utils";
import { TStore, testState } from "../../ducks/tutils";
import { disableNoticeRule, setRuleEnabled } from "../../../ducks/rewrite";
import { fetchApi } from "../../../utils";

jest.mock("../../../utils");

const mocked = fetchApi as unknown as jest.Mock & { post: jest.Mock };

function okJson(payload: unknown) {
    return { ok: true, json: async () => payload };
}

const rule = {
    id: "rule-1",
    name: "Rewrite prices",
    enabled: true,
    filter: "~u price",
    phase: "response",
    actions: [],
    decision: "wait",
};

function storeWith(notice, rules = [rule]) {
    return TStore({
        ...testState,
        rewrite: { ...testState.rewrite, notice, rules },
    });
}

describe("DecisionNotice", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mocked.mockResolvedValue(okJson({ success: true }));
        mocked.post.mockResolvedValue(okJson({ success: true }));
    });

    it("renders nothing without a notice", () => {
        render(<DecisionNotice />, { store: TStore() });
        expect(screen.queryByTestId("decision-notice")).toBeNull();
    });

    it("says the rule is still enabled and offers to disable it", () => {
        const store = storeWith({
            kind: "info",
            message:
                'Breakpoint cancelled: edits dropped, flow passed through. Rule "Rewrite prices" is still enabled.',
            ruleId: "rule-1",
            ruleName: "Rewrite prices",
        });
        render(<DecisionNotice />, { store });

        expect(screen.getByTestId("decision-notice")).toHaveTextContent(
            "still enabled",
        );
        expect(
            screen.getByRole("button", { name: /Disable this rule/ }),
        ).toBeInTheDocument();
    });

    it("disables the rule it names, then stops warning about it", async () => {
        const store = storeWith({
            kind: "info",
            message:
                'Breakpoint cancelled: edits dropped, flow passed through. Rule "Rewrite prices" is still enabled.',
            ruleId: "rule-1",
            ruleName: "Rewrite prices",
        });
        render(<DecisionNotice />, { store });

        fireEvent.click(
            screen.getByRole("button", { name: /Disable this rule/ }),
        );

        await waitFor(() =>
            expect(mocked.post).toHaveBeenCalledWith("/rewrite/rules/enable", {
                id: "rule-1",
                enabled: false,
            }),
        );
        await waitFor(() =>
            expect(screen.queryByTestId("decision-notice")).toBeNull(),
        );
        expect(store.getState().rewrite.rules[0].enabled).toBe(false);
    });

    it("offers no rule button when the cancel had no rule behind it", () => {
        const store = storeWith({
            kind: "info",
            message:
                "Interception cancelled: edits dropped, flow passed through.",
        });
        render(<DecisionNotice />, { store });

        expect(screen.getByTestId("decision-notice")).toHaveTextContent(
            "edits dropped",
        );
        expect(
            screen.queryByRole("button", { name: /Disable this rule/ }),
        ).toBeNull();
    });

    it("can be dismissed", () => {
        const store = storeWith({
            kind: "info",
            message: "Breakpoint cancelled.",
        });
        render(<DecisionNotice />, { store });

        fireEvent.click(screen.getByTitle("Dismiss"));

        expect(store.getState().rewrite.notice).toBeNull();
    });

    it("says the rule is already off rather than offering to disable it again", () => {
        const store = storeWith(
            {
                kind: "info",
                message: "Breakpoint cancelled.",
                ruleId: "rule-1",
                ruleName: "Rewrite prices",
            },
            [{ ...rule, enabled: false }],
        );
        render(<DecisionNotice />, { store });

        expect(screen.getByText("Rule disabled")).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: /Disable this rule/ }),
        ).toBeNull();
    });
});

describe("disableNoticeRule", () => {
    it("does nothing when the notice names no rule", async () => {
        const store = TStore();
        await store.dispatch(disableNoticeRule());
        expect(mocked.post).not.toHaveBeenCalled();
    });
});

describe("setRuleEnabled", () => {
    it("keeps a failed call from pretending the rule changed", async () => {
        mocked.post.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: "Server Error",
        });
        const store = TStore();
        store.dispatch({
        type: "rewrite/fetchRules/fulfilled",
        // fetchRules reads rules and rule sets in one call (REQ-6.2).
        payload: { rules: [rule], rulesets: [] },
    });

        const result = await store.dispatch(
            setRuleEnabled({ id: "rule-1", enabled: false }),
        );

        expect(result.type).toBe("rewrite/setRuleEnabled/rejected");
        expect(store.getState().rewrite.rules[0].enabled).toBe(true);
    });
});
