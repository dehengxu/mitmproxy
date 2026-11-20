import type { ReactElement } from "react";
import React, { type JSX } from "react";
import { useAppDispatch } from "../../ducks";
import classnames from "classnames";
import type { ResourceType, sortFunctions } from "../../flow/utils";
import {
    canReplay,
    endTime,
    getTotalSize,
    startTime,
    getResourceType,
    mainPath,
    statusClass,
    statusCode,
    getMethod,
    getVersion,
} from "../../flow/utils";
import { formatSize, formatTimeDelta, formatTimeStamp } from "../../utils";
import * as flowActions from "../../ducks/flows";
import { decideFlows } from "../../ducks/rewrite";
import type { Flow } from "../../flow";
import type { IconName } from "../common/Icon";
import Icon from "../common/Icon";
import Badge from "../common/Badge";

type FlowColumnProps = {
    flow: Flow;
    rowNumber: number;
};

interface FlowColumn {
    (props: FlowColumnProps): JSX.Element;

    headerName: string; // Shown in the UI
}

export const tls: FlowColumn = ({ flow }) => {
    const secure = flow.client_conn.tls_established;
    return (
        <td
            className={classnames(
                "col-tls",
                secure ? "col-tls-https" : "col-tls-http",
            )}
            title={secure ? "TLS encrypted" : "Plaintext"}
        />
    );
};
tls.headerName = "";

export const index: FlowColumn = ({ rowNumber }) => {
    return <td className="col-index">{rowNumber + 1}</td>;
};
index.headerName = "#";

const RESOURCE_ICONS: Record<ResourceType, IconName> = {
    plain: "file",
    html: "code",
    js: "braces",
    css: "palette",
    image: "image",
    "not-modified": "fileCheck",
    redirect: "redirect",
    websocket: "swap",
    tcp: "cable",
    udp: "send",
    dns: "globe",
    quic: "zap",
};

export const icon: FlowColumn = ({ flow }) => {
    const resourceType = getResourceType(flow);
    return (
        <td className="col-icon" title={resourceType}>
            <Icon name={RESOURCE_ICONS[resourceType]} />
        </td>
    );
};
icon.headerName = "";

export const path: FlowColumn = ({ flow }) => {
    let err;
    if (flow.error) {
        if (flow.error.msg === "Connection killed.") {
            err = (
                <Icon
                    name="close"
                    className="float-right"
                    title="Connection killed"
                />
            );
        } else {
            err = (
                <Icon
                    name="warning"
                    className="float-right"
                    title={flow.error.msg}
                />
            );
        }
    }
    return (
        <td className="col-path">
            {flow.is_replay === "request" && (
                <Icon
                    name="replay"
                    className="float-right"
                    title="Replayed request"
                />
            )}
            {flow.intercepted && (
                <Icon
                    name="pause"
                    className="float-right"
                    title="Intercepted — waiting to resume"
                />
            )}
            {err}
            <span className="marker float-right">{flow.marked}</span>
            {mainPath(flow)}
        </td>
    );
};
path.headerName = "Path";

export const method: FlowColumn = ({ flow }) => (
    <td className="col-method">
        <Badge className="method-badge">{getMethod(flow)}</Badge>
    </td>
);
method.headerName = "Method";

export const version: FlowColumn = ({ flow }) => (
    <td className="col-http-version">{getVersion(flow)}</td>
);
version.headerName = "Version";

export const status: FlowColumn = ({ flow }) => {
    const code = statusCode(flow);
    if (!flow.intercepted) {
        if (code === undefined || code === "")
            return <td className="col-status" />;
        return (
            <td className="col-status">
                <Badge
                    className={classnames("status-badge", statusClass(code))}
                >
                    {code}
                </Badge>
            </td>
        );
    }

    // A flow a breakpoint holds back has not settled yet. The status column is
    // where people look for a flow's state, so it carries the marker: the word
    // Pending when there is no status code yet, and a compact pause icon next to
    // the code when the flow was held before the response was rewritten.
    return (
        <td className="col-status">
            {code !== undefined && code !== "" && (
                <>
                    <Badge
                        className={classnames(
                            "status-badge",
                            statusClass(code),
                        )}
                    >
                        {code}
                    </Badge>
                    &nbsp;
                </>
            )}
            <Badge
                className={classnames("status-badge suspended-badge", {
                    "suspended-badge-compact": code !== undefined && code !== "",
                })}
                title="Waiting for a decision: execute, abort or cancel"
                aria-label="Waiting for a decision"
            >
                <Icon name="pause" />
                {(code === undefined || code === "") && <>&nbsp;Pending</>}
            </Badge>
        </td>
    );
};
status.headerName = "Status";

export const size: FlowColumn = ({ flow }) => {
    return <td className="col-size">{formatSize(getTotalSize(flow))}</td>;
};
size.headerName = "Size";

export const time: FlowColumn = ({ flow }) => {
    const start = startTime(flow);
    const end = endTime(flow);
    return (
        <td className="col-time">
            {start && end ? formatTimeDelta(1000 * (end - start)) : "..."}
        </td>
    );
};
time.headerName = "Time";

export const timestamp: FlowColumn = ({ flow }) => {
    const start = startTime(flow);
    return (
        <td className="col-timestamp">
            {start ? formatTimeStamp(start) : "..."}
        </td>
    );
};
timestamp.headerName = "Start time";

export const quickactions: FlowColumn = ({ flow }) => {
    const dispatch = useAppDispatch();

    let resume_or_replay: ReactElement<any> | null = null;
    if (flow.intercepted) {
        // Same three outcomes as the flow menu, so a held flow can be settled
        // without leaving the table.
        // The three links stay direct children of the cell's div: the table's
        // layout sizes and spaces them there, and a wrapper would collapse it.
        resume_or_replay = (
            <>
                <a
                    href="#"
                    className="quickaction"
                    title="Execute: apply the edits and let the flow through"
                    onClick={() => dispatch(decideFlows("execute", [flow]))}
                >
                    <Icon name="resume" className="text-success" />
                </a>
                <a
                    href="#"
                    className="quickaction"
                    title="Abort: kill the flow, nothing is forwarded to the client"
                    onClick={() => dispatch(decideFlows("abort", [flow]))}
                >
                    <Icon name="abort" className="text-danger" />
                </a>
                <a
                    href="#"
                    className="quickaction"
                    title="Cancel: drop the edits and pass the flow through untouched"
                    onClick={() => dispatch(decideFlows("cancel", [flow]))}
                >
                    <Icon name="undo" className="text-warning" />
                </a>
            </>
        );
    } else if (canReplay(flow)) {
        resume_or_replay = (
            <a
                href="#"
                className="quickaction"
                onClick={() => dispatch(flowActions.replay([flow]))}
            >
                <Icon name="replay" className="text-primary" />
            </a>
        );
    }

    return (
        <td className="col-quickactions">
            {resume_or_replay ? <div>{resume_or_replay}</div> : <></>}
        </td>
    );
};
quickactions.headerName = "";

export const comment: FlowColumn = ({ flow }) => {
    const text = flow.comment;
    return <td className="col-comment">{text}</td>;
};
comment.headerName = "Comment";

const FlowColumns: { [key in keyof typeof sortFunctions]: FlowColumn } = {
    // parsed by web/gen/web_columns
    icon,
    index,
    method,
    version,
    path,
    quickactions,
    size,
    status,
    time,
    timestamp,
    tls,
    comment,
};
export default FlowColumns;
