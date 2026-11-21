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

/**
 * One action of a rule.
 *
 * The field names are the backend's own (`mark` carries `marker`, `comment`
 * carries `comment`, `tag` carries `tags`), so a form built from these names
 * sends a body the engine accepts without translation.
 */
export interface RuleAction {
    type: string;
    target?: "request" | "response" | null;
    name?: string | null;
    value?: string | null;
    content?: string | null;
    encoding?: "text" | "base64";
    pattern?: string | null;
    replacement?: string | null;
    status_code?: number | null;
    reason?: string | null;
    path?: string | null;
    method?: string | null;
    url?: string | null;
    seconds?: number | null;
    marker?: string | null;
    comment?: string | null;
    tags?: string[] | null;
}

export interface RewriteRule {
    id: string;
    name: string;
    enabled: boolean;
    /** Owning rule set, or null for a standalone rule. */
    ruleset_id?: string | null;
    filter: string;
    phase: string;
    actions: RuleAction[];
    decision: string;
}

/**
 * A named, orderable group of rules with one master switch.
 *
 * `rules` is in evaluation order inside the set: the first rule to claim a
 * (target, field) is the one that applies.
 */
export interface RewriteRuleSet {
    id: string;
    name: string;
    enabled: boolean;
    rules: RewriteRule[];
}

/** One entry of the hit preview for a chosen field. */
export interface PreviewEntry {
    rule_id: string;
    rule_name: string;
    ruleset_id?: string | null;
    effective: boolean;
    /** The rule that claimed the field first, when this one is skipped. */
    skipped_by?: string | null;
}

export const ENDPOINTS = {
    pending: "/rewrite/pending",
    decide: "/rewrite/pending/decide",
    rules: "/rewrite/rules",
    ruleEnable: "/rewrite/rules/enable",
    ruleDelete: "/rewrite/rules/delete",
    // REQ-6.2 -- rule sets and the hit preview.
    rulePreview: "/rewrite/rules/preview",
    ruleSets: "/rewrite/rulesets",
    ruleSetEnable: "/rewrite/rulesets/enable",
    ruleSetDelete: "/rewrite/rulesets/delete",
    ruleSetAddRule: "/rewrite/rulesets/rules",
    ruleSetRemoveRule: "/rewrite/rulesets/rules/remove",
    ruleSetReorder: "/rewrite/rulesets/reorder",
    ruleSetMove: "/rewrite/rulesets/move",
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
    /** Every rule in evaluation order, standalone and set members alike. */
    rules: RewriteRule[];
    rulesets: RewriteRuleSet[];
    error: string | undefined;
    notice: Notice | null;
}

export const defaultState: RewriteState = {
    pending: [],
    rules: [],
    rulesets: [],
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
        // A refused call carries {"success": false, "error": "..."}: those
        // words say what was wrong (a missing rule, a reorder that dropped one),
        // where "HTTP 400 Bad Request" does not. Fall back to the status line
        // when the body is not JSON.
        let detail: string | undefined;
        try {
            if (typeof response.json === "function") {
                const body = await response.json();
                if (body && typeof body.error === "string" && body.error) {
                    detail = body.error;
                }
            }
        } catch {
            // not JSON -- the status line is all there is
        }
        throw new Error(
            detail ?? `HTTP ${response.status} ${response.statusText}`.trim(),
        );
    }
    return response.json();
}

/**
 * A mutation call. HTTP 200 is not proof of success: the backend answers
 * {"success": false, "error": "..."} in-band when it could not do the thing
 * (see the frozen contract), so that case is an error here and the caller keeps
 * whatever it was showing instead of hiding a row that still exists.
 */
async function postAction(url: string, body: unknown) {
    const data = await readJson(await fetchApi.post(url, body));
    if (data && data.success === false) {
        throw new Error(
            (data as { error?: string }).error || "The change was not applied.",
        );
    }
    return data;
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

/**
 * Reads every rule and every rule set in one call.
 *
 * The rules come back in evaluation order (standalone rules in insertion order,
 * then each enabled set in the order it was added, rules inside a set in list
 * order), which is the only way the UI can say which rule wins.
 */
export const fetchRules = createAppAsyncThunk(
    "rewrite/fetchRules",
    async () => {
        const data = await readJson(await fetchApi(ENDPOINTS.rules));
        return {
            rules: (data?.rules ?? []) as RewriteRule[],
            rulesets: (data?.rulesets ?? []) as RewriteRuleSet[],
        };
    },
);

/**
 * Creates or updates one rule; the backend decides which by the presence of a
 * known id. Editing never moves a rule between sets -- membership changes only
 * through the rule-set commands below.
 */
export const saveRule = createAppAsyncThunk(
    "rewrite/saveRule",
    async (rule: RewriteRule) => {
        const data = await postAction(ENDPOINTS.rules, rule);
        return (data?.rule ?? rule) as RewriteRule;
    },
);

export const setRuleEnabled = createAppAsyncThunk(
    "rewrite/setRuleEnabled",
    async ({ id, enabled }: { id: string; enabled: boolean }) => {
        const data = await postAction(ENDPOINTS.ruleEnable, { id, enabled });
        return (data?.rule ?? { id, enabled }) as RewriteRule;
    },
);

export const deleteRule = createAppAsyncThunk(
    "rewrite/deleteRule",
    async (id: string) => {
        await postAction(ENDPOINTS.ruleDelete, { id });
        return id;
    },
);

/** Creates or renames a rule set; the set keeps its place in the order. */
export const saveRuleSet = createAppAsyncThunk(
    "rewrite/saveRuleSet",
    async (ruleset: { id: string; name: string; enabled?: boolean }) => {
        const data = await postAction(ENDPOINTS.ruleSets, ruleset);
        return data.ruleset as RewriteRuleSet;
    },
);

/** Deletes a set and the rules inside it. */
export const deleteRuleSet = createAppAsyncThunk(
    "rewrite/deleteRuleSet",
    async (id: string) => {
        await postAction(ENDPOINTS.ruleSetDelete, { id });
        return id;
    },
);

export const setRuleSetEnabled = createAppAsyncThunk(
    "rewrite/setRuleSetEnabled",
    async ({ id, enabled }: { id: string; enabled: boolean }) => {
        const data = await postAction(ENDPOINTS.ruleSetEnable, { id, enabled });
        return (data?.ruleset ?? { id, enabled }) as RewriteRuleSet;
    },
);

/** Moves an existing rule into a set; without `index` it is appended. */
export const addRuleToSet = createAppAsyncThunk(
    "rewrite/addRuleToSet",
    async ({
        rulesetId,
        ruleId,
        index,
    }: {
        rulesetId: string;
        ruleId: string;
        index?: number;
    }) => {
        const data = await postAction(ENDPOINTS.ruleSetAddRule, {
            ruleset_id: rulesetId,
            rule_id: ruleId,
            ...(index === undefined ? {} : { index }),
        });
        return data.ruleset as RewriteRuleSet;
    },
);

/** Moves a rule out of its set, back to the standalone rules. */
export const removeRuleFromSet = createAppAsyncThunk(
    "rewrite/removeRuleFromSet",
    async ({ rulesetId, ruleId }: { rulesetId: string; ruleId: string }) => {
        await postAction(ENDPOINTS.ruleSetRemoveRule, {
            ruleset_id: rulesetId,
            rule_id: ruleId,
        });
        return { rulesetId, ruleId };
    },
);

/**
 * Sets the order of the rules inside one set. `ruleIds` must list every rule of
 * the set exactly once; the backend refuses anything else, and that refusal is
 * shown rather than guessed around.
 */
export const reorderRuleSet = createAppAsyncThunk(
    "rewrite/reorderRuleSet",
    async ({ id, ruleIds }: { id: string; ruleIds: string[] }) => {
        const data = await postAction(ENDPOINTS.ruleSetReorder, {
            id,
            rule_ids: ruleIds,
        });
        return data.ruleset as RewriteRuleSet;
    },
);

/** Moves a whole set to a new place in the evaluation order. */
export const moveRuleSet = createAppAsyncThunk(
    "rewrite/moveRuleSet",
    async ({ id, index }: { id: string; index: number }) => {
        const data = await postAction(ENDPOINTS.ruleSetMove, { id, index });
        return data.ruleset as RewriteRuleSet;
    },
);

/** Reads which rule wins a chosen field, and which are skipped behind it. */
export const fetchRulePreview = createAppAsyncThunk(
    "rewrite/fetchRulePreview",
    async ({
        target,
        field,
        name,
    }: {
        target: string;
        field: string;
        name?: string;
    }) => {
        const params = new URLSearchParams({ target, field });
        if (name) params.set("name", name);
        const data = await readJson(
            await fetchApi(`${ENDPOINTS.rulePreview}?${params.toString()}`),
        );
        return (data?.rules ?? []) as PreviewEntry[];
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
                state.rules = action.payload.rules;
                state.rulesets = action.payload.rulesets;
                state.error = undefined;
            })
            .addCase(fetchRules.rejected, (state, action) => {
                state.error =
                    action.error.message ?? "Could not load the rewrite rules";
            })
            .addCase(saveRule.fulfilled, (state, action) => {
                const saved = action.payload;
                const index = state.rules.findIndex(
                    (rule) => rule.id === saved.id,
                );
                if (index >= 0) {
                    state.rules[index] = saved;
                } else {
                    state.rules.push(saved);
                }
                // The same rule is shown again inside its set; keep that copy
                // in step so the two lists cannot disagree.
                for (const ruleset of state.rulesets) {
                    const member = ruleset.rules.findIndex(
                        (entry) => entry.id === saved.id,
                    );
                    if (member >= 0) ruleset.rules[member] = saved;
                }
            })
            .addCase(setRuleEnabled.fulfilled, (state, action) => {
                const { id, enabled } = action.payload;
                const rule = state.rules.find((entry) => entry.id === id);
                if (rule) {
                    rule.enabled = enabled;
                }
                // A rule inside a set has two copies on screen, so keep both
                // in step rather than leaving the set's row stale.
                for (const ruleset of state.rulesets) {
                    const member = ruleset.rules.find((entry) => entry.id === id);
                    if (member) member.enabled = enabled;
                }
                if (state.notice?.ruleId === id && !enabled) {
                    state.notice = null;
                }
            })
            .addCase(setRuleSetEnabled.fulfilled, (state, action) => {
                const { id, enabled } = action.payload;
                const ruleset = state.rulesets.find((entry) => entry.id === id);
                if (ruleset) ruleset.enabled = enabled;
            })
            // Every rule-set mutation answers with the set it changed. The
            // modal re-reads the full list afterwards (order across sets comes
            // from the backend), so these only have to keep the store sane if
            // that re-read fails.
            .addMatcher(
                (action) =>
                    action.type === saveRuleSet.fulfilled.type ||
                    action.type === setRuleSetEnabled.fulfilled.type ||
                    action.type === addRuleToSet.fulfilled.type ||
                    action.type === reorderRuleSet.fulfilled.type ||
                    action.type === moveRuleSet.fulfilled.type,
                (state, action) => {
                    const incoming = (action as PayloadAction<RewriteRuleSet>)
                        .payload;
                    if (!incoming || !incoming.id) return;
                    const index = state.rulesets.findIndex(
                        (entry) => entry.id === incoming.id,
                    );
                    // A partial answer (a set with only its switch flipped)
                    // must not wipe the rules the set is known to hold.
                    const merged: RewriteRuleSet = {
                        ...(index >= 0 ? state.rulesets[index] : incoming),
                        ...incoming,
                        rules:
                            incoming.rules ??
                            (index >= 0 ? state.rulesets[index].rules : []),
                    };
                    if (index >= 0) {
                        state.rulesets[index] = merged;
                    } else {
                        state.rulesets.push(merged);
                    }
                },
            );
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
