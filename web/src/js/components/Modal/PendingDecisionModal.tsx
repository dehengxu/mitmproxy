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
    pendingHoldReason,
    pendingSecondsLeft,
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
 *
 * The backend holds a request for five minutes and drops it the moment the
 * client goes away. A row past its `expire_at`, or one the backend no longer
 * calls `pending`, is greyed out and says why, so nobody clicks into a decision
 * that can only come back as an error. The row is not hidden: a request that is
 * still held must stay visible, and a refused decision shows the backend's own
 * words against that row.
 */
export default function PendingDecisionModal() {
    const dispatch = useAppDispatch();
    const pending = useAppSelector((state) => state.rewrite.pending);
    const error = useAppSelector((state) => state.rewrite.error);
    const flowsById = useAppSelector((state) => state.flows.byId);
    const [busy, setBusy] = React.useState<string | null>(null);
    // The row a refused decision belongs to, so the backend's words can sit
    // next to that request rather than only in the banner above the table.
    const [failure, setFailure] = React.useState<{
        token: string;
        message: string;
    } | null>(null);
    const [now, setNow] = React.useState(() => Date.now() / 1000);

    // A row expires on the clock, not on a server message, so the table has to
    // look again while it is open. One tick per second is enough: the queue is
    // a handful of rows and the reading is a number comparison.
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
        return () => clearInterval(timer);
    }, []);

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
            // the request is still held and removing it would hide that. The
            // backend's own words are the point here -- "待决策已过期（TTL 5 分钟），
            // 已自动清理" tells far more than a generic "unknown error" would.
            const message = errorMessage(e);
            const reason =
                message && message !== "undefined" && message !== "null"
                    ? message
                    : "the decision was not saved.";
            setFailure({
                token: entry.token,
                message: `“${describe(entry)}” is still waiting: ${reason}`,
            });
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
                        {failure.message}
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
                                {pending.map((entry) => {
                                    // The backend decides whether a row can still
                                    // be acted on; this only reads its answer.
                                    const holdReason = pendingHoldReason(
                                        entry,
                                        now,
                                    );
                                    const refused =
                                        failure?.token === entry.token
                                            ? failure.message
                                            : null;
                                    const secondsLeft = pendingSecondsLeft(
                                        entry,
                                        now,
                                    );
                                    return (
                                        <tr
                                            key={entry.token}
                                            className={
                                                holdReason
                                                    ? "pending-expired"
                                                    : refused
                                                      ? "pending-refused"
                                                      : undefined
                                            }
                                            data-state={
                                                holdReason
                                                    ? "expired"
                                                    : "pending"
                                            }
                                        >
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
                                            <td className="col-age">
                                                <span className="pending-age">
                                                    {formatAge(
                                                        entry.created_at,
                                                    )}
                                                </span>
                                                {holdReason && (
                                                    <span
                                                        className="pending-hold-reason"
                                                        title={
                                                            "The breakpoint no longer holds this request: the " +
                                                            "waiting time ran out or the client went away, " +
                                                            "so the backend cleared it."
                                                        }
                                                    >
                                                        {holdReason}
                                                    </span>
                                                )}
                                                {!holdReason && refused && (
                                                    <span
                                                        className="pending-hold-reason"
                                                        title={
                                                            "The backend refused the decision; the request is still held."
                                                        }
                                                    >
                                                        Decision refused
                                                    </span>
                                                )}
                                                {!holdReason &&
                                                    secondsLeft !==
                                                        undefined && (
                                                        <span
                                                            className="pending-expires-in"
                                                            title="How long the breakpoint will keep holding this request"
                                                        >
                                                            {formatCountdown(
                                                                secondsLeft,
                                                            )}
                                                        </span>
                                                    )}
                                            </td>
                                            <td className="col-decisions">
                                                <DecisionButtons
                                                    size="xs"
                                                    disabled={
                                                        busy === entry.token
                                                    }
                                                    onDecision={(decision) =>
                                                        decide(entry, decision)
                                                    }
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
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

/** "expires in 4m" — the remaining TTL, for a row that can still be decided. */
export function formatCountdown(seconds: number): string {
    if (seconds <= 0) return "expires now";
    if (seconds < 60) return `expires in ${Math.ceil(seconds)}s`;
    return `expires in ${Math.ceil(seconds / 60)}m`;
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
