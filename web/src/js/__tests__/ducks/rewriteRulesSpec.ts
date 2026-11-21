import {
    addRuleToSet,
    deleteRuleSet,
    ENDPOINTS,
    fetchRulePreview,
    fetchRules,
    moveRuleSet,
    removeRuleFromSet,
    reorderRuleSet,
    saveRuleSet,
    setRuleSetEnabled,
    setRuleEnabled,
} from "../../ducks/rewrite";
import { TStore } from "./tutils";
import { fetchApi } from "../../utils";

jest.mock("../../utils");

const mocked = fetchApi as unknown as jest.Mock & { post: jest.Mock };

function okJson(payload: unknown) {
    return { ok: true, json: async () => payload };
}

/** The message a rejected thunk surfaces; RTK hands back a plain object. */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (e) {
        const error = e as { message?: string };
        return error && error.message ? error.message : String(e);
    }
    throw new Error("expected the call to be rejected, but it was not");
}

const rule = {
    id: "rule-1",
    name: "Rewrite prices",
    enabled: true,
    ruleset_id: null,
    filter: "~u price",
    phase: "response",
    actions: [],
    decision: "execute",
};

const ruleset = {
    id: "set-1",
    name: "Shop",
    enabled: true,
    rules: [rule],
};

describe("rewrite rules duck (REQ-6.2)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mocked.mockResolvedValue(okJson({ success: true }));
        mocked.post.mockResolvedValue(okJson({ success: true }));
    });

    it("keeps the rules and the rule sets from one read", async () => {
        mocked.mockResolvedValue(okJson({ rules: [rule], rulesets: [ruleset] }));
        const store = TStore();

        await store.dispatch(fetchRules());

        expect(fetchApi).toHaveBeenCalledWith(ENDPOINTS.rules);
        expect(store.getState().rewrite.rules).toHaveLength(1);
        expect(store.getState().rewrite.rulesets).toHaveLength(1);
        expect(store.getState().rewrite.rulesets[0].rules[0].id).toBe("rule-1");
    });

    it("calls the rule-set endpoints with the frozen contract shapes", async () => {
        const store = TStore();

        await store.dispatch(saveRuleSet({ id: "set-1", name: "Shop" }));
        expect(mocked.post).toHaveBeenNthCalledWith(1, ENDPOINTS.ruleSets, {
            id: "set-1",
            name: "Shop",
        });

        await store.dispatch(setRuleSetEnabled({ id: "set-1", enabled: false }));
        expect(mocked.post).toHaveBeenNthCalledWith(2, ENDPOINTS.ruleSetEnable, {
            id: "set-1",
            enabled: false,
        });

        await store.dispatch(
            addRuleToSet({ rulesetId: "set-1", ruleId: "rule-1" }),
        );
        expect(mocked.post).toHaveBeenNthCalledWith(3, ENDPOINTS.ruleSetAddRule, {
            ruleset_id: "set-1",
            rule_id: "rule-1",
        });

        // index is only sent when it is given: omitting it means "append"
        await store.dispatch(
            addRuleToSet({ rulesetId: "set-1", ruleId: "rule-2", index: 0 }),
        );
        expect(mocked.post).toHaveBeenNthCalledWith(4, ENDPOINTS.ruleSetAddRule, {
            ruleset_id: "set-1",
            rule_id: "rule-2",
            index: 0,
        });

        await store.dispatch(
            removeRuleFromSet({ rulesetId: "set-1", ruleId: "rule-1" }),
        );
        expect(mocked.post).toHaveBeenNthCalledWith(
            5,
            ENDPOINTS.ruleSetRemoveRule,
            { ruleset_id: "set-1", rule_id: "rule-1" },
        );

        await store.dispatch(
            reorderRuleSet({ id: "set-1", ruleIds: ["rule-2", "rule-1"] }),
        );
        expect(mocked.post).toHaveBeenNthCalledWith(6, ENDPOINTS.ruleSetReorder, {
            id: "set-1",
            rule_ids: ["rule-2", "rule-1"],
        });

        await store.dispatch(moveRuleSet({ id: "set-1", index: 2 }));
        expect(mocked.post).toHaveBeenNthCalledWith(7, ENDPOINTS.ruleSetMove, {
            id: "set-1",
            index: 2,
        });

        await store.dispatch(deleteRuleSet("set-1"));
        expect(mocked.post).toHaveBeenNthCalledWith(8, ENDPOINTS.ruleSetDelete, {
            id: "set-1",
        });
    });

    it("asks the preview endpoint for one target and field", async () => {
        mocked.mockResolvedValue(
            okJson({
                success: true,
                rules: [
                    {
                        rule_id: "rule-1",
                        rule_name: "Rewrite prices",
                        ruleset_id: null,
                        effective: true,
                        skipped_by: null,
                    },
                ],
            }),
        );
        const store = TStore();

        const result = await store.dispatch(
            fetchRulePreview({ target: "request", field: "header", name: "X-Test" }),
        ).unwrap();

        expect(result).toHaveLength(1);
        const url = String(mocked.mock.calls[0][0]);
        expect(url.startsWith(ENDPOINTS.rulePreview)).toBe(true);
        expect(url).toContain("target=request");
        expect(url).toContain("field=header");
        expect(url).toContain("name=X-Test");
    });

    it("treats HTTP 200 with success:false as a failure", async () => {
        mocked.post.mockResolvedValue(
            okJson({ success: false, error: "rule_ids must list every rule once" }),
        );
        const store = TStore();

        expect(
            await rejectionMessage(
                store
                    .dispatch(
                        reorderRuleSet({
                            id: "set-1",
                            ruleIds: ["rule-1"],
                        }),
                    )
                    .unwrap(),
            ),
        ).toBe("rule_ids must list every rule once");
    });

    it("prefers the backend's error over the bare status line", async () => {
        mocked.post.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: "Not Found",
            json: async () => ({ success: false, error: "Rule set set-1 not found" }),
        });
        const store = TStore();

        expect(
            await rejectionMessage(
                store.dispatch(deleteRuleSet("set-1")).unwrap(),
            ),
        ).toBe("Rule set set-1 not found");
    });

    it("keeps a set's rules when the answer only carries its switch", async () => {
        const store = TStore();
        store.dispatch({
            type: "rewrite/fetchRules/fulfilled",
            payload: { rules: [rule], rulesets: [ruleset] },
        });

        // a partial payload: the set, but no rule list
        store.dispatch({
            type: "rewrite/setRuleSetEnabled/fulfilled",
            payload: { id: "set-1", enabled: false },
        });

        const stored = store.getState().rewrite.rulesets[0];
        expect(stored.enabled).toBe(false);
        expect(stored.rules).toHaveLength(1);
    });

    it("keeps the set's rules when a mutation answers without them", async () => {
        const store = TStore();
        store.dispatch({
            type: "rewrite/fetchRules/fulfilled",
            payload: { rules: [rule], rulesets: [ruleset] },
        });

        store.dispatch({
            type: "rewrite/saveRuleSet/fulfilled",
            payload: { id: "set-1", name: "Shop renamed" },
        });

        const stored = store.getState().rewrite.rulesets[0];
        expect(stored.name).toBe("Shop renamed");
        expect(stored.rules).toHaveLength(1);
    });

    it("keeps both copies of a rule in step when one is toggled", async () => {
        const store = TStore();
        store.dispatch({
            type: "rewrite/fetchRules/fulfilled",
            payload: { rules: [rule], rulesets: [ruleset] },
        });

        await store.dispatch(setRuleEnabled({ id: "rule-1", enabled: false }));

        expect(store.getState().rewrite.rules[0].enabled).toBe(false);
        expect(store.getState().rewrite.rulesets[0].rules[0].enabled).toBe(false);
    });
});
