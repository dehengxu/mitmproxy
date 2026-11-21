import reducer, {
    clearFocus,
    flowHost,
    focusHost,
    groupByFocus,
    initialState,
    normalizeHost,
    orderedView,
    OTHER_GROUP,
    toggleFocus,
    unfocusHost,
} from "../../../ducks/ui/focus";
import { TFlow, TUDPFlow } from "../tutils";
import type { Flow } from "../../../flow";

const httpFlow = (id: string, host: string): Flow =>
    ({ ...TFlow(), id, request: { ...TFlow().request, host } }) as Flow;

describe("focus duck", () => {
    it("normalises hosts by trimming and lower-casing only", () => {
        expect(normalizeHost("  API.Example.com ")).toBe("api.example.com");
        expect(normalizeHost(undefined)).toBe("");
        // No subdomain handling, no trailing-dot folding: same as the MCP side.
        expect(normalizeHost("api.example.com.")).toBe("api.example.com.");
    });

    it("reads the bare host of http flows only", () => {
        expect(flowHost(httpFlow("1", "API.Example.com"))).toBe(
            "api.example.com",
        );
        // TCP/UDP/DNS flows carry no host and belong to Other.
        expect(flowHost(TUDPFlow() as Flow)).toBe("");
        expect(flowHost(undefined)).toBe("");
    });

    it("starts empty", () => {
        expect(reducer(undefined, { type: "@@INIT" })).toEqual(initialState);
        expect(initialState).toEqual({ hosts: [] });
    });

    it("focuses a normalised host and ignores duplicates", () => {
        let s = reducer(undefined, focusHost("  API.Example.com"));
        expect(s.hosts).toEqual(["api.example.com"]);
        s = reducer(s, focusHost("api.example.com"));
        expect(s.hosts).toEqual(["api.example.com"]);
    });

    it("rejects empty hosts and the Other group name", () => {
        let s = reducer(undefined, focusHost("   "));
        expect(s.hosts).toEqual([]);
        s = reducer(s, focusHost("Other"));
        expect(s.hosts).toEqual([]);
    });

    it("accepts several hosts in focus order", () => {
        let s = reducer(undefined, focusHost("b.example.com"));
        s = reducer(s, focusHost("a.example.com"));
        expect(s.hosts).toEqual(["b.example.com", "a.example.com"]);
    });

    it("toggles a host on and off again", () => {
        let s = reducer(undefined, toggleFocus("A.example.com"));
        expect(s.hosts).toEqual(["a.example.com"]);
        s = reducer(s, toggleFocus("a.example.com"));
        expect(s.hosts).toEqual([]);
    });

    it("unfocuses one host and leaves the rest", () => {
        let s = reducer(undefined, focusHost("a.example.com"));
        s = reducer(s, focusHost("b.example.com"));
        s = reducer(s, unfocusHost(" A.Example.COM "));
        expect(s.hosts).toEqual(["b.example.com"]);
        // Unfocusing something that is not focused is a no-op.
        s = reducer(s, unfocusHost("nope.example.com"));
        expect(s.hosts).toEqual(["b.example.com"]);
    });

    it("clears every focus", () => {
        let s = reducer(undefined, focusHost("a.example.com"));
        s = reducer(s, clearFocus());
        expect(s.hosts).toEqual([]);
    });

    describe("grouping", () => {
        const a1 = httpFlow("a1", "a.example.com");
        const b1 = httpFlow("b1", "B.example.com");
        const c1 = httpFlow("c1", "c.example.com");
        const udp = TUDPFlow() as Flow;
        const view = [a1, b1, c1, udp];

        it("leaves the order alone when nothing is focused", () => {
            expect(orderedView(view, [])).toEqual(view);
        });

        it("puts the focused host first and everything else into Other", () => {
            const groups = groupByFocus(view, ["b.example.com"]);
            expect(groups.map((g) => g.group)).toEqual([
                "b.example.com",
                OTHER_GROUP,
            ]);
            expect(groups[0].flows).toEqual([b1]);
            expect(groups[0].focused).toBe(true);
            expect(groups[1].focused).toBe(false);
            expect(groups[1].flows).toEqual([a1, c1, udp]);
        });

        it("keeps every flow: focus reorders, it never filters", () => {
            const out = orderedView(view, ["c.example.com"]);
            expect(out).toHaveLength(view.length);
            expect(new Set(out.map((f) => f.id))).toEqual(
                new Set(view.map((f) => f.id)),
            );
        });

        it("orders groups in focus order", () => {
            const groups = groupByFocus(view, [
                "c.example.com",
                "a.example.com",
            ]);
            expect(groups.map((g) => g.group)).toEqual([
                "c.example.com",
                "a.example.com",
                OTHER_GROUP,
            ]);
        });

        it("omits a focused host with no traffic instead of an empty group", () => {
            const groups = groupByFocus(view, ["nope.example.com"]);
            expect(groups.map((g) => g.group)).toEqual([OTHER_GROUP]);
            expect(groups[0].flows).toHaveLength(view.length);
        });

        it("matches exactly, not by subdomain", () => {
            const groups = groupByFocus(view, ["example.com"]);
            expect(groups).toHaveLength(1);
            expect(groups[0].group).toBe(OTHER_GROUP);
        });

        it("keeps the relative order inside each group", () => {
            const a2 = httpFlow("a2", "a.example.com");
            const out = orderedView([a1, b1, a2, c1], ["a.example.com"]);
            expect(out.map((f) => f.id)).toEqual(["a1", "a2", "b1", "c1"]);
        });

        it("restores the original order once the focus is cancelled", () => {
            const focused = orderedView(view, ["c.example.com"]);
            expect(focused.map((f) => f.id)).toEqual([c1.id, a1.id, b1.id, udp.id]);
            expect(orderedView(view, []).map((f) => f.id)).toEqual(
                view.map((f) => f.id),
            );
        });
    });
});
