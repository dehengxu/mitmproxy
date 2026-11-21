import * as React from "react";
import classnames from "classnames";
import Icon from "../common/Icon";
import Badge from "../common/Badge";
import Button from "../common/Button";
import ActionEditor from "../rewrite/ActionEditor";
import HitPreview from "../rewrite/HitPreview";
import { validateActions } from "../rewrite/actionFields";
import * as modalAction from "../../ducks/ui/modal";
import * as rewriteActions from "../../ducks/rewrite";
import type {
    RewriteRule,
    RewriteRuleSet,
    RuleAction,
} from "../../ducks/rewrite";
import { errorMessage } from "../../ducks/rewrite";
import { useAppDispatch, useAppSelector } from "../../ducks";

/**
 * Rule management (REQ-6.2).
 *
 * Three levels, each in place: the rule sets (with the standalone rules above
 * them, because that is the order the engine evaluates), the rules inside one
 * set, and the inline editor for a single rule. Both orders are adjustable --
 * a set's position in the evaluation order, and a rule's position inside its
 * set -- because "the first rule to claim a field wins" makes order the thing
 * that decides what a rule actually does.
 *
 * Every change goes to the backend and the list is re-read from it: the store
 * must never show an order the engine does not have.
 */
type Draft = {
    id: string;
    name: string;
    filter: string;
    phase: string;
    enabled: boolean;
    actions: RuleAction[];
    decision: string;
};

const NEW_RULE_ID = () => `rule-${Date.now().toString(36)}`;
const NEW_SET_ID = () => `set-${Date.now().toString(36)}`;

function ruleToDraft(rule: RewriteRule): Draft {
    return {
        id: rule.id,
        name: rule.name ?? "",
        filter: rule.filter ?? "",
        phase: rule.phase ?? "both",
        enabled: rule.enabled !== false,
        actions: Array.isArray(rule.actions) ? rule.actions : [],
        decision: rule.decision ?? "execute",
    };
}

function emptyDraft(): Draft {
    return {
        id: NEW_RULE_ID(),
        name: "",
        filter: "",
        phase: "both",
        enabled: true,
        actions: [],
        decision: "execute",
    };
}

export default function RewriteRulesModal() {
    const dispatch = useAppDispatch();
    const rules = useAppSelector((state) => state.rewrite.rules);
    const rulesets = useAppSelector((state) => state.rewrite.rulesets);
    const loadError = useAppSelector((state) => state.rewrite.error);

    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [draft, setDraft] = React.useState<Draft | null>(null);
    /** Which set the open draft belongs to, or null for a standalone rule. */
    const [draftSet, setDraftSet] = React.useState<string | null>(null);
    const [setDrafts, setSetDrafts] = React.useState<Record<string, string>>({});
    const [newSetName, setNewSetName] = React.useState("");
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

    const reload = React.useCallback(async () => {
        try {
            await dispatch(rewriteActions.fetchRules()).unwrap();
            setError(null);
        } catch (e) {
            setError(errorMessage(e));
        }
    }, [dispatch]);

    React.useEffect(() => {
        let alive = true;
        setLoading(true);
        dispatch(rewriteActions.fetchRules())
            .unwrap()
            .catch((e: unknown) => {
                if (alive) setError(errorMessage(e));
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [dispatch]);

    /** Runs one backend change; on failure the list is left exactly as it was. */
    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
            await reload();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const standalone = rules.filter((rule) => !rule.ruleset_id);

    const startEdit = (rule: RewriteRule, setId: string | null) => {
        setDraft(ruleToDraft(rule));
        setDraftSet(setId);
    };

    const saveDraft = async () => {
        if (!draft) return;
        const problem = validateActions(draft.actions);
        if (problem) {
            setError(problem);
            return;
        }
        const rule: RewriteRule = {
            id: draft.id,
            name: draft.name.trim(),
            enabled: draft.enabled,
            filter: draft.filter,
            phase: draft.phase,
            actions: draft.actions,
            decision: draft.decision,
        };
        await run(async () => {
            await dispatch(rewriteActions.saveRule(rule)).unwrap();
            setDraft(null);
        });
    };

    const toggleSet = (set: RewriteRuleSet) =>
        run(() =>
            dispatch(
                rewriteActions.setRuleSetEnabled({
                    id: set.id,
                    enabled: !set.enabled,
                }),
            ).unwrap(),
        );

    const moveSet = (set: RewriteRuleSet, delta: number) => {
        const index = rulesets.findIndex((entry) => entry.id === set.id);
        const target = index + delta;
        if (target < 0 || target >= rulesets.length) return;
        return run(() =>
            dispatch(
                rewriteActions.moveRuleSet({ id: set.id, index: target }),
            ).unwrap(),
        );
    };

    const moveRule = (setId: string, set: RewriteRuleSet, index: number, delta: number) => {
        const target = index + delta;
        const current = set.rules ?? [];
        if (target < 0 || target >= current.length) return;
        const ids = current.map((rule) => rule.id);
        [ids[index], ids[target]] = [ids[target], ids[index]];
        return run(() =>
            dispatch(rewriteActions.reorderRuleSet({ id: setId, ruleIds: ids })).unwrap(),
        );
    };

    const deleteRuleEverywhere = (rule: RewriteRule) =>
        run(() => dispatch(rewriteActions.deleteRule(rule.id)).unwrap());

    const toggleRule = (rule: RewriteRule) =>
        run(() =>
            dispatch(
                rewriteActions.setRuleEnabled({
                    id: rule.id,
                    enabled: !rule.enabled,
                }),
            ).unwrap(),
        );

    const createSet = () => {
        const name = newSetName.trim();
        if (!name) {
            setError("Give the rule set a name.");
            return;
        }
        run(async () => {
            await dispatch(
                rewriteActions.saveRuleSet({ id: NEW_SET_ID(), name }),
            ).unwrap();
            setNewSetName("");
        });
    };

    const renameSet = (set: RewriteRuleSet, name: string) =>
        run(() =>
            dispatch(
                rewriteActions.saveRuleSet({ id: set.id, name }),
            ).unwrap(),
        );

    const deleteSet = (set: RewriteRuleSet) =>
        run(() => dispatch(rewriteActions.deleteRuleSet(set.id)).unwrap());

    const moveIntoSet = (rule: RewriteRule, setId: string) =>
        run(() =>
            dispatch(
                rewriteActions.addRuleToSet({ rulesetId: setId, ruleId: rule.id }),
            ).unwrap(),
        );

    const moveOutOfSet = (rule: RewriteRule, setId: string) =>
        run(() =>
            dispatch(
                rewriteActions.removeRuleFromSet({
                    rulesetId: setId,
                    ruleId: rule.id,
                }),
            ).unwrap(),
        );

    const shownError = error ?? loadError ?? null;

    return (
        <div className="rewrite-rules-modal">
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
                    <h4 id="rewrite-rules-title">
                        Rewrite rules{" "}
                        {rules.length > 0 && (
                            <Badge className="status-badge status-2xx">
                                {rules.length}
                            </Badge>
                        )}
                    </h4>
                </div>
            </div>

            <div className="modal-body">
                <p className="help-block text-small">
                    Rules are evaluated top to bottom: standalone rules first,
                    then each enabled rule set, rules inside a set in their own
                    order. The first rule to write a field owns it; later rules
                    writing the same field are skipped, and the preview under
                    each rule shows exactly that.
                </p>

                {shownError && (
                    <div className="alert alert-warning text-small" role="alert">
                        {shownError}
                    </div>
                )}

                {loading ? (
                    <div className="pending-empty">
                        <Icon name="loading" className="icon-spin" /> Loading…
                    </div>
                ) : (
                    <>
                        <section className="rules-section">
                            <h5 className="rules-section-title">
                                Standalone rules{" "}
                                <span className="text-muted text-small">
                                    evaluated before any rule set
                                </span>
                            </h5>
                            {standalone.length === 0 ? (
                                <div className="help-block text-small">
                                    No standalone rules.
                                </div>
                            ) : (
                                <table className="table rewrite-rules-table">
                                    <tbody>
                                        {standalone.map((rule, index) => (
                                            <RuleRow
                                                key={rule.id}
                                                rule={rule}
                                                ordinal={index + 1}
                                                setId={null}
                                                rulesets={rulesets}
                                                busy={busy}
                                                onEdit={() =>
                                                    startEdit(rule, null)
                                                }
                                                onToggle={() => toggleRule(rule)}
                                                onDelete={() =>
                                                    deleteRuleEverywhere(rule)
                                                }
                                                onMoveInto={moveIntoSet}
                                                onMoveOut={null}
                                                onMoveUp={null}
                                                onMoveDown={null}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>

                        <section className="rules-section">
                            <h5 className="rules-section-title">
                                Rule sets{" "}
                                <span className="text-muted text-small">
                                    a set&apos;s position decides the priority
                                    of its rules
                                </span>
                            </h5>

                            {rulesets.map((set, setIndex) => {
                                const setRules = set.rules ?? [];
                                const isOpen =
                                    expanded[set.id] ?? setRules.length > 0;
                                return (
                                    <div
                                        className={classnames("ruleset", {
                                            "ruleset-disabled": !set.enabled,
                                        })}
                                        key={set.id}
                                    >
                                        <div className="ruleset-head">
                                            <button
                                                type="button"
                                                className="btn btn-default btn-xs ruleset-toggle"
                                                title={
                                                    isOpen
                                                        ? "Collapse this set"
                                                        : "Expand this set"
                                                }
                                                onClick={() =>
                                                    setExpanded({
                                                        ...expanded,
                                                        [set.id]: !isOpen,
                                                    })
                                                }
                                            >
                                                <Icon
                                                    name={
                                                        isOpen
                                                            ? "chevronDown"
                                                            : "chevronRight"
                                                    }
                                                />
                                            </button>
                                            <input
                                                className="ruleset-name"
                                                aria-label={`Name of rule set ${setIndex + 1}`}
                                                value={
                                                    setDrafts[set.id] ??
                                                    set.name
                                                }
                                                disabled={busy}
                                                onChange={(e) =>
                                                    setSetDrafts({
                                                        ...setDrafts,
                                                        [set.id]: e.target.value,
                                                    })
                                                }
                                                onBlur={(e) => {
                                                    const name =
                                                        e.target.value.trim();
                                                    if (name && name !== set.name) {
                                                        renameSet(set, name);
                                                    }
                                                }}
                                            />
                                            <span className="text-muted text-small">
                                                {setRules.length} rule
                                                {setRules.length === 1
                                                    ? ""
                                                    : "s"}
                                            </span>
                                            <label className="ruleset-master-switch">
                                                <input
                                                    type="checkbox"
                                                    checked={set.enabled}
                                                    disabled={busy}
                                                    onChange={() => toggleSet(set)}
                                                />
                                                enabled
                                            </label>
                                            <span className="ruleset-buttons">
                                                <button
                                                    type="button"
                                                    className="btn btn-default btn-xs"
                                                    title="Move this set earlier in the evaluation order"
                                                    disabled={busy || setIndex === 0}
                                                    onClick={() =>
                                                        moveSet(set, -1)
                                                    }
                                                >
                                                    <Icon name="chevronUp" />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-default btn-xs"
                                                    title="Move this set later in the evaluation order"
                                                    disabled={
                                                        busy ||
                                                        setIndex === rulesets.length - 1
                                                    }
                                                    onClick={() => moveSet(set, 1)}
                                                >
                                                    <Icon name="chevronDown" />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-default btn-xs"
                                                    title="Delete this set and the rules inside it"
                                                    disabled={busy}
                                                    onClick={() => deleteSet(set)}
                                                >
                                                    <Icon name="delete" />
                                                </button>
                                            </span>
                                        </div>

                                        {isOpen && (
                                            <>
                                                {!set.enabled && (
                                                    <div className="help-block text-small ruleset-disabled-note">
                                                        This set is off: its rules
                                                        are neither evaluated nor
                                                        shown in previews.
                                                    </div>
                                                )}
                                                {setRules.length === 0 ? (
                                                    <div className="help-block text-small">
                                                        Empty set — add a rule or
                                                        move a standalone rule
                                                        into it.
                                                    </div>
                                                ) : (
                                                    <table className="table rewrite-rules-table">
                                                        <tbody>
                                                            {setRules.map(
                                                                (rule, index) => (
                                                                    <RuleRow
                                                                        key={rule.id}
                                                                        rule={rule}
                                                                        ordinal={
                                                                            index + 1
                                                                        }
                                                                        setId={set.id}
                                                                        rulesets={
                                                                            rulesets
                                                                        }
                                                                        busy={busy}
                                                                        onEdit={() =>
                                                                            startEdit(
                                                                                rule,
                                                                                set.id,
                                                                            )
                                                                        }
                                                                        onToggle={() =>
                                                                            toggleRule(rule)
                                                                        }
                                                                        onDelete={() =>
                                                                            deleteRuleEverywhere(rule)
                                                                        }
                                                                        onMoveInto={
                                                                            moveIntoSet
                                                                        }
                                                                        onMoveOut={() =>
                                                                            moveOutOfSet(
                                                                                rule,
                                                                                set.id,
                                                                            )
                                                                        }
                                                                        onMoveUp={() =>
                                                                            moveRule(
                                                                                set.id,
                                                                                set,
                                                                                index,
                                                                                -1,
                                                                            )
                                                                        }
                                                                        onMoveDown={() =>
                                                                            moveRule(
                                                                                set.id,
                                                                                set,
                                                                                index,
                                                                                1,
                                                                            )
                                                                        }
                                                                    />
                                                                ),
                                                            )}
                                                        </tbody>
                                                    </table>
                                                )}
                                                <button
                                                    type="button"
                                                    className="btn btn-default btn-xs ruleset-add-rule"
                                                    disabled={busy}
                                                    onClick={() =>
                                                        startEdit(
                                                            {
                                                                id: NEW_RULE_ID(),
                                                                name: "",
                                                                enabled: true,
                                                                filter: "",
                                                                phase: "both",
                                                                actions: [],
                                                                decision:
                                                                    "execute",
                                                            } as RewriteRule,
                                                            set.id,
                                                        )
                                                    }
                                                >
                                                    <Icon name="addSquare" />
                                                    &nbsp;New rule in this set
                                                </button>
                                            </>
                                        )}
                                    </div>
                                );
                            })}

                            <div className="ruleset-new">
                                <input
                                    type="text"
                                    aria-label="New rule set name"
                                    placeholder="New rule set name"
                                    value={newSetName}
                                    disabled={busy}
                                    onChange={(e) => setNewSetName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") createSet();
                                    }}
                                />
                                <Button
                                    icon="addSquare"
                                    className="btn-xs"
                                    onClick={createSet}
                                    disabled={busy || !newSetName.trim()}
                                >
                                    Add rule set
                                </Button>
                            </div>
                        </section>

                        {draft && (
                            <RuleEditor
                                draft={draft}
                                setId={draftSet}
                                isNew={!rules.some((r) => r.id === draft.id)}
                                busy={busy}
                                onChange={setDraft}
                                onCancel={() => setDraft(null)}
                                onSave={saveDraft}
                            />
                        )}

                        <div className="rewrite-rules-footer">
                            <Button
                                icon="addSquare"
                                className="btn-xs"
                                onClick={() => {
                                    setDraft(emptyDraft());
                                    setDraftSet(null);
                                }}
                                disabled={busy}
                            >
                                New standalone rule
                            </Button>
                        </div>
                    </>
                )}
            </div>

            <div className="modal-footer">
                <button
                    type="button"
                    className="btn btn-default"
                    onClick={() => reload()}
                    disabled={busy}
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

function RuleRow({
    rule,
    ordinal,
    setId,
    rulesets,
    busy,
    onEdit,
    onToggle,
    onDelete,
    onMoveInto,
    onMoveOut,
    onMoveUp,
    onMoveDown,
}: {
    rule: RewriteRule;
    ordinal: number;
    setId: string | null;
    rulesets: RewriteRuleSet[];
    busy: boolean;
    onEdit: () => void;
    onToggle: () => void;
    onDelete: () => void;
    onMoveInto: (rule: RewriteRule, setId: string) => void;
    onMoveOut: (() => void) | null;
    onMoveUp: (() => void) | null;
    onMoveDown: (() => void) | null;
}) {
    const targets = rulesets.filter((set) => set.id !== setId);
    return (
        <tr className={classnames({ "rule-disabled": !rule.enabled })}>
            <td className="col-order">{ordinal}</td>
            <td className="col-rule">
                <div className="rule-name">
                    {rule.name || <span className="text-muted">(unnamed)</span>}
                </div>
                <div className="text-muted text-small">
                    {rule.filter ? (
                        <>
                            <code>{rule.filter}</code>
                            {" · "}
                        </>
                    ) : (
                        <span className="text-warning">no filter</span>
                    )}
                    {rule.phase}
                    {" · "}
                    {rule.actions.length} action
                    {rule.actions.length === 1 ? "" : "s"}
                </div>
            </td>
            <td className="col-buttons">
                <label className="rule-enabled-switch">
                    <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={busy}
                        onChange={onToggle}
                    />
                    on
                </label>
                {onMoveUp && (
                    <button
                        type="button"
                        className="btn btn-default btn-xs"
                        title="Move this rule up inside its set"
                        disabled={busy}
                        onClick={onMoveUp}
                    >
                        <Icon name="chevronUp" />
                    </button>
                )}
                {onMoveDown && (
                    <button
                        type="button"
                        className="btn btn-default btn-xs"
                        title="Move this rule down inside its set"
                        disabled={busy}
                        onClick={onMoveDown}
                    >
                        <Icon name="chevronDown" />
                    </button>
                )}
                <button
                    type="button"
                    className="btn btn-default btn-xs"
                    title="Edit this rule"
                    disabled={busy}
                    onClick={onEdit}
                >
                    <Icon name="edit" />
                </button>
                {targets.length > 0 && (
                    <select
                        className="rule-move"
                        aria-label="Move into a rule set"
                        value=""
                        disabled={busy}
                        onChange={(e) =>
                            e.target.value && onMoveInto(rule, e.target.value)
                        }
                    >
                        <option value="">Move to set…</option>
                        {targets.map((set) => (
                            <option key={set.id} value={set.id}>
                                {set.name || set.id}
                            </option>
                        ))}
                    </select>
                )}
                {onMoveOut && (
                    <button
                        type="button"
                        className="btn btn-default btn-xs"
                        title="Move out of this set, back to the standalone rules"
                        disabled={busy}
                        onClick={onMoveOut}
                    >
                        <Icon name="undo" />
                        <span className="rule-button-label">Out of set</span>
                    </button>
                )}
                <button
                    type="button"
                    className="btn btn-default btn-xs"
                    title="Delete this rule"
                    disabled={busy}
                    onClick={onDelete}
                >
                    <Icon name="delete" />
                </button>
            </td>
        </tr>
    );
}

function RuleEditor({
    draft,
    setId,
    isNew,
    busy,
    onChange,
    onCancel,
    onSave,
}: {
    draft: Draft;
    setId: string | null;
    isNew: boolean;
    busy: boolean;
    onChange: (draft: Draft) => void;
    onCancel: () => void;
    onSave: () => void;
}) {
    const patch = (changes: Partial<Draft>) => onChange({ ...draft, ...changes });
    return (
        <div className="rule-editor" data-testid="rule-editor">
            <h5 className="rules-section-title">
                {isNew ? "New rule" : "Edit rule"}
                {setId ? " (inside a rule set)" : ""}
            </h5>

            <div className="rule-editor-grid">
                <label>
                    <span>Name</span>
                    <input
                        type="text"
                        aria-label="Rule name"
                        value={draft.name}
                        disabled={busy}
                        onChange={(e) => patch({ name: e.target.value })}
                    />
                </label>
                <label>
                    <span>Filter</span>
                    <input
                        type="text"
                        aria-label="Rule filter"
                        placeholder="~u example.com/api"
                        value={draft.filter}
                        disabled={busy}
                        onChange={(e) => patch({ filter: e.target.value })}
                    />
                </label>
                <label>
                    <span>Phase</span>
                    <select
                        aria-label="Rule phase"
                        value={draft.phase}
                        disabled={busy}
                        onChange={(e) => patch({ phase: e.target.value })}
                    >
                        <option value="both">both</option>
                        <option value="request">request</option>
                        <option value="response">response</option>
                    </select>
                </label>
                <label className="rule-editor-inline-check">
                    <input
                        type="checkbox"
                        checked={draft.enabled}
                        disabled={busy}
                        onChange={(e) => patch({ enabled: e.target.checked })}
                    />
                    enabled
                </label>
            </div>

            <h6 className="rule-editor-subtitle">Actions</h6>
            <ActionEditor
                actions={draft.actions}
                disabled={busy}
                onChange={(actions) => patch({ actions })}
            />

            <h6 className="rule-editor-subtitle">Which rule wins</h6>
            <HitPreview ruleId={draft.id} />

            <div className="rule-editor-buttons">
                <Button icon="confirm" onClick={onSave} disabled={busy}>
                    Save rule
                </Button>
                <Button icon="close" onClick={onCancel} disabled={busy}>
                    Cancel
                </Button>
            </div>
        </div>
    );
}
