import * as React from "react";
import Icon from "../common/Icon";
import { useAppDispatch, useAppSelector } from "../../ducks";
import { flowHost, toggleFocus, unfocusHost } from "../../ducks/ui/focus";

/**
 * Focus (REQ-4.2) pins hosts to the top of the flow list and groups everything
 * else under "Other". It reorders the view; it never hides a flow.
 *
 * The control acts on the host(s) of the flows selected in the table, so the
 * main path is "select a flow, press Focus". An already-focused host shows up
 * as a chip that cancels it again.
 */
export default function FocusControl() {
    const dispatch = useAppDispatch();
    const selected = useAppSelector((state) => state.flows.selected);
    const selectedIds = useAppSelector((state) => state.flows.selectedIds);
    const hosts = useAppSelector((state) => state.ui.focus.hosts);

    // Hosts of the current selection, in selection order, deduplicated. TCP/UDP
    // and DNS flows have no host and simply contribute nothing.
    const selectedHosts = React.useMemo(() => {
        const out: string[] = [];
        for (const flow of selected) {
            const host = flowHost(flow);
            if (host && !out.includes(host)) {
                out.push(host);
            }
        }
        return out;
    }, [selected, selectedIds]);

    const alreadyFocused =
        selectedHosts.length > 0 &&
        selectedHosts.every((host) => hosts.includes(host));

    const onToggle = () => {
        if (selectedHosts.length === 0) {
            return;
        }
        if (alreadyFocused) {
            for (const host of selectedHosts) {
                dispatch(unfocusHost(host));
            }
        } else {
            for (const host of selectedHosts) {
                if (!hosts.includes(host)) {
                    dispatch(toggleFocus(host));
                }
            }
        }
    };

    return (
        <div className="focus-control">
            <div className="focus-actions">
                <button
                    type="button"
                    className={`btn btn-default focus-toggle${
                        alreadyFocused ? " active" : ""
                    }`}
                    onClick={onToggle}
                    disabled={selectedHosts.length === 0}
                    aria-pressed={alreadyFocused}
                    title={
                        selectedHosts.length === 0
                            ? "Select a flow to focus its host"
                            : alreadyFocused
                              ? `Cancel focus on ${selectedHosts.join(", ")}`
                              : `Focus ${selectedHosts.join(", ")} and group everything else under Other [f]`
                    }
                >
                    <Icon name="focus" size={14} />
                    <span className="focus-toggle-label">
                        {alreadyFocused ? "Unfocus" : "Focus"}
                    </span>
                </button>
                {hosts.length > 0 && (
                    <button
                        type="button"
                        className="focus-clear"
                        onClick={() => hosts.forEach((h) => dispatch(unfocusHost(h)))}
                        title="Cancel all focus"
                    >
                        Clear
                    </button>
                )}
            </div>
            {hosts.length > 0 && (
                <div className="focus-chips">
                    {hosts.map((host) => (
                        <button
                            key={host}
                            type="button"
                            className="focus-chip"
                            onClick={() => dispatch(unfocusHost(host))}
                            aria-label={`Cancel focus on ${host}`}
                            title="Focused. Click to cancel and restore the original order."
                        >
                            <Icon name="focus" size={12} />
                            <span className="focus-chip-label">{host}</span>
                            <Icon name="close" size={12} />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
