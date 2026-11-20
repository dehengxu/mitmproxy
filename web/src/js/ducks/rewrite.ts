import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { Flow } from "../flow";
import { canResumeOrKill } from "../flow/utils";
import { fetchApi } from "../utils";
import { createAppAsyncThunk } from "./hooks";
import type { AppThunk } from "./store";
import * as flowActions from "./flows";

/**
 * REQ-6.1: breakpoints with three manually decided outcomes.
 *
 * A flow that hits a breakpoint rule is suspended until a person decides what
 * happens to it. The three outcomes must stay distinct:
 *
 *   execute - apply the edits made to the flow, then let it through.
 *   abort   - kill the flow, nothing is forwarded to the client.
 *   cancel  - cancel the breakpoint itself, drop any edits, let the flow through
 *             untouched. The rule that suspended the flow stays enabled.
 *
 * Every backend call of this feature lives in this module, so the paths below
 * only ever have to change in one place.
 */

export type Decision = "execute" | "abort" | "cancel";

export interface PendingDecision {
    token: string;
    flow_id: string;
    rule_id: string;
    rule_name: string;
    phase: string;
    host: string;
    path: string;
    method: string;
    created_at: string | number;
}

export interface RewriteRule {
    id: string;
    name: string;
    enabled: boolean;
    filter: string;
    phase: string;
    actions: unknown;
    decision: string;
}

export const ENDPOINTS = {
    pending: "/rewrite/pending",
    decide: "/rewrite/pending/decide",
    rules: "/rewrite/rules",
    ruleEnable: "/rewrite/rules/enable",
    ruleDelete: "/rewrite/rules/delete",
} as const;

export const DECISION_LABELS: Record<Decision, string> = {
    execute: "Execute",
    abort: "Abort",
    cancel: "Cancel",
};

export const DECISION_TITLES: Record<Decision, string> = {
    execute: "Apply the edits to this flow and let it through",
    abort: "Kill this flow, nothing is forwarded to the client",
    cancel:
        "Cancel the breakpoint: drop the edits and let the flow through untouched; the rule stays enabled",
};

/** Shown after a cancel, so that a still-active rule is not a surprise. */
export interface Notice {
    kind: "info" | "error";
    message: string;
    /** Set when exactly one rule is involved, enabling the one-click disable. */
    ruleId?: string;
    ruleName?: string;
}

export interface RewriteState {
    pending: PendingDecision[];
    rules: RewriteRule[];
    error: string | undefined;
    notice: Notice | null;
}

export const defaultState: RewriteState = {
    pending: [],
    rules: [],
    error: undefined,
    notice: null,
};

/**
 * The message of a rejected thunk. createAsyncThunk hands back a plain
 * `{name, message, stack}` object rather than an Error, so `instanceof Error`
 * alone would lose the backend's own words.
 */
export function errorMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object" && "message" in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string" && message) return message;
    }
    return String(error);
}

async function readJson(response: Response) {
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    return response.json();
}

export const fetchPending = createAppAsyncThunk(
    "rewrite/fetchPending",
    async () => {
        const data = await readJson(await fetchApi(ENDPOINTS.pending));
        return (data?.pending ?? []) as PendingDecision[];
    },
);

/** What the backend answers to a decision; see the frozen contract. */
export interface DecideResponse {
    success?: boolean;
    error?: string;
}

export const decidePending = createAppAsyncThunk(
    "rewrite/decidePending",
    async ({
        token,
        decision,
    }: {
        token: string;
        decision: Decision;
    }) => {
        const data = (await readJson(
            await fetchApi.post(ENDPOINTS.decide, { token, decision }),
        )) as DecideResponse | undefined;

        // HTTP 200 is not enough: the flow may have settled in the meantime
        // (client gone, proxy stopped), and the backend then answers
        // {"success": false, "error": "..."}. Dropping the row in that case
        // would hide a request that is still held, so it is a failure here.
        if (data && data.success === false) {
            throw new Error(
                data.error || "The decision could not be applied.",
            );
        }
        return token;
    },
);

export const fetchRules = createAppAsyncThunk(
    "rewrite/fetchRules",
    async () => {
        const data = await readJson(await fetchApi(ENDPOINTS.rules));
        return (data?.rules ?? []) as RewriteRule[];
    },
);

export const saveRule = createAppAsyncThunk(
    "rewrite/saveRule",
    async (rule: RewriteRule) => {
        await readJson(await fetchApi.post(ENDPOINTS.rules, rule));
        return rule;
    },
);

export const setRuleEnabled = createAppAsyncThunk(
    "rewrite/setRuleEnabled",
    async ({ id, enabled }: { id: string; enabled: boolean }) => {
        await readJson(
            await fetchApi.post(ENDPOINTS.ruleEnable, { id, enabled }),
        );
        return { id, enabled };
    },
);

export const deleteRule = createAppAsyncThunk(
    "rewrite/deleteRule",
    async (id: string) => {
        await readJson(await fetchApi.post(ENDPOINTS.ruleDelete, { id }));
        return id;
    },
);

const rewriteSlice = createSlice({
    name: "rewrite",
    initialState: defaultState,
    reducers: {
        showNotice(state, action: PayloadAction<Notice>) {
            state.notice = action.payload;
        },
        dismissNotice(state) {
            state.notice = null;
        },
        setPending(state, action: PayloadAction<PendingDecision[]>) {
            state.pending = action.payload;
        },
        removePending(state, action: PayloadAction<string>) {
            state.pending = state.pending.filter(
                (entry) => entry.token !== action.payload,
            );
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchPending.fulfilled, (state, action) => {
                state.pending = action.payload;
                state.error = undefined;
            })
            .addCase(fetchPending.rejected, (state, action) => {
                state.error =
                    action.error.message ?? "Could not load pending decisions";
            })
            .addCase(decidePending.fulfilled, (state, action) => {
                state.pending = state.pending.filter(
                    (entry) => entry.token !== action.payload,
                );
            })
            .addCase(fetchRules.fulfilled, (state, action) => {
                state.rules = action.payload;
            })
            .addCase(saveRule.fulfilled, (state, action) => {
                const index = state.rules.findIndex(
                    (rule) => rule.id === action.payload.id,
                );
                if (index >= 0) {
                    state.rules[index] = action.payload;
                } else {
                    state.rules.push(action.payload);
                }
            })
            .addCase(setRuleEnabled.fulfilled, (state, action) => {
                const rule = state.rules.find(
                    (entry) => entry.id === action.payload.id,
                );
                if (rule) {
                    rule.enabled = action.payload.enabled;
                }
                if (
                    state.notice?.ruleId === action.payload.id &&
                    !action.payload.enabled
                ) {
                    state.notice = null;
                }
            });
    },
});

export const { showNotice, dismissNotice, setPending, removePending } =
    rewriteSlice.actions;

/**
 * The three-state decision for flows selected in the flow table or detail view.
 *
 * Flows that belong to a breakpoint carry a pending token and are decided on the
 * backend, which is the only side that can drop the edits. Plain
 * mitmproxy-intercepted flows have no token, so Cancel there is
 * revert-then-resume: that is what "drop the edits and pass the flow through"
 * means when no rewriting rule is behind the interception.
 */
export function decideFlows(decision: Decision, flows: Flow[]): AppThunk {
    return async (dispatch, getState) => {
        const targets = flows.filter(canResumeOrKill);
        if (targets.length === 0) return;

        // The table's quick actions can be the first thing someone clicks, so
        // the queue may not have been read yet -- and a queue read earlier can
        // be stale (another window decided, a flow settled). Either way a held
        // flow would have no token and would be settled the plain way, which
        // bypasses the rule engine entirely. Refresh whenever a target is
        // missing from what we have.
        const known = new Set(getState().rewrite.pending.map((e) => e.flow_id));
        if (targets.some((flow) => !known.has(flow.id))) {
            await dispatch(fetchPending())
                .unwrap()
                .catch(() => undefined);
        }

        const pendingByFlowId = new Map(
            getState().rewrite.pending.map((entry) => [entry.flow_id, entry]),
        );
        const withToken = targets.filter((flow) =>
            pendingByFlowId.has(flow.id),
        );
        const withoutToken = targets.filter(
            (flow) => !pendingByFlowId.has(flow.id),
        );

        // A decision the backend rejects (HTTP 200 with success:false, see
        // decidePending) leaves the flow held. Surface that instead of moving on
        // as if it had settled.
        const failures: string[] = [];
        if (withToken.length > 0) {
            await Promise.all(
                withToken.map((flow) =>
                    dispatch(
                        decidePending({
                            token: pendingByFlowId.get(flow.id)!.token,
                            decision,
                        }),
                    )
                        .unwrap()
                        .catch((e: unknown) => {
                            failures.push(errorMessage(e));
                        }),
                ),
            );
        }

        if (decision === "execute" && withoutToken.length > 0) {
            await dispatch(flowActions.resume(withoutToken));
        } else if (decision === "abort" && withoutToken.length > 0) {
            await dispatch(flowActions.kill(withoutToken));
        } else if (decision === "cancel" && withoutToken.length > 0) {
            const edited = withoutToken.filter((flow) => flow.modified);
            if (edited.length > 0) {
                await dispatch(flowActions.revert(edited));
            }
            await dispatch(flowActions.resume(withoutToken));
        }

        if (failures.length > 0) {
            dispatch(
                showNotice({
                    kind: "error",
                    message:
                        failures.length === 1
                            ? `The decision was not applied: ${failures[0]} The request is still waiting.`
                            : `${failures.length} requests could not be decided: ${failures[0]} They are still waiting.`,
                }),
            );
            return;
        }

        if (decision !== "cancel") return;

        const rules = new Map<string, string>();
        withToken.forEach((flow) => {
            const entry = pendingByFlowId.get(flow.id)!;
            rules.set(entry.rule_id, entry.rule_name);
        });
        const names = [...rules.values()];

        if (names.length === 1) {
            dispatch(
                showNotice({
                    kind: "info",
                    message: `Breakpoint cancelled: edits dropped, flow passed through. Rule "${names[0]}" is still enabled.`,
                    ruleId: [...rules.keys()][0],
                    ruleName: names[0],
                }),
            );
        } else if (names.length > 1) {
            dispatch(
                showNotice({
                    kind: "info",
                    message: `Breakpoint cancelled: edits dropped, flow passed through. ${names.length} rules are still enabled.`,
                }),
            );
        } else {
            dispatch(
                showNotice({
                    kind: "info",
                    message:
                        "Interception cancelled: edits dropped, flow passed through.",
                }),
            );
        }
    };
}

/**
 * Decides one entry of the pending queue. Cancel always leaves the rule on, and
 * says so, because that is the behaviour the PM picked: a breakpoint that keeps
 * firing is a decision to make explicitly, not a side effect of cancelling.
 */
export function decidePendingEntry(
    entry: PendingDecision,
    decision: Decision,
): AppThunk {
    return async (dispatch) => {
        await dispatch(
            decidePending({ token: entry.token, decision }),
        ).unwrap();
        if (decision === "cancel") {
            dispatch(
                showNotice({
                    kind: "info",
                    message: `Breakpoint cancelled: edits dropped, flow passed through. Rule "${entry.rule_name}" is still enabled.`,
                    ruleId: entry.rule_id,
                    ruleName: entry.rule_name,
                }),
            );
        }
    };
}

/** Disables the rule named by the current notice, a one-click follow-up to a cancel. */
export function disableNoticeRule(): AppThunk<Promise<void>> {
    return async (dispatch, getState) => {
        const ruleId = getState().rewrite.notice?.ruleId;
        if (!ruleId) return;
        await dispatch(setRuleEnabled({ id: ruleId, enabled: false })).unwrap();
    };
}

export default rewriteSlice.reducer;
