import * as React from "react";
import Icon from "../common/Icon";
import Button from "../common/Button";
import type { RuleAction } from "../../ducks/rewrite";
import {
    ACTION_TYPES,
    ACTION_SPECS,
    fieldsFor,
    FIELD_LABELS,
    describeAction,
} from "./actionFields";

/**
 * The actions of one rule, edited in place (REQ-6.2 §2 and §6).
 *
 * The fields shown depend on the action type, taken from the backend's own
 * ACTION_FIELDS table, so the form cannot offer a field the engine ignores or
 * omit one it needs. Several actions on one rule run in order and do not
 * conflict with each other -- only rules conflict.
 */
type ActionEditorProps = {
    actions: RuleAction[];
    onChange: (actions: RuleAction[]) => void;
    disabled?: boolean;
};

type Patch = (field: string, value: unknown) => void;

export default function ActionEditor({
    actions,
    onChange,
    disabled,
}: ActionEditorProps) {
    const replace = (index: number, next: RuleAction) =>
        onChange(actions.map((a, i) => (i === index ? next : a)));

    const remove = (index: number) =>
        onChange(actions.filter((_, i) => i !== index));

    const move = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= actions.length) return;
        const next = [...actions];
        [next[index], next[target]] = [next[target], next[index]];
        onChange(next);
    };

    const add = () => {
        const next: RuleAction = { type: "set_header", target: "request" };
        onChange([...actions, next]);
    };

    return (
        <div className="action-editor">
            {actions.length === 0 && (
                <div className="help-block text-small">
                    This rule has no actions yet, so matching does nothing.
                </div>
            )}
            {actions.map((action, index) => {
                const spec = ACTION_SPECS[action.type];
                const patch: Patch = (field, value) =>
                    replace(index, {
                        ...action,
                        [field]: value,
                    } as RuleAction);
                return (
                    <div className="action-row" key={index}>
                        <div className="action-row-head">
                            <span className="action-index">#{index + 1}</span>
                            <select
                                aria-label={`Action ${index + 1} type`}
                                value={action.type}
                                disabled={disabled}
                                onChange={(e) => {
                                    const type = e.target.value;
                                    // Start from the new type's own fields, so
                                    // no value from the previous type lingers
                                    // and trips the engine's validator.
                                    const next: RuleAction = { type };
                                    if (fieldsFor(type).includes("target")) {
                                        next.target = "request";
                                    }
                                    replace(index, next);
                                }}
                            >
                                {ACTION_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                        {ACTION_SPECS[type].label}
                                    </option>
                                ))}
                            </select>
                            <span className="text-muted text-small action-writes">
                                writes {spec ? spec.writes : "—"}
                            </span>
                            <span className="action-row-buttons">
                                <button
                                    type="button"
                                    className="btn btn-default btn-xs"
                                    title="Move this action up"
                                    disabled={disabled || index === 0}
                                    onClick={() => move(index, -1)}
                                >
                                    <Icon name="chevronUp" />
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-default btn-xs"
                                    title="Move this action down"
                                    disabled={
                                        disabled || index === actions.length - 1
                                    }
                                    onClick={() => move(index, 1)}
                                >
                                    <Icon name="chevronDown" />
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-default btn-xs"
                                    title="Remove this action"
                                    disabled={disabled}
                                    onClick={() => remove(index)}
                                >
                                    <Icon name="delete" />
                                </button>
                            </span>
                        </div>
                        <div className="action-row-fields">
                            {fieldsFor(action.type).map((field) => (
                                <ActionFieldInput
                                    key={field}
                                    field={field}
                                    action={action}
                                    disabled={disabled}
                                    onPatch={patch}
                                />
                            ))}
                        </div>
                        <div className="help-block text-small action-summary">
                            {describeAction(action)}
                        </div>
                    </div>
                );
            })}
            <Button
                icon="addSquare"
                className="btn-xs"
                onClick={add}
                disabled={disabled}
            >
                Add action
            </Button>
        </div>
    );
}

function ActionFieldInput({
    field,
    action,
    disabled,
    onPatch,
}: {
    field: string;
    action: RuleAction;
    disabled?: boolean;
    onPatch: Patch;
}) {
    const value = (action as unknown as Record<string, unknown>)[field];
    const label = FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field;
    const id = React.useId();

    if (field === "target") {
        return (
            <label className="action-field" htmlFor={id}>
                <span>{label}</span>
                <select
                    id={id}
                    value={String(value ?? "request")}
                    disabled={disabled}
                    onChange={(e) => onPatch(field, e.target.value)}
                >
                    <option value="request">request</option>
                    <option value="response">response</option>
                </select>
            </label>
        );
    }

    if (field === "encoding") {
        return (
            <label className="action-field" htmlFor={id}>
                <span>{label}</span>
                <select
                    id={id}
                    value={String(value ?? "text")}
                    disabled={disabled}
                    onChange={(e) => onPatch(field, e.target.value)}
                >
                    <option value="text">text</option>
                    <option value="base64">base64</option>
                </select>
            </label>
        );
    }

    if (field === "status_code" || field === "seconds") {
        return (
            <label className="action-field" htmlFor={id}>
                <span>{label}</span>
                <input
                    id={id}
                    type="number"
                    value={value == null ? "" : String(value)}
                    disabled={disabled}
                    onChange={(e) =>
                        onPatch(
                            field,
                            e.target.value === ""
                                ? null
                                : Number(e.target.value),
                        )
                    }
                />
            </label>
        );
    }

    if (field === "tags") {
        return (
            <label className="action-field" htmlFor={id}>
                <span>{label}</span>
                <input
                    id={id}
                    type="text"
                    placeholder="comma separated"
                    value={Array.isArray(value) ? (value as string[]).join(", ") : ""}
                    disabled={disabled}
                    onChange={(e) =>
                        onPatch(
                            field,
                            e.target.value
                                .split(",")
                                .map((tag) => tag.trim())
                                .filter(Boolean),
                        )
                    }
                />
            </label>
        );
    }

    return (
        <label className="action-field" htmlFor={id}>
            <span>{label}</span>
            <input
                id={id}
                type="text"
                value={String(value ?? "")}
                disabled={disabled}
                onChange={(e) => onPatch(field, e.target.value)}
            />
        </label>
    );
}
