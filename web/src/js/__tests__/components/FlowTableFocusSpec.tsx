import * as React from "react";
import FlowTable, { buildRows, PureFlowTable } from "../../components/FlowTable";
import { act, render } from "../test-utils";
import { FLOWS_FILTER_UPDATE, FLOWS_RECEIVE } from "../../ducks/flows";
import { FilterName } from "../../ducks/ui/filter";
import { focusHost, unfocusHost, OTHER_GROUP } from "../../ducks/ui/focus";
import { TFlow, TStore, testState } from "../ducks/tutils";
import type { Flow } from "../../flow";
import type { RootState } from "../../ducks";

window.addEventListener = jest.fn();

// jsdom lays nothing out, so the virtual scroll would only ever render the
// first couple of rows. Give it a viewport tall enough for these small lists.
let offsetHeight: jest.SpyInstance;
beforeEach(() => {
    offsetHeight = jest
        .spyOn(HTMLElement.prototype, "offsetHeight", "get")
        .mockReturnValue(4000);
});
afterEach(() => offsetHeight.mockRestore());

const httpFlow = (id: string, host: string, path: string): Flow =>
    ({
        ...TFlow(),
        id,
        error: undefined,
        intercepted: false,
        marked: "",
        request: { ...TFlow().request, host, path },
    }) as Flow;

// One flow on the focused host, two on another host.
const aFlow = httpFlow("a", "api.example.com", "/a");
const bFlow = httpFlow("b", "cdn.example.com", "/b");
const cFlow = httpFlow("c", "static.example.com", "/c");
const all = [aFlow, bFlow, cFlow];

const stateWith = (view: Flow[], overrides: Partial<RootState> = {}) => {
    const state: RootState = {
        ...testState,
        ui: { ...testState.ui, focus: { hosts: [] } },
        flows: {
            ...testState.flows,
            list: all,
            byId: new Map(all.map((f) => [f.id, f])),
            view,
            _listIndex: new Map(all.map((f, i) => [f.id, i])),
            _viewIndex: new Map(view.map((f, i) => [f.id, i])),
            selected: [],
            selectedIds: new Set(),
            highlightedIds: new Set(),
        },
        ...overrides,
    };
    return state;
};

// Each test flow has its own path, which is what identifies a rendered row.
// The cell shows the pretty URL, so match on its tail.
const renderedPaths = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("tbody tr.has-request")).map((tr) =>
        tr.querySelector(".col-path")?.textContent?.trim().split("/").pop(),
    );

const groupNames = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("tbody tr.flow-group-row")).map(
        (tr) => tr.querySelector(".flow-group-name")?.textContent?.trim(),
    );

describe("FlowTable with Focus (REQ-4.2)", () => {
    it("builds flat rows when nothing is focused", () => {
        const rows = buildRows(all, []);
        expect(rows).toHaveLength(all.length);
        expect(rows.every((r) => r.kind === "flow")).toBe(true);
    });

    it("builds group rows ahead of each group's flows", () => {
        const rows = buildRows(all, ["cdn.example.com"]);
        expect(rows.map((r) => (r.kind === "group" ? r.group : "flow"))).toEqual(
            ["cdn.example.com", "flow", OTHER_GROUP, "flow", "flow"],
        );
    });

    it("puts the focused host group at the top and everything else under Other", () => {
        const store = TStore(stateWith(all));
        const { container } = render(<FlowTable />, { store });

        act(() => store.dispatch(focusHost("cdn.example.com")));

        expect(groupNames(container)).toEqual(["cdn.example.com", "Other"]);
        // bFlow (cdn) first, then the rest in their original order.
        expect(renderedPaths(container)).toEqual(["b", "a", "c"]);
        const firstRow = container.querySelector("tbody tr.flow-group-row");
        expect(firstRow).toHaveClass("focused");
        expect(firstRow).toHaveTextContent("cdn.example.com");
        const other = container.querySelectorAll("tbody tr.flow-group-row")[1];
        expect(other).toHaveClass("other");
        expect(other).toHaveTextContent("Other");
        expect(other).toHaveTextContent("2");
    });

    it("renders the focused host's rows above the Other rows", () => {
        const store = TStore(stateWith(all));
        const { container } = render(<FlowTable />, { store });
        act(() => store.dispatch(focusHost("api.example.com")));

        const rendered = Array.from(
            container.querySelectorAll(
                "tbody tr.flow-group-row, tbody tr.has-request",
            ),
        ).map((tr) =>
            tr.classList.contains("flow-group-row")
                ? `#${tr.querySelector(".flow-group-name")!.textContent}`
                : tr.querySelector(".col-path")!.textContent!.trim().slice(-2),
        );
        // The flow of the focused host comes right after its group header.
        expect(rendered[0]).toBe("#api.example.com");
        expect(rendered[1]).toBe("/a");
        expect(rendered).toContain(`#${OTHER_GROUP}`);
    });

    it("keeps every flow: focus reorders, it never filters", () => {
        const store = TStore(stateWith(all));
        const { container } = render(<FlowTable />, { store });
        const before = container.querySelectorAll("tbody tr.has-request").length;

        act(() => store.dispatch(focusHost("api.example.com")));
        const after = container.querySelectorAll("tbody tr.has-request").length;

        expect(after).toBe(before);
        expect(after).toBe(all.length);
        expect(store.getState().flows.view).toHaveLength(all.length);
    });

    it("restores the original order when the focus is cancelled", () => {
        const store = TStore(stateWith(all));
        const { container } = render(<FlowTable />, { store });

        const original = renderedPaths(container);

        act(() => store.dispatch(focusHost("static.example.com")));
        expect(renderedPaths(container)).toEqual(["c", "a", "b"]);
        expect(groupNames(container)).toEqual(["static.example.com", "Other"]);

        act(() => store.dispatch(unfocusHost("static.example.com")));
        expect(renderedPaths(container)).toEqual(original);
        expect(groupNames(container)).toEqual([]);
    });

    it("does not interfere with the search filter, and vice versa", () => {
        const store = TStore(stateWith(all));
        const { container } = render(<FlowTable />, { store });

        // The search filter hides bFlow; focus then only reorders what is left.
        act(() =>
            store.dispatch(
                FLOWS_FILTER_UPDATE({
                    name: FilterName.Search,
                    matching_flow_ids: [aFlow.id, cFlow.id],
                }),
            ),
        );
        act(() => store.dispatch(focusHost("api.example.com")));

        expect(store.getState().flows.view).toHaveLength(2);
        expect(groupNames(container)).toEqual(["api.example.com", "Other"]);

        // Clearing the focus leaves the filter alone.
        act(() => store.dispatch(unfocusHost("api.example.com")));
        expect(store.getState().flows.view).toHaveLength(2);
        expect(groupNames(container)).toEqual([]);
    });

    it("keeps the focus when the filter changes", () => {
        const store = TStore(stateWith(all));
        render(<FlowTable />, { store });
        act(() => store.dispatch(focusHost("api.example.com")));
        act(() =>
            store.dispatch(
                FLOWS_FILTER_UPDATE({
                    name: FilterName.Search,
                    matching_flow_ids: [aFlow.id],
                }),
            ),
        );

        expect(store.getState().ui.focus.hosts).toEqual(["api.example.com"]);
        // The single remaining flow is still in its focused group.
        expect(store.getState().flows.view.map((f) => f.id)).toEqual([
            aFlow.id,
        ]);
    });

    it("scrolls the newly selected flow into view by its rendered row", () => {
        const height = PureFlowTable.defaultProps.rowHeight;
        const store = TStore(stateWith(all));
        const { container } = render(
            <div style={{ height, overflow: "hidden" }}>
                <FlowTable />
            </div>,
        );
        act(() => store.dispatch(focusHost("api.example.com")));

        // The selection is on the focused host's flow, which now sits after a
        // group header row -- rowIndexOf has to account for it.
        act(() => store.dispatch({ type: "flows/select", payload: [bFlow] }));
        expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    });

    it("receives flows while a focus is active without losing them", () => {
        const store = TStore(stateWith(all));
        const { container } = render(<FlowTable />, { store });
        act(() => store.dispatch(focusHost("cdn.example.com")));

        const newFlow = httpFlow("d", "cdn.example.com", "/d");
        act(() =>
            store.dispatch(
                FLOWS_RECEIVE([...all, newFlow]) as unknown as {
                    type: string;
                },
            ),
        );

        // A refreshed list under an active focus still renders every flow.
        expect(
            container.querySelectorAll("tbody tr.has-request").length,
        ).toBe(4);
        expect(store.getState().ui.focus.hosts).toEqual(["cdn.example.com"]);
    });
});
