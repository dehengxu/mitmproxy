import * as React from "react";
import Icon from "../common/Icon";
import Badge from "../common/Badge";
import DecisionButtons from "../rewrite/DecisionButtons";
import * as modalAction from "../../ducks/ui/modal";
import * as flowsActions from "../../ducks/flows";
import type { Decision, PendingDecision } from "../../ducks/rewrite";
import {
    decidePendingEntry,
    errorMessage,
    fetchPending,
    fetchRules,
} from "../../ducks/rewrite";
import { useAppDispatch, useAppSelector } from "../../ducks";
import { formatTimeStamp } from "../../utils";

/**
 * The queue of flows a breakpoint rule is holding back (REQ-6.1).
 *
 * One row per waiting flow, each with the same three outcomes the flow menu
 * offers. Deciding a row takes it out of the queue; the backend is the side that
 * releases the flow. Cancel leaves the rule enabled, and the toast afterwards
 * says so and offers to disable it in one click.
 */
export default function PendingDecisionModal() {
    const dispatch = useAppDispatch();
    const pending = useAppSelector((state) => state.rewrite.pending);
    const error = useAppSelector((state) => state.rewrite.error);
    const flowsById = useAppSelector((state) => state.flows.byId);
    const [busy, setBusy] = React.useState<string | null>(null);
    const [failure, setFailure] = React.useState<string | null>(null);

    React.useEffect(() => {
        dispatch(fetchPending());
        // The rule names are a nicety next to each entry, so a failure there
        // must not keep the queue from working.
        dispatch(fetchRules());
    }, [dispatch]);

    const decide = async (entry: PendingDecision, decision: Decision) => {
        setBusy(entry.token);
        setFailure(null);
        try {
            await dispatch(decidePendingEntry(entry, decision));
        } catch (e) {
            // The row stays in the queue: the backend refused the decision, so
            // the request is still held and removing it would hide that.
            const message = errorMessage(e);
            setFailure(
                message && message !== "undefined"
                    ? `“${describe(entry)}” is still waiting: ${message}`
                    : `“${describe(entry)}” is still waiting: the decision was not saved.`,
            );
        } finally {
            setBusy(null);
        }
    };

    // Only flows the table already knows can be selected; the rest are still
    // named here, and selecting them would be a no-op we do not pretend to do.
    const reveal = (flowId: string) => {
        const flow = flowsById.get(flowId);
        if (flow) dispatch(flowsActions.select([flow]));
    };

    return (
        <div>
            <div className="modal-header">
                <button
                    type="button"
                    className="close"
                    data-dismiss="modal"
                    onClick={() => dispatch(modalAction.hideModal())}
                >
                    <Icon name="close" />
                </button>
                <div className="modal-title">
                    <h4 id="pending-decision-title">
                        Pending decisions{" "}
                        {pending.length > 0 && (
                            <Badge className="status-badge status-3xx">
                                {pending.length}
                            </Badge>
                        )}
                    </h4>
                </div>
            </div>

            <div className="modal-body">
                <p className="help-block text-small">
                    These requests are held by a breakpoint rule until you
                    decide. <strong>Execute</strong> applies your edits and lets
                    the request through, <strong>Abort</strong> kills it without
                    answering the client, and <strong>Cancel</strong> drops the
                    edits and passes the original request through. The rule
                    itself stays enabled either way.
                </p>

                {failure && (
                    <div
                        className="alert alert-warning text-small"
                        role="alert"
                    >
                        {failure}
                    </div>
                )}
                {error && !failure && pending.length === 0 && (
                    <div
                        className="alert alert-warning text-small"
                        role="alert"
                    >
                        {error}
                    </div>
                )}

                {pending.length === 0 && !error ? (
                    <div className="pending-empty">
                        <Icon name="pending" />
                        &nbsp;Nothing is waiting for a decision.
                    </div>
                ) : (
                    <div className="pending-decisions-scroll">
                        <table className="table pending-decisions">
                            <thead>
                                <tr>
                                    <th>Method</th>
                                    <th>Request</th>
                                    <th className="col-phase">Phase</th>
                                    <th className="col-rule">Rule</th>
                                    <th>Waiting since</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {pending.map((entry) => (
                                    <tr key={entry.token}>
                                        <td className="col-method">
                                            <Badge className="method-badge">
                                                {entry.method}
                                            </Badge>
                                        </td>
                                        <td className="col-request">
                                            <a
                                                href="#"
                                                title="Show this flow in the flow table"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    reveal(entry.flow_id);
                                                }}
                                            >
                                                <span className="text-muted">
                                                    {entry.host}
                                                </span>
                                                {entry.path}
                                            </a>
                                        </td>
                                        <td className="col-phase">
                                            {entry.phase}
                                        </td>
                                        <td className="col-rule">
                                            {entry.rule_name}
                                        </td>
                                        <td>{formatAge(entry.created_at)}</td>
                                        <td className="col-decisions">
                                            <DecisionButtons
                                                size="xs"
                                                disabled={busy === entry.token}
                                                onDecision={(decision) =>
                                                    decide(entry, decision)
                                                }
                                            />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="modal-footer">
                <button
                    type="button"
                    className="btn btn-default"
                    onClick={() => dispatch(fetchPending())}
                >
                    <Icon name="refresh" />
                    &nbsp;Refresh
                </button>
                <button
                    type="button"
                    className="btn btn-default"
                    onClick={() => dispatch(modalAction.hideModal())}
                >
                    Close
                </button>
            </div>
        </div>
    );
}

/** A row named the way it is shown in the table, for an error message. */
function describe(entry: PendingDecision): string {
    return `${entry.method} ${entry.host}${entry.path}`;
}

/**
 * The backend may send an ISO timestamp or epoch seconds; the queue only needs a
 * rough "how long has this been stuck" reading.
 */
export function formatAge(created_at: string | number | undefined): string {
    if (created_at === undefined || created_at === null || created_at === "")
        return "—";
    const value =
        typeof created_at === "number"
            ? created_at
            : Date.parse(created_at) / 1000;
    if (!Number.isFinite(value)) return String(created_at);
    const seconds = Math.max(0, Math.round(Date.now() / 1000 - value));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return formatTimeStamp(value, { includeMilliseconds: false });
}
