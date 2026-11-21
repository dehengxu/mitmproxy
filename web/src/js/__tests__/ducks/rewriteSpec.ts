import {
    decideFlows,
    decidePendingEntry,
    ENDPOINTS,
    fetchPending,
    fetchRules,
    isStandalone,
    owningRuleSetId,
    setRuleEnabled,
} from "../../ducks/rewrite";
import * as flowsActions from "../../ducks/flows";
import { TFlow, TStore } from "./tutils";
import { fetchApi } from "../../utils";

jest.mock("../../utils");

const mocked = fetchApi as unknown as jest.Mock & { post: jest.Mock };

function okJson(payload: unknown) {
    return { ok: true, json: async () => payload };
}

/** The message a rejected decision surfaces; RTK hands back a plain object. */
async function rejectionMessage(promise: Promise<unknown> | unknown): Promise<string> {
    try {
        await promise;
    } catch (e) {
        const error = e as { message?: string };
        return error && error.message ? error.message : String(e);
    }
    throw new Error("expected the decision to be rejected, but it was not");
}

function pending(overrides = {}) {
    return {
        token: "tok-1",
        flow_id: "flow-pending",
        rule_id: "rule-1",
        rule_name: "Rewrite prices",
        phase: "response",
        host: "shop.example.com",
        path: "/api/price",
        method: "GET",
        created_at: Math.floor(Date.now() / 1000),
        ...overrides,
    };
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

describe("rewrite duck", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mocked.mockResolvedValue(okJson({ success: true }));
        mocked.post.mockResolvedValue(okJson({ success: true }));
    });

    it("reads the pending queue from the contract path", async () => {
        mocked.mockResolvedValue(okJson({ pending: [pending()] }));
        const store = TStore();

        await store.dispatch(fetchPending());

        expect(fetchApi).toHaveBeenCalledWith(ENDPOINTS.pending);
        expect(store.getState().rewrite.pending).toHaveLength(1);
        expect(store.getState().rewrite.pending[0].rule_name).toBe(
            "Rewrite prices",
        );
    });

    it("keeps the queue but exposes an error when the call fails", async () => {
        mocked.mockResolvedValue({
            ok: false,
            status: 500,
            statusText: "Server Error",
        });
        const store = TStore();

        await store.dispatch(fetchPending());

        expect(store.getState().rewrite.error).toBe("HTTP 500 Server Error");
    });

    it("sends execute, abort and cancel as three distinct decisions", async () => {
        const store = TStore();

        for (const decision of ["execute", "abort", "cancel"] as const) {
            await store.dispatch(decidePendingEntry(pending(), decision));
        }

        expect(mocked.post).toHaveBeenNthCalledWith(1, ENDPOINTS.decide, {
            token: "tok-1",
            decision: "execute",
        });
        expect(mocked.post).toHaveBeenNthCalledWith(2, ENDPOINTS.decide, {
            token: "tok-1",
            decision: "abort",
        });
        expect(mocked.post).toHaveBeenNthCalledWith(3, ENDPOINTS.decide, {
            token: "tok-1",
            decision: "cancel",
        });
    });

    it("removes a decided entry from the queue", async () => {
        const store = TStore();
        store.dispatch({
            type: "rewrite/setPending",
            payload: [pending(), pending({ token: "tok-2" })],
        });

        await store.dispatch(decidePendingEntry(pending(), "execute"));

        expect(
            store.getState().rewrite.pending.map((entry) => entry.token),
        ).toEqual(["tok-2"]);
    });

    it("tells the user the rule is still enabled after cancel, and can disable it", async () => {
        const store = TStore();
        store.dispatch({
        type: "rewrite/fetchRules/fulfilled",
        // fetchRules reads rules and rule sets in one call (REQ-6.2).
        payload: { rules: [rule], rulesets: [] },
    });

        await store.dispatch(decidePendingEntry(pending(), "cancel"));

        const notice = store.getState().rewrite.notice!;
        expect(notice.message).toContain("still enabled");
        expect(notice.ruleName).toBe("Rewrite prices");
        expect(notice.ruleId).toBe("rule-1");

        await store.dispatch(setRuleEnabled({ id: "rule-1", enabled: false }));

        expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.ruleEnable, {
            id: "rule-1",
            enabled: false,
        });
        expect(store.getState().rewrite.rules[0].enabled).toBe(false);
        // once the rule it warns about is off, the toast has nothing left to say
        expect(store.getState().rewrite.notice).toBeNull();
    });

    it("keeps the row and reports the error when the backend refuses the decision", async () => {
        // HTTP 200 with success:false: the flow settled in the meantime (client
        // gone, proxy stopped). The request is still held, so the row stays.
        const store = TStore();
        store.dispatch({
            type: "rewrite/setPending",
            payload: [pending(), pending({ token: "tok-2" })],
        });
        mocked.post.mockResolvedValue(
            okJson({ success: false, error: "No pending decision for token tok-1" }),
        );

        expect(
            await rejectionMessage(
                store.dispatch(decidePendingEntry(pending(), "execute")),
            ),
        ).toBe("No pending decision for token tok-1");

        expect(
            store.getState().rewrite.pending.map((entry) => entry.token),
        ).toEqual(["tok-1", "tok-2"]);
        // an execute shows no rule toast, so a failed one must not leave one
        expect(store.getState().rewrite.notice).toBeNull();
    });

    it("does not show the cancel toast when the decision was refused", async () => {
        const store = TStore();
        store.dispatch({ type: "rewrite/setPending", payload: [pending()] });
        mocked.post.mockResolvedValue(
            okJson({ success: false, error: "Flow already released" }),
        );

        expect(
            await rejectionMessage(
                store.dispatch(decidePendingEntry(pending(), "cancel")),
            ),
        ).toBe("Flow already released");

        expect(store.getState().rewrite.notice).toBeNull();
        expect(store.getState().rewrite.pending).toHaveLength(1);
    });

    it("does not show the rule warning for execute or abort", async () => {
        const store = TStore();

        await store.dispatch(decidePendingEntry(pending(), "execute"));
        expect(store.getState().rewrite.notice).toBeNull();

        await store.dispatch(decidePendingEntry(pending(), "abort"));
        expect(store.getState().rewrite.notice).toBeNull();
    });

    it("loads rules from the contract path", async () => {
        mocked.mockResolvedValue(okJson({ rules: [rule] }));
        const store = TStore();

        await store.dispatch(fetchRules());

        expect(fetchApi).toHaveBeenCalledWith(ENDPOINTS.rules);
        expect(store.getState().rewrite.rules).toHaveLength(1);
    });
});

describe("flow decisions", () => {
    function storeWithHeldFlow() {
        const store = TStore();
        const flow = TFlow();
        flow.id = "flow-x";
        flow.intercepted = true;
        flow.modified = true;
        store.dispatch(flowsActions.FLOWS_RECEIVE([flow]));
        return { store, flow };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        mocked.mockResolvedValue(okJson({ success: true }));
        mocked.post.mockResolvedValue(okJson({ success: true }));
    });

    it("cancelling an intercepted flow reverts the edits and resumes it", async () => {
        const { store, flow } = storeWithHeldFlow();

        await store.dispatch(decideFlows("cancel", [flow]));

        const urls = mocked.mock.calls.map((call) => call[0]);
        expect(urls).toContain(`/flows/${flow.id}/revert`);
        expect(urls).toContain(`/flows/${flow.id}/resume`);
        expect(store.getState().rewrite.notice!.message).toContain(
            "edits dropped",
        );
    });

    it("execute resumes, abort kills", async () => {
        const { store, flow } = storeWithHeldFlow();

        await store.dispatch(decideFlows("execute", [flow]));
        await store.dispatch(decideFlows("abort", [flow]));

        const urls = mocked.mock.calls.map((call) => call[0]);
        expect(urls).toContain(`/flows/${flow.id}/resume`);
        expect(urls).toContain(`/flows/${flow.id}/kill`);
    });

    it("uses the pending token instead of the flow endpoints", async () => {
        const { store, flow } = storeWithHeldFlow();
        store.dispatch({
            type: "rewrite/setPending",
            payload: [pending({ token: "tok-9", flow_id: flow.id })],
        });

        await store.dispatch(decideFlows("execute", [flow]));

        expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.decide, {
            token: "tok-9",
            decision: "execute",
        });
        expect(mocked.mock.calls.map((call) => call[0])).not.toContain(
            `/flows/${flow.id}/resume`,
        );
    });

    it("leaves the flow held and says so when its decision is refused", async () => {
        const { store, flow } = storeWithHeldFlow();
        store.dispatch({
            type: "rewrite/setPending",
            payload: [pending({ token: "tok-7", flow_id: flow.id })],
        });
        mocked.post.mockResolvedValue(
            okJson({ success: false, error: "Flow is gone" }),
        );

        await store.dispatch(decideFlows("execute", [flow]));

        expect(store.getState().rewrite.notice!.kind).toBe("error");
        expect(store.getState().rewrite.notice!.message).toContain("Flow is gone");
        expect(store.getState().rewrite.notice!.message).toContain("still waiting");
        // no fallback to the plain flow endpoints: the rule owns this flow
        expect(mocked.mock.calls.map((call) => call[0])).not.toContain(
            `/flows/${flow.id}/resume`,
        );
        expect(store.getState().rewrite.pending).toHaveLength(1);
    });

    it("refreshes a stale queue before deciding, instead of bypassing the rule", async () => {
        // A queue read earlier can be out of date: here it still lists another
        // flow, so the target looks unbuffered and would take the plain path.
        const { store, flow } = storeWithHeldFlow();
        store.dispatch({
            type: "rewrite/setPending",
            payload: [pending({ token: "tok-old", flow_id: "some-other-flow" })],
        });

        mocked.mockImplementation(async (url: string) =>
            url === ENDPOINTS.pending
                ? okJson({
                      pending: [
                          pending({ token: "tok-new", flow_id: flow.id }),
                      ],
                  })
                : okJson({ success: true }),
        );

        await store.dispatch(decideFlows("execute", [flow]));

        expect(fetchApi).toHaveBeenCalledWith(ENDPOINTS.pending);
        expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.decide, {
            token: "tok-new",
            decision: "execute",
        });
        expect(mocked.mock.calls.map((call) => call[0])).not.toContain(
            `/flows/${flow.id}/resume`,
        );
    });

    it("finds the token when the queue has not been read yet", async () => {
        // The flow table's quick actions can be the first thing clicked, with
        // state.rewrite.pending still empty: without a refresh the held flow
        // would be settled the plain way and the rule would not hear about it.
        const { store, flow } = storeWithHeldFlow();
        expect(store.getState().rewrite.pending).toHaveLength(0);

        mocked.mockImplementation(async (url: string) =>
            url === ENDPOINTS.pending
                ? okJson({ pending: [pending({ token: "tok-late", flow_id: flow.id })] })
                : okJson({ success: true }),
        );

        await store.dispatch(decideFlows("cancel", [flow]));

        expect(mocked.post).toHaveBeenCalledWith(ENDPOINTS.decide, {
            token: "tok-late",
            decision: "cancel",
        });
        const urls = mocked.mock.calls.map((call) => call[0]);
        expect(urls).not.toContain(`/flows/${flow.id}/kill`);
        // Cancel of a rule-backed flow is decided by the backend, not by a
        // client-side resume.
        expect(urls).not.toContain(`/flows/${flow.id}/resume`);
    });
});

describe("rule set membership", () => {
    // The backend runs `model_dump(exclude_none=True)`, so a standalone rule's
    // payload has no `ruleset_id` key at all -- not `ruleset_id: null`. The
    // contract calls this out; judging by truthiness would already work but
    // judging by key presence is what the contract states, and it also holds
    // if a null ever does appear.
    it("treats a rule with no ruleset_id key as standalone", () => {
        const standalone = {
            id: "solo",
            name: "Solo",
            enabled: true,
            filter: "~u price",
            phase: "response",
            actions: [],
            decision: "execute",
        };
        expect("ruleset_id" in standalone).toBe(false);
        expect(isStandalone(standalone)).toBe(true);
        expect(owningRuleSetId(standalone)).toBeNull();
    });

    it("treats an explicit null ruleset_id as standalone too", () => {
        const standalone = {
            id: "solo",
            name: "Solo",
            enabled: true,
            ruleset_id: null,
            filter: "~u price",
            phase: "response",
            actions: [],
            decision: "execute",
        };
        expect(isStandalone(standalone)).toBe(true);
        expect(owningRuleSetId(standalone)).toBeNull();
    });

    it("treats a rule carrying a set id as a member", () => {
        const member = {
            id: "a",
            name: "A",
            enabled: true,
            ruleset_id: "set-1",
            filter: "~u api",
            phase: "request",
            actions: [],
            decision: "execute",
        };
        expect(isStandalone(member)).toBe(false);
        expect(owningRuleSetId(member)).toBe("set-1");
    });

    it("reads the real GET /rewrite/rules shape without a key on standalone rules", async () => {
        const solo = {
            id: "solo",
            name: "Solo",
            enabled: true,
            filter: "~u price",
            phase: "response",
            actions: [],
            decision: "execute",
        };
        const member = {
            id: "a",
            name: "A",
            enabled: true,
            ruleset_id: "set-1",
            filter: "~u api",
            phase: "request",
            actions: [],
            decision: "execute",
        };
        mocked.mockResolvedValueOnce(
            okJson({ rules: [solo, member], rulesets: [] }),
        );
        const store = TStore();
        const { rules } = await store.dispatch(fetchRules()).unwrap();

        expect(rules.filter(isStandalone).map((rule) => rule.id)).toEqual(["solo"]);
        expect(rules.filter((rule) => !isStandalone(rule)).map((rule) => rule.id)).toEqual(["a"]);
    });
});
