import type { RuleAction } from "../../ducks/rewrite";

/**
 * The backend's own ACTION_FIELDS table (REQ-6.2 contract §6), transcribed.
 *
 * `required` drives the form's validation: a save is refused client-side while
 * one of these is empty, so the engine never has to reject the same mistake
 * with a less useful message. `writes` is what the hit preview reasons about:
 * two rules conflict when they write the same (target, field).
 */
export type ActionField =
    | "target"
    | "name"
    | "value"
    | "content"
    | "encoding"
    | "pattern"
    | "replacement"
    | "status_code"
    | "reason"
    | "path"
    | "method"
    | "url"
    | "seconds"
    | "marker"
    | "comment"
    | "tags";

export interface ActionSpec {
    label: string;
    required: ActionField[];
    optional: ActionField[];
    /** Where the action writes, for a human-readable summary. */
    writes: string;
    /** Control actions never claim a field, so they are never skipped. */
    control?: boolean;
}

export const ACTION_SPECS: Record<string, ActionSpec> = {
    set_header: {
        label: "Set header",
        required: ["target", "name", "value"],
        optional: [],
        writes: "header:<name>",
    },
    remove_header: {
        label: "Remove header",
        required: ["target", "name"],
        optional: [],
        writes: "header:<name>",
    },
    set_body: {
        label: "Set body",
        required: ["target", "content"],
        optional: ["encoding"],
        writes: "body",
    },
    replace_body: {
        label: "Replace in body",
        required: ["target", "pattern", "replacement"],
        optional: [],
        writes: "body",
    },
    set_status: {
        label: "Set status code",
        required: ["status_code"],
        optional: ["reason"],
        writes: "response.status_code",
    },
    set_path: {
        label: "Set path",
        required: ["path"],
        optional: [],
        writes: "request.path",
    },
    set_method: {
        label: "Set method",
        required: ["method"],
        optional: [],
        writes: "request.method",
    },
    set_url: {
        label: "Set whole URL",
        required: ["url"],
        optional: [],
        writes: "request.url + request.path + request.query:*",
    },
    set_query: {
        label: "Set query parameter",
        required: ["name", "value"],
        optional: ["target"],
        writes: "query:<name>",
    },
    remove_query: {
        label: "Remove query parameter",
        required: ["name"],
        optional: ["target"],
        writes: "query:<name>",
    },
    delay: {
        label: "Delay",
        required: ["seconds"],
        optional: [],
        writes: "—",
    },
    intercept: {
        label: "Intercept (hold for a decision)",
        required: [],
        optional: [],
        writes: "—",
        control: true,
    },
    kill: {
        label: "Kill",
        required: [],
        optional: [],
        writes: "—",
        control: true,
    },
    cancel: {
        label: "Cancel",
        required: [],
        optional: [],
        writes: "—",
        control: true,
    },
    resume: {
        label: "Resume",
        required: [],
        optional: [],
        writes: "—",
        control: true,
    },
    mark: {
        label: "Mark",
        required: ["marker"],
        optional: [],
        writes: "—",
        control: true,
    },
    comment: {
        label: "Comment",
        required: ["comment"],
        optional: [],
        writes: "—",
        control: true,
    },
    tag: {
        label: "Tag",
        required: ["tags"],
        optional: [],
        writes: "—",
        control: true,
    },
};

export const ACTION_TYPES = Object.keys(ACTION_SPECS);

/** Which fields a given action type actually shows in the form. */
export function fieldsFor(type: string): ActionField[] {
    const spec = ACTION_SPECS[type];
    if (!spec) return [];
    return [...spec.required, ...spec.optional];
}

export function isBlank(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

/**
 * The first thing missing from one action, in the form's own words, or null
 * when it is complete. Mirrors the engine's validator so a save never bounces.
 */
export function validateAction(action: RuleAction): string | null {
    const spec = ACTION_SPECS[action.type];
    if (!spec) return `Unknown action type “${action.type}”`;
    for (const field of spec.required) {
        if (isBlank((action as unknown as Record<string, unknown>)[field])) {
            return `${spec.label}: “${FIELD_LABELS[field]}” is required`;
        }
    }
    if (action.type === "set_url" && action.url) {
        // The engine insists on an absolute URL: one replacement for scheme,
        // host, port, path and query.
        if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]/.test(action.url)) {
            return "Set whole URL: the URL must be absolute (scheme://host/…)";
        }
    }
    if (action.type === "set_status" && action.status_code != null) {
        const code = Number(action.status_code);
        if (!Number.isInteger(code) || code < 100 || code > 599) {
            return "Set status code: the code must be between 100 and 599";
        }
    }
    return null;
}

export function validateActions(actions: RuleAction[]): string | null {
    if (actions.length === 0) return "A rule needs at least one action.";
    for (const action of actions) {
        const problem = validateAction(action);
        if (problem) return problem;
    }
    return null;
}

export const FIELD_LABELS: Record<ActionField, string> = {
    target: "target",
    name: "name",
    value: "value",
    content: "content",
    encoding: "encoding",
    pattern: "pattern",
    replacement: "replacement",
    status_code: "status code",
    reason: "reason",
    path: "path",
    method: "method",
    url: "url",
    seconds: "seconds",
    marker: "marker",
    comment: "comment",
    tags: "tags",
};

/** One line per action, for the rule row and the preview. */
export function describeAction(action: RuleAction): string {
    const spec = ACTION_SPECS[action.type];
    const label = spec ? spec.label : action.type;
    switch (action.type) {
        case "set_header":
            return `Set ${action.target} header ${action.name}: ${action.value}`;
        case "remove_header":
            return `Remove ${action.target} header ${action.name}`;
        case "set_body":
            return `Set ${action.target} body${
                action.encoding === "base64" ? " (base64)" : ""
            }`;
        case "replace_body":
            return `Replace “${action.pattern}” in ${action.target} body`;
        case "set_status":
            return `Set status ${action.status_code}${
                action.reason ? ` ${action.reason}` : ""
            }`;
        case "set_path":
            return `Set path ${action.path}`;
        case "set_method":
            return `Set method ${action.method}`;
        case "set_url":
            return `Set URL ${action.url}`;
        case "set_query":
            return `Set query ${action.name}=${action.value}`;
        case "remove_query":
            return `Remove query ${action.name}`;
        case "delay":
            return `Delay ${action.seconds}s`;
        case "mark":
            return `Mark ${action.marker}`;
        case "comment":
            return `Comment ${action.comment}`;
        case "tag":
            return `Tag ${(action.tags ?? []).join(", ")}`;
        default:
            return label;
    }
}

export function describeActions(actions: RuleAction[] | undefined): string {
    if (!actions || actions.length === 0) return "No actions";
    return actions.map(describeAction).join(" · ");
}
