import { onKeyDown } from "../../../ducks/ui/keyboard";
import { TFlow, TStore, TUDPFlow, testState } from "../tutils";

jest.mock("../../../utils");

const httpFlow = (id: string, host: string) => ({
    ...TFlow(),
    id,
    request: { ...TFlow().request, host },
});

const press = () =>
    // @ts-expect-error not a real KeyboardEvent
    onKeyDown({ key: "f", ctrlKey: false, preventDefault: jest.fn() });

describe("the f shortcut (Focus toggle)", () => {
    it("focuses the selected flow's host and toggles it off again", () => {
        const flow = httpFlow("x", "API.example.com");
        const store = TStore({
            ...testState,
            ui: { ...testState.ui, focus: { hosts: [] } },
            flows: {
                ...testState.flows,
                list: [flow],
                view: [flow],
                selected: [flow],
                selectedIds: new Set(["x"]),
            },
        });

        store.dispatch(press());
        expect(store.getState().ui.focus.hosts).toEqual(["api.example.com"]);

        store.dispatch(press());
        expect(store.getState().ui.focus.hosts).toEqual([]);
    });

    it("does nothing for a flow without a host", () => {
        const store = TStore({
            ...testState,
            ui: { ...testState.ui, focus: { hosts: [] } },
            flows: {
                ...testState.flows,
                selected: [TUDPFlow()],
            },
        });

        store.dispatch(press());
        expect(store.getState().ui.focus.hosts).toEqual([]);
    });
});
