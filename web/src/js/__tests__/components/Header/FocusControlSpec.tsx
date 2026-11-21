import * as React from "react";
import { act, fireEvent, render } from "../../test-utils";
import FocusControl from "../../../components/Header/FocusControl";
import {
    focusHost,
    OTHER_GROUP,
} from "../../../ducks/ui/focus";
import { select } from "../../../ducks/flows";
import { TFlow, TStore, testState } from "../../ducks/tutils";
import type { Flow } from "../../../flow";

const httpFlow = (id: string, host: string): Flow =>
    ({ ...TFlow(), id, request: { ...TFlow().request, host } }) as Flow;

const tflow = httpFlow("flow2", "api.example.com");

const storeWith = (hosts: string[] = []) =>
    TStore({
        ...testState,
        ui: { ...testState.ui, focus: { hosts } },
    });

const storeWithoutSelection = (hosts: string[] = []) =>
    TStore({
        ...testState,
        ui: { ...testState.ui, focus: { hosts } },
        flows: { ...testState.flows, selected: [], selectedIds: new Set() },
    });

describe("FocusControl", () => {
    it("is disabled until a flow with a host is selected", () => {
        const { getByRole, store } = render(<FocusControl />, {
            store: storeWithoutSelection(),
        });
        const button = getByRole("button", { name: /^focus/i });
        expect(button).toBeDisabled();

        act(() => store.dispatch(select([tflow])));
        expect(button).not.toBeDisabled();
    });

    it("focuses the host of the selected flow", () => {
        const store = storeWith();
        const { getByRole } = render(<FocusControl />, { store });
        act(() => store.dispatch(select([tflow])));

        act(() => {
            fireEvent.click(getByRole("button", { name: /focus/i }));
        });

        expect(store.getState().ui.focus.hosts).toEqual(["api.example.com"]);
        // It is a toggle: the same control now reads Unfocus.
        expect(getByRole("button", { name: /unfocus/i })).toBeInTheDocument();
    });

    it("shows a cancellable chip per focused host", () => {
        const store = storeWith(["api.example.com", "cdn.example.com"]);
        const { container, getByRole } = render(<FocusControl />, { store });

        const chips = container.querySelectorAll(".focus-chip");
        expect(chips).toHaveLength(2);
        expect(chips[0]).toHaveTextContent("api.example.com");

        act(() => {
            fireEvent.click(
                getByRole("button", { name: "Cancel focus on cdn.example.com" }),
            );
        });
        expect(store.getState().ui.focus.hosts).toEqual(["api.example.com"]);
    });

    it("cancels the focus by clicking the chip of the focused host", () => {
        const store = storeWith(["api.example.com"]);
        const { getByRole } = render(<FocusControl />, { store });
        act(() => store.dispatch(select([tflow])));

        act(() => {
            fireEvent.click(
                getByRole("button", { name: "Cancel focus on api.example.com" }),
            );
        });

        expect(store.getState().ui.focus.hosts).toEqual([]);
        expect(getByRole("button", { name: /^focus/i })).toBeInTheDocument();
    });

    it("clears every focus at once", () => {
        const store = storeWith(["api.example.com", "cdn.example.com"]);
        const { getByRole } = render(<FocusControl />, { store });

        act(() => {
            fireEvent.click(getByRole("button", { name: "Clear" }));
        });

        expect(store.getState().ui.focus.hosts).toEqual([]);
    });

    it("puts the group name Other in the accessible labels", () => {
        // Guards the shared wording with the MCP side, where the group is "Other".
        expect(OTHER_GROUP).toBe("Other");
    });

    it("keeps the chip for a host even when the search filter hides its flows", () => {
        // Focus and filtering do not share state: the chip survives a search.
        const store = storeWith();
        act(() => store.dispatch(focusHost("api.example.com")));
        const { getByRole } = render(<FocusControl />, { store });
        expect(
            getByRole("button", { name: "Cancel focus on api.example.com" }),
        ).toBeInTheDocument();
    });

    it("renders a snapshot without focus", () => {
        const { asFragment } = render(<FocusControl />, {
            store: storeWith(),
        });
        expect(asFragment()).toMatchSnapshot();
    });
});
