import * as React from "react";
import Icon from "../common/Icon";
import Badge from "../common/Badge";
import type { PreviewEntry } from "../../ducks/rewrite";
import { fetchRulePreview } from "../../ducks/rewrite";
import { useAppDispatch, useAppSelector } from "../../ducks";

/**
 * Which rule wins a chosen field (REQ-6.2 §3).
 *
 * The engine applies the first rule that claims a (target, field) and skips
 * every later write to it, so the UI has to show that order rather than leave
 * "why did my second rule do nothing?" to guesswork. The backend computes it;
 * this asks for one (target, field) and renders the answer: the first row is the
 * one that takes effect, the rest are marked as skipped and name the rule that
 * got there first.
 */
type HitPreviewProps = {
    /** Rule being edited: it is highlighted in the sequence. */
    ruleId?: string;
};

const FIELD_CHOICES: { value: string; label: string; needsName: boolean }[] = [
    { value: "header", label: "header", needsName: true },
    { value: "body", label: "body", needsName: false },
    { value: "status_code", label: "status code", needsName: false },
    { value: "method", label: "method", needsName: false },
    { value: "path", label: "path", needsName: false },
    { value: "query", label: "query parameter", needsName: true },
    { value: "url", label: "url", needsName: false },
];

export default function HitPreview({ ruleId }: HitPreviewProps) {
    const dispatch = useAppDispatch();
    const rules = useAppSelector((state) => state.rewrite.rules);
    const [target, setTarget] = React.useState("request");
    const [field, setField] = React.useState("header");
    const [name, setName] = React.useState("");
    const [entries, setEntries] = React.useState<PreviewEntry[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);

    const choice = FIELD_CHOICES.find((c) => c.value === field);
    const needsName = Boolean(choice?.needsName);
    // A request header and a response header of the same name are two
    // different fields, so target is part of the question for headers.
    const targetMatters = field === "header";

    const nameOf = React.useCallback(
        (id: string | null | undefined) => {
            if (!id) return "";
            const rule = rules.find((entry) => entry.id === id);
            return rule ? rule.name || rule.id : id;
        },
        [rules],
    );

    React.useEffect(() => {
        if (!field) return;
        if (needsName && !name.trim()) {
            setEntries(null);
            setError(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        dispatch(
            fetchRulePreview({
                target: targetMatters ? target : "request",
                field,
                name: needsName ? name.trim().toLowerCase() : undefined,
            }),
        )
            .unwrap()
            .then((result) => {
                if (!cancelled) setEntries(result);
            })
            .catch((e: unknown) => {
                if (cancelled) return;
                setEntries(null);
                setError(
                    e instanceof Error
                        ? e.message
                        : "The preview could not be loaded.",
                );
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [dispatch, target, field, name, needsName, targetMatters]);

    return (
        <div className="hit-preview" data-testid="hit-preview">
            <div className="hit-preview-controls">
                <label>
                    Preview
                    {targetMatters && (
                        <select
                            aria-label="Preview target"
                            value={target}
                            onChange={(e) => setTarget(e.target.value)}
                        >
                            <option value="request">request</option>
                            <option value="response">response</option>
                        </select>
                    )}
                    <select
                        aria-label="Preview field"
                        value={field}
                        onChange={(e) => setField(e.target.value)}
                    >
                        {FIELD_CHOICES.map((c) => (
                            <option key={c.value} value={c.value}>
                                {c.label}
                            </option>
                        ))}
                    </select>
                    {needsName && (
                        <input
                            aria-label="Preview name"
                            type="text"
                            placeholder={
                                field === "header" ? "header name" : "parameter"
                            }
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    )}
                </label>
                {loading && (
                    <span className="text-muted text-small">
                        <Icon name="loading" className="icon-spin" /> checking…
                    </span>
                )}
            </div>

            {error && (
                <div className="alert alert-warning text-small" role="alert">
                    {error}
                </div>
            )}

            {!error && needsName && !name.trim() && (
                <div className="help-block text-small">
                    Name the {field === "header" ? "header" : "parameter"} to see
                    which rule takes it.
                </div>
            )}

            {!error && entries && entries.length === 0 && (
                <div className="help-block text-small">
                    No rule writes this field, so nothing competes for it.
                </div>
            )}

            {!error && entries && entries.length > 0 && (
                <table className="hit-preview-table">
                    <thead>
                        <tr>
                            <th className="col-order">#</th>
                            <th>Rule</th>
                            <th>Outcome</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map((entry, index) => (
                            <tr
                                key={entry.rule_id}
                                className={
                                    entry.rule_id === ruleId
                                        ? "hit-preview-current"
                                        : undefined
                                }
                            >
                                <td className="col-order">{index + 1}</td>
                                <td>
                                    {entry.rule_name || entry.rule_id}
                                    {entry.rule_id === ruleId && (
                                        <span className="text-muted text-small">
                                            {" "}
                                            (this rule)
                                        </span>
                                    )}
                                    {entry.ruleset_id && (
                                        <Badge className="status-badge status-2xx hit-preview-set">
                                            set
                                        </Badge>
                                    )}
                                </td>
                                <td>
                                    {entry.effective ? (
                                        <span className="text-success">
                                            <Icon name="confirm" /> Applies
                                        </span>
                                    ) : (
                                        <span className="text-muted">
                                            <Icon name="undo" /> Skipped —{" "}
                                            {nameOf(entry.skipped_by)} claims
                                            this field first
                                        </span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
