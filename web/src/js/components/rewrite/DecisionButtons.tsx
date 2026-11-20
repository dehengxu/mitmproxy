import * as React from "react";
import classnames from "classnames";
import Button from "../common/Button";
import type { Decision } from "../../ducks/rewrite";
import {
    DECISION_LABELS,
    DECISION_TITLES,
} from "../../ducks/rewrite";

const ICONS: Record<Decision, "resume" | "abort" | "undo"> = {
    execute: "resume",
    abort: "abort",
    cancel: "undo",
};

const ICON_CLASSES: Record<Decision, string> = {
    execute: "text-success",
    abort: "text-danger",
    cancel: "text-warning",
};

type DecisionButtonsProps = {
    onDecision: (decision: Decision) => void;
    disabled?: boolean;
    className?: string;
    size?: "sm" | "xs";
    /** Buttons that are meaningless for this entry can be left out. */
    only?: Decision[];
};

/**
 * The three outcomes of a breakpoint, in one place so the flow menu, the
 * pending-decision queue and the flow table all offer the same thing.
 *
 * Execute applies the edits and lets the flow through, Abort kills it, Cancel
 * drops the edits and lets the original flow through while the rule stays on.
 */
export default function DecisionButtons({
    onDecision,
    disabled,
    className,
    size,
    only,
}: DecisionButtonsProps) {
    const decisions: Decision[] = only ?? ["execute", "abort", "cancel"];
    return (
        <span className={classnames("decision-buttons", className)}>
            {decisions.map((decision) => (
                <Button
                    key={decision}
                    className={size ? `btn-${size}` : undefined}
                    title={DECISION_TITLES[decision]}
                    icon={ICONS[decision]}
                    iconClassName={ICON_CLASSES[decision]}
                    disabled={disabled}
                    onClick={() => onDecision(decision)}
                >
                    {DECISION_LABELS[decision]}
                </Button>
            ))}
        </span>
    );
}
