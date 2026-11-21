import type { PayloadAction } from "@reduxjs/toolkit";
import { createSlice } from "@reduxjs/toolkit";
import type { Flow } from "../../flow";

/**
 * Focus (REQ-4.2) is a *view reordering* semantic, not a filter: no flow is
 * hidden or dropped, only the order and the grouping of the rendered list
 * change. Filtering ("hide what does not match") stays in ./filter.ts and in
 * the flows duck; the two never share state.
 */

/** Name of the group that collects every flow whose host is not focused. */
export const OTHER_GROUP = "Other";

/**
 * Canonical form used for both storing and matching a host: strip surrounding
 * whitespace, then lower-case. Matches the MCP side (`normalize_host` in
 * mitmproxy_mcp/core/focus.py) -- no scheme/port handling, no wildcards.
 */
export function normalizeHost(host: string | undefined | null): string {
    return (host ?? "").trim().toLowerCase();
}

/**
 * Bare host of a flow, normalised. Only HTTP flows carry a host; TCP/UDP/DNS
 * flows have none and therefore always land in the Other group, which is what
 * the MCP side's `flow_host` does too.
 */
export function flowHost(flow: Flow | undefined): string {
    if (!flow || flow.type !== "http") {
        return "";
    }
    return normalizeHost(flow.request?.host);
}

export interface FocusState {
    /** Focused hosts, in the order they were focused. */
    hosts: string[];
}

export const initialState: FocusState = { hosts: [] };

const focusSlice = createSlice({
    name: "ui/focus",
    initialState,
    reducers: {
        focusHost(state, action: PayloadAction<string>) {
            const host = normalizeHost(action.payload);
            if (!host || host === OTHER_GROUP.toLowerCase()) {
                return;
            }
            if (!state.hosts.includes(host)) {
                state.hosts.push(host);
            }
        },
        unfocusHost(state, action: PayloadAction<string>) {
            const host = normalizeHost(action.payload);
            state.hosts = state.hosts.filter((h) => h !== host);
        },
        clearFocus(state) {
            state.hosts = [];
        },
        /** Toggle one host, which is what clicking the Focus control does. */
        toggleFocus(state, action: PayloadAction<string>) {
            const host = normalizeHost(action.payload);
            if (!host || host === OTHER_GROUP.toLowerCase()) {
                return;
            }
            state.hosts = state.hosts.includes(host)
                ? state.hosts.filter((h) => h !== host)
                : [...state.hosts, host];
        },
    },
});

const { actions, reducer } = focusSlice;
export const { focusHost, unfocusHost, clearFocus, toggleFocus } = actions;
export default reducer;

export interface FlowGroup {
    /** Host of the group, or OTHER_GROUP for everything else. */
    group: string;
    focused: boolean;
    flows: Flow[];
}

/**
 * Reorder flows into focus groups; never drops an entry.
 *
 * Groups come out in focus order, with Other last. A focused host that matches
 * no flow is omitted, so the groups hold exactly the flows that came in, each
 * keeping its relative order inside its group -- this mirrors `group_by_focus`
 * on the MCP side.
 */
export function groupByFocus(flows: Flow[], hosts: string[]): FlowGroup[] {
    const focused = hosts.map(normalizeHost).filter(Boolean);
    const buckets = new Map<string, Flow[]>(focused.map((h) => [h, []]));
    const others: Flow[] = [];

    for (const flow of flows) {
        const host = flowHost(flow);
        const bucket = host ? buckets.get(host) : undefined;
        if (bucket) {
            bucket.push(flow);
        } else {
            others.push(flow);
        }
    }

    const groups: FlowGroup[] = focused
        .filter((host, i) => focused.indexOf(host) === i)
        .map((host) => ({
            group: host,
            focused: true,
            flows: buckets.get(host)!,
        }))
        .filter((g) => g.flows.length > 0);
    if (others.length > 0) {
        groups.push({ group: OTHER_GROUP, focused: false, flows: others });
    }
    return groups;
}

/** Flat display order produced by the grouping above. */
export function orderedView(flows: Flow[], hosts: string[]): Flow[] {
    if (hosts.length === 0) {
        return flows;
    }
    return groupByFocus(flows, hosts).flatMap((g) => g.flows);
}
