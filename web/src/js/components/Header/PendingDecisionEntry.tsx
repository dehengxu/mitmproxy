import * as React from "react";
import classnames from "classnames";
import Icon from "../common/Icon";
import * as modalActions from "../../ducks/ui/modal";
import { fetchPending } from "../../ducks/rewrite";
import { useAppDispatch, useAppSelector } from "../../ducks";
import { canResumeOrKill } from "../../flow/utils";

/**
 * Entry point to the queue of flows a breakpoint is holding (REQ-6.1).
 *
 * A held request blocks the client it came from, so the count is the only thing
 * telling anyone it is there. The count comes from the flow list, which the
 * WebSocket already keeps current, so no polling is needed; the detailed queue
 * (the one with the tokens a decision is made with) is read when the entry is
 * clicked and when the window regains focus.
 */
export default function PendingDecisionEntry() {
    const dispatch = useAppDispatch();
    const held = useAppSelector(
        (state) => state.flows.list.filter(canResumeOrKill).length,
    );
    const activeModal = useAppSelector((state) => state.ui.modal.activeModal);
    const isOpen = activeModal === "PendingDecisionModal";

    React.useEffect(() => {
        // Coming back to the tab is the moment a stale count would be noticed.
        const refresh = () => dispatch(fetchPending());
        window.addEventListener("focus", refresh);
        return () => window.removeEventListener("focus", refresh);
    }, [dispatch]);

    return (
        <a
            href="#"
            className={classnames("pending-decisions-entry", {
                active: isOpen,
                "has-pending": held > 0,
            })}
            title={
                held > 0
                    ? `${held} request${held === 1 ? "" : "s"} waiting for a decision`
                    : "No requests are waiting for a decision"
            }
            onClick={(e) => {
                e.preventDefault();
                dispatch(fetchPending());
                dispatch(modalActions.setActiveModal("PendingDecisionModal"));
            }}
        >
            <Icon name="pending" />
            <span className="pending-decisions-label">Pending</span>
            {held > 0 && <span className="pending-decisions-count">{held}</span>}
        </a>
    );
}
