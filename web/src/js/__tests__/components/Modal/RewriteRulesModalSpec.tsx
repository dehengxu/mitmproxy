import * as React from "react";
import RewriteRulesModal from "../../../components/Modal/RewriteRulesModal";
import { fireEvent, render, screen, waitFor, within } from "../../test-utils";
import { ENDPOINTS } from "../../../ducks/rewrite";
import { fetchApi } from "../../../utils";

jest.mock("../../../utils");

const mocked = fetchApi as unknown as jest.Mock & { post: jest.Mock };

function okJson(payload: unknown) {
    return { ok: true, json: async () => payload };
}

const standalone = {
    id: "rule-solo",
    name: "Solo prices",
    enabled: true,
    ruleset_id: null,
    filter: "~u price",
    phase: "response",
    actions: [{ type: "set_header", target: "response", name: "x-tier", value: "gold" }],
    decision: "execute",
};

const memberA = {
    id: "rule-a",
    name: "A wins the header",
    enabled: true,
    ruleset_id: "set-1",
    filter: "~u api",
    phase: "request",
    actions: [{ type: "set_header", target: "request", name: "x-test", value: "a" }],
    decision: "execute",
};

const memberB = {
    id: "rule-b",
    name: "B is behind A",
    enabled: true,
    ruleset_id: "set-1",
    filter: "~u api",
    phase: "request",
    actions: [{ type: "set_header", target: "request", name: "x-test", value: "b" }],
    decision: "execute",
};

function rulesPayload() {
    return {
        rules: [standalone, memberA, memberB],
        rulesets: [{ id: "set-1", name: "Shop", enabled: true, rules: [memberA, memberB] }],
    };
}

/** Serves GET /rewrite/rules and the preview; everything else is a mutation. */
function mockBackend(
    rules = rulesPayload(),
    preview = {
        success: true,
        rules: [
            {
                rule_id: "rule-a",
                rule_name: "A wins the header",
                ruleset_id: "set-1",
                effective: true,
                skipped_by: null,
            },
            {
                rule_id: "rule-b",
                rule_name: "B is behind A",
                ruleset_id: "set-1",
                effective: false,
                skipped_by: "rule-a",
            },
        ],
    },
) {
    mocked.mockImplementation(async (url: string) => {
        if (url === ENDPOINTS.rules) return okJson(rules);
        if (url.startsWith(ENDPOINTS.rulePreview)) return okJson(preview);
        return okJson({ success: true });
    });
}

describe("RewriteRulesModal", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mocked.post.mockResolvedValue(okJson({ success: true }));
    });

    it("lists the standalone rules and each set's rules in evaluation order", async () => {
        mockBackend();
        render(<RewriteRulesModal />);

        await waitFor(() => screen.getByText("Solo prices"));
        // the set is shown, and so are the rules inside it
        expect(screen.getByText("Shop")).toBeInTheDocument();
        expect(screen.getByText("A wins the header")).toBeInTheDocument();
        expect(screen.getByText("B is behind A")).toBeInTheDocument();
        expect(fetchApi).toHaveBeenCalledWith(ENDPOINTS.rules);
    });

    it("turns a whole rule set off with its master switch", async () => {
        mockBackend();
        const { store } = render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Shop"));

        const switchLabel = screen
            .getByDisplayValue("Shop")
            .closest(".ruleset-head")!
            .querySelector("input[type=checkbox]")!;
        fireEvent.click(switchLabel);

        await waitFor(() =>
            expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.ruleSetEnable, {
                id: "set-1",
                enabled: false,
            }),
        );
        // the list is re-read from the backend, which is the source of truth
        await waitFor(() => expect(fetchApi).toHaveBeenCalledTimes(2));
        expect(store).toBeTruthy();
    });

    it("creates a rule set", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Shop"));

        fireEvent.change(screen.getByLabelText("New rule set name"), {
            target: { value: "Checkout" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Add rule set/ }));

        await waitFor(() => expect(mocked.post).toHaveBeenCalled());
        const [url, body] = mocked.post.mock.calls[0];
        expect(url).toBe(ENDPOINTS.ruleSets);
        expect(body.name).toBe("Checkout");
        expect(typeof body.id).toBe("string");
        expect(body.id).not.toBe("");
    });

    it("deletes a rule set together with its rules", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Shop"));

        fireEvent.click(
            screen.getByTitle("Delete this set and the rules inside it"),
        );

        await waitFor(() =>
            expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.ruleSetDelete, {
                id: "set-1",
            }),
        );
    });

    it("edits a rule inline and saves it to the contract path", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Solo prices"));

        fireEvent.click(screen.getAllByTitle("Edit this rule")[0]);

        const editor = await screen.findByTestId("rule-editor");
        fireEvent.change(within(editor).getByLabelText("Rule name"), {
            target: { value: "Solo prices v2" },
        });
        fireEvent.change(within(editor).getByLabelText("Rule filter"), {
            target: { value: "~u price$" },
        });
        fireEvent.click(within(editor).getByRole("button", { name: /Save rule/ }));

        await waitFor(() => expect(mocked.post).toHaveBeenCalled());
        const [url, body] = mocked.post.mock.calls[0];
        expect(url).toBe(ENDPOINTS.rules);
        expect(body.id).toBe("rule-solo");
        expect(body.name).toBe("Solo prices v2");
        expect(body.filter).toBe("~u price$");
        // editing never moves a rule between sets
        expect(body).not.toHaveProperty("ruleset_id");
    });

    it("toggles one rule on and off", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Solo prices"));

        const row = screen.getByText("Solo prices").closest("tr")!;
        fireEvent.click(row.querySelector("input[type=checkbox]")!);

        await waitFor(() =>
            expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.ruleEnable, {
                id: "rule-solo",
                enabled: false,
            }),
        );
    });

    it("adds a new rule with its actions", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Solo prices"));

        fireEvent.click(
            screen.getByRole("button", { name: /New standalone rule/ }),
        );
        const editor = await screen.findByTestId("rule-editor");

        fireEvent.change(within(editor).getByLabelText("Rule name"), {
            target: { value: "New header" },
        });
        fireEvent.change(within(editor).getByLabelText("Rule filter"), {
            target: { value: "~u new" },
        });
        // one action, filled in completely
        fireEvent.click(within(editor).getByRole("button", { name: /Add action/ }));
        fireEvent.change(within(editor).getByLabelText("name"), {
            target: { value: "x-new" },
        });
        fireEvent.change(within(editor).getByLabelText("value"), {
            target: { value: "1" },
        });

        fireEvent.click(within(editor).getByRole("button", { name: /Save rule/ }));

        await waitFor(() => expect(mocked.post).toHaveBeenCalled());
        const [url, body] = mocked.post.mock.calls[0];
        expect(url).toBe(ENDPOINTS.rules);
        expect(body.name).toBe("New header");
        expect(body.filter).toBe("~u new");
        expect(body.actions).toEqual([
            { type: "set_header", target: "request", name: "x-new", value: "1" },
        ]);
    });

    it("refuses to save a rule whose action is incomplete, before calling the backend", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Solo prices"));

        fireEvent.click(
            screen.getByRole("button", { name: /New standalone rule/ }),
        );
        const editor = await screen.findByTestId("rule-editor");
        fireEvent.change(within(editor).getByLabelText("Rule filter"), {
            target: { value: "~u x" },
        });
        fireEvent.click(within(editor).getByRole("button", { name: /Add action/ }));
        fireEvent.click(within(editor).getByRole("button", { name: /Save rule/ }));

        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "“name” is required",
            ),
        );
        expect(mocked.post).not.toHaveBeenCalled();
    });

    it("reorders the rules inside a set, listing each exactly once", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("B is behind A"));

        const rowB = screen.getByText("B is behind A").closest("tr")!;
        fireEvent.click(
            within(rowB).getByTitle("Move this rule up inside its set"),
        );

        await waitFor(() =>
            expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.ruleSetReorder, {
                id: "set-1",
                rule_ids: ["rule-b", "rule-a"],
            }),
        );
    });

    it("moves a whole rule set in the evaluation order", async () => {
        const payload = rulesPayload();
        payload.rulesets.push({
            id: "set-2",
            name: "Later",
            enabled: true,
            rules: [],
        } as never);
        mockBackend(payload);
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Shop"));

        const setHead = screen.getByDisplayValue("Shop").closest(".ruleset-head")!;
        fireEvent.click(
            within(setHead as HTMLElement).getByTitle(
                "Move this set later in the evaluation order",
            ),
        );

        await waitFor(() =>
            expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.ruleSetMove, {
                id: "set-1",
                index: 1,
            }),
        );
    });

    it("moves a rule into a set and back out of it", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Solo prices"));

        const soloRow = screen.getByText("Solo prices").closest("tr")!;
        fireEvent.change(within(soloRow).getByLabelText("Move into a rule set"), {
            target: { value: "set-1" },
        });

        await waitFor(() =>
            expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.ruleSetAddRule, {
                ruleset_id: "set-1",
                rule_id: "rule-solo",
            }),
        );

        mocked.post.mockClear();
        // the reload after the first change is still in flight, and every
        // control is disabled until it lands
        const memberRow = screen.getByText("A wins the header").closest("tr")!;
        const outButton = within(memberRow).getByTitle(
            "Move out of this set, back to the standalone rules",
        );
        await waitFor(() => expect(outButton).toBeEnabled());
        fireEvent.click(outButton);

        await waitFor(() =>
            expect(mocked.post).toHaveBeenCalledWith(
                ENDPOINTS.ruleSetRemoveRule,
                { ruleset_id: "set-1", rule_id: "rule-a" },
            ),
        );
    });

    it("shows which rule wins the previewed field and which are skipped", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("A wins the header"));

        fireEvent.click(screen.getAllByTitle("Edit this rule")[1]);
        const editor = await screen.findByTestId("rule-editor");

        // a header preview needs the header named before anything is asked
        const preview = await within(editor).findByTestId("hit-preview");
        fireEvent.change(within(preview).getByLabelText("Preview name"), {
            target: { value: "x-test" },
        });

        await waitFor(() =>
            expect(
                within(preview).getByText("A wins the header"),
            ).toBeInTheDocument(),
        );

        expect(within(preview).getByText("Applies")).toBeInTheDocument();
        expect(within(preview).getByText(/Skipped/)).toBeInTheDocument();
        // the skipped row names the rule that got there first
        expect(within(preview).getByText(/A wins the header claims/)).toBeInTheDocument();

        const call = mocked.mock.calls.find((c) =>
            String(c[0]).startsWith(ENDPOINTS.rulePreview),
        )!;
        expect(String(call[0])).toContain("field=header");
    });

    it("asks the backend for the preview with the header name", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("A wins the header"));

        fireEvent.click(screen.getAllByTitle("Edit this rule")[1]);
        const editor = await screen.findByTestId("rule-editor");
        await within(editor).findByTestId("hit-preview");

        fireEvent.change(within(editor).getByLabelText("Preview name"), {
            target: { value: "X-Test" },
        });

        await waitFor(() => {
            const call = mocked.mock.calls.find(
                (c) =>
                    String(c[0]).startsWith(ENDPOINTS.rulePreview) &&
                    String(c[0]).includes("name=x-test"),
            );
            expect(call).toBeTruthy();
        });
    });

    it("keeps the row and shows the backend's error when a change is refused", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Solo prices"));

        // HTTP 200 with success:false, as the contract allows
        mocked.post.mockResolvedValueOnce(
            okJson({ success: false, error: "Rule set 'set-1' does not exist" }),
        );

        fireEvent.click(
            screen.getByTitle("Delete this set and the rules inside it"),
        );

        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "Rule set 'set-1' does not exist",
            ),
        );
        // the set is still on screen: it was not removed behind the user's back
        expect(screen.getByText("Shop")).toBeInTheDocument();
        expect(screen.getByText("A wins the header")).toBeInTheDocument();
    });

    it("shows the backend's words for a rejected HTTP call, not just the status", async () => {
        mockBackend();
        render(<RewriteRulesModal />);
        await waitFor(() => screen.getByText("Solo prices"));

        mocked.post.mockResolvedValueOnce({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            json: async () => ({
                success: false,
                error: "rule_ids must list every rule exactly once",
            }),
        });

        const rowB = screen.getByText("B is behind A").closest("tr")!;
        fireEvent.click(
            within(rowB).getByTitle("Move this rule up inside its set"),
        );

        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "rule_ids must list every rule exactly once",
            ),
        );
    });
});
