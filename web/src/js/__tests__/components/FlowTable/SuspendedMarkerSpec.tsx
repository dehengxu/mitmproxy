import * as React from "react";
import FlowColumns from "../../../components/FlowTable/FlowColumns";
import { TFlow, TStore } from "../../ducks/tutils";
import { fireEvent, render, waitFor } from "../../test-utils";
import { fetchApi } from "../../../utils";

jest.mock("../../../utils");

const mocked = fetchApi as unknown as jest.Mock;

function cell(flow) {
    return render(
        <table>
            <tbody>
                <tr>
                    <FlowColumns.status flow={flow} rowNumber={0} />
                </tr>
            </tbody>
        </table>,
    );
}

test("a held flow is marked in the status column, a normal one is not", () => {
    const held = { ...TFlow(), intercepted: true };
    held.response = { ...held.response!, status_code: 200 };

    const { container } = cell(held);
    expect(container.querySelector(".suspended-badge")).not.toBeNull();
    expect(container.querySelector(".col-status")!.textContent).toContain(
        "200",
    );

    const normal = { ...TFlow(), intercepted: false };
    normal.response = { ...normal.response!, status_code: 200 };
    const { container: normalContainer } = cell(normal);
    expect(normalContainer.querySelector(".suspended-badge")).toBeNull();
});

test("a held request without a status code says why the cell is not empty-less", () => {
    const held = { ...TFlow(), intercepted: true, response: undefined };
    const { container } = cell(held);

    expect(container.querySelector(".col-status")!.textContent).toContain(
        "Pending",
    );
    expect(
        container.querySelector(".suspended-badge")!.getAttribute("title"),
    ).toContain("Waiting for a decision");
});

test("a held request that already has a response keeps its status code visible", () => {
    const held = { ...TFlow(), intercepted: true };
    held.response = { ...held.response!, status_code: 500 };
    const { container } = cell(held);

    expect(container.querySelector(".col-status")!.textContent).toContain(
        "500",
    );
    expect(container.querySelector(".status-badge")).toHaveClass("status-5xx");
});

describe("quick actions on a held flow", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mocked.mockImplementation(async (url: string) => ({
            ok: true,
            // Deciding a held flow first reads the queue to find its token.
            json: async () =>
                url === "/rewrite/pending" ? { pending: [] } : {},
        }));
    });

    function renderQuickActions(flow) {
        const store = TStore();
        const { container } = render(
            <table>
                <tbody>
                    <tr>
                        <FlowColumns.quickactions flow={flow} rowNumber={0} />
                    </tr>
                </tbody>
            </table>,
            { store },
        );
        return { container, store };
    }

    test("offers execute, abort and cancel as three separate actions", () => {
        const held = { ...TFlow(), intercepted: true };
        const { container } = renderQuickActions(held);

        const actions = container.querySelectorAll(".quickaction");
        expect(actions).toHaveLength(3);
        expect(actions[0].getAttribute("title")).toMatch(/^Execute/);
        expect(actions[1].getAttribute("title")).toMatch(/^Abort/);
        expect(actions[2].getAttribute("title")).toMatch(/^Cancel/);
    });

    test("abort and cancel do not both kill the flow", async () => {
        const held = { ...TFlow(), intercepted: true, modified: false };
        held.id = "held-flow";
        const { container } = renderQuickActions(held);
        const [execute, abort, cancel] = Array.from(
            container.querySelectorAll(".quickaction"),
        );

        fireEvent.click(abort);
        await waitFor(() =>
            expect(mocked).toHaveBeenCalledWith("/flows/held-flow/kill", {
                method: "POST",
            }),
        );

        mocked.mockClear();
        fireEvent.click(cancel);
        // Cancel passes the flow through instead of killing it
        await waitFor(() =>
            expect(mocked.mock.calls.map((call) => call[0])).toContain(
                "/flows/held-flow/resume",
            ),
        );
        expect(mocked.mock.calls.map((call) => call[0])).not.toContain(
            "/flows/held-flow/kill",
        );

        mocked.mockClear();
        fireEvent.click(execute);
        await waitFor(() =>
            expect(mocked).toHaveBeenCalledWith("/flows/held-flow/resume", {
                method: "POST",
            }),
        );
    });

    test("cancel drops the edits before letting the flow through", async () => {
        const held = { ...TFlow(), intercepted: true, modified: true };
        held.id = "edited-flow";
        const { container } = renderQuickActions(held);

        fireEvent.click(container.querySelectorAll(".quickaction")[2]);

        // revert is awaited before resume, so both land one after the other
        await waitFor(() =>
            expect(mocked.mock.calls.map((call) => call[0])).toContain(
                "/flows/edited-flow/revert",
            ),
        );
        await waitFor(() =>
            expect(mocked.mock.calls.map((call) => call[0])).toContain(
                "/flows/edited-flow/resume",
            ),
        );
    });

    test("a normal flow keeps the plain replay action", () => {
        const flow = { ...TFlow(), intercepted: false, websocket: undefined };
        const { container } = renderQuickActions(flow);

        const actions = container.querySelectorAll(".quickaction");
        expect(actions).toHaveLength(1);
        expect(container.querySelector(".icon-replay")).not.toBeNull();
    });
});
