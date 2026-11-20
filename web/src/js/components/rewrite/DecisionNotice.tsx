import * as React from "react";
import Icon from "../common/Icon";
import {
    disableNoticeRule,
    dismissNotice,
    setRuleEnabled,
} from "../../ducks/rewrite";
import { useAppDispatch, useAppSelector } from "../../ducks";

/**
 * The toast that follows a Cancel (REQ-6.1).
 *
 * Cancelling a breakpoint on purpose leaves the rule that suspended the flow
 * enabled, which is easy to forget once the dialog is gone. The toast says so
 * and offers to turn that one rule off right there, without going to the rule
 * editor.
 */
export default function DecisionNotice() {
    const dispatch = useAppDispatch();
    const notice = useAppSelector((state) => state.rewrite.notice);
    const rules = useAppSelector((state) => state.rewrite.rules);
    const [busy, setBusy] = React.useState(false);

    if (!notice) return null;

    const rule = notice.ruleId
        ? rules.find((entry) => entry.id === notice.ruleId)
        : undefined;
    // The rule list may not have loaded yet; without it we only know the id.
    const ruleStillEnabled = rule ? rule.enabled : Boolean(notice.ruleId);

    const disable = async () => {
        setBusy(true);
        try {
            await dispatch(disableNoticeRule());
        } catch {
            // The rule list is the source of truth on the next fetch; the toast
            // staying put is the visible sign that the call did not go through.
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="decision-notice"
            role="status"
            aria-live="polite"
            data-testid="decision-notice"
        >
            <Icon
                name={notice.kind === "error" ? "warning" : "info"}
                className={
                    notice.kind === "error" ? "text-danger" : "text-info"
                }
            />
            <span className="decision-notice-message">{notice.message}</span>
            {notice.ruleId && ruleStillEnabled && (
                <button
                    type="button"
                    className="btn btn-default btn-xs"
                    disabled={busy}
                    title={
                        rule
                            ? `Turn the breakpoint rule "${rule.name}" off`
                            : "Turn this breakpoint rule off"
                    }
                    onClick={disable}
                >
                    <Icon name="abort" className="text-danger" />
                    &nbsp;Disable this rule
                </button>
            )}
            {notice.ruleId && !ruleStillEnabled && (
                <span className="text-small text-muted">Rule disabled</span>
            )}
            <button
                type="button"
                className="close decision-notice-close"
                title="Dismiss"
                onClick={() => dispatch(dismissNotice())}
            >
                <Icon name="close" />
            </button>
        </div>
    );
}

/**
 * Kept next to the toast because both exist to keep a rule's state visible:
 * this is the plain on/off switch used by the rule list.
 */
export function RuleToggle({
    id,
    enabled,
    name,
}: {
    id: string;
    enabled: boolean;
    name: string;
}) {
    const dispatch = useAppDispatch();
    const [busy, setBusy] = React.useState(false);
    return (
        <label className="checkbox-inline">
            <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                aria-label={`Breakpoint rule ${name} enabled`}
                onChange={async (e) => {
                    const next = e.target.checked;
                    setBusy(true);
                    try {
                        await dispatch(
                            setRuleEnabled({ id, enabled: next }),
                        ).unwrap();
                    } catch {
                        // Nothing to do here: the list refetches the real state.
                    } finally {
                        setBusy(false);
                    }
                }}
            />
            {enabled ? "Enabled" : "Disabled"}
        </label>
    );
}
