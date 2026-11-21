import * as React from "react";
import { connect, shallowEqual } from "react-redux";
import * as autoscroll from "./helpers/AutoScroll";
import type { VScroll } from "./helpers/VirtualScroll";
import { calcVScroll } from "./helpers/VirtualScroll";
import FlowTableHead from "./FlowTable/FlowTableHead";
import FlowRow from "./FlowTable/FlowRow";
import type { Flow } from "../flow";
import type { AppDispatch, RootState } from "../ducks";
import { isValidColumnName } from "../flow/utils";
import type { ColumnWidths } from "../ducks/ui/columnWidths";
import { commitColumnWidths, setColumnWidths } from "../ducks/ui/columnWidths";
import { groupByFocus } from "../ducks/ui/focus";

type FlowTableProps = {
    flowView: Flow[];
    /** Focused hosts, in focus order. Empty means no reordering. */
    focusHosts: string[];
    rowHeight: number;
    highlightedIds: Set<string>;
    selectedIds: Set<string>;
    onlySelectedId: string | false;
    firstSelectedId: string | undefined;
    displayColumnNames: string[];
    listIndex: Map<string, number>;
    columnWidths: ColumnWidths;
    dispatch: AppDispatch;
};

/**
 * One rendered row: either a group header or a flow. Focus turns the flat view
 * into groups (focused hosts first, everything else under Other); group headers
 * occupy a row of their own so the virtual scroll keeps counting in rowHeight
 * units. Without focus there are no headers and the list is exactly flowView.
 */
type TableRow =
    | { kind: "group"; group: string; focused: boolean; count: number }
    | { kind: "flow"; flow: Flow };

export function buildRows(flowView: Flow[], focusHosts: string[]): TableRow[] {
    if (focusHosts.length === 0) {
        return flowView.map((flow) => ({ kind: "flow" as const, flow }));
    }
    return groupByFocus(flowView, focusHosts).flatMap((g) => [
        {
            kind: "group" as const,
            group: g.group,
            focused: g.focused,
            count: g.flows.length,
        },
        ...g.flows.map((flow) => ({ kind: "flow" as const, flow })),
    ]);
}

type FlowTableState = {
    vScroll: VScroll;
    viewportTop: number;
};

export class PureFlowTable extends React.Component<
    FlowTableProps,
    FlowTableState
> {
    static defaultProps = {
        rowHeight: 32,
    };
    private viewport = React.createRef<HTMLDivElement>();
    private head = React.createRef<HTMLTableSectionElement>();

    constructor(props: FlowTableProps) {
        super(props);

        this.state = {
            vScroll: calcVScroll(),
            viewportTop: 0,
        };
        this.onViewportUpdate = this.onViewportUpdate.bind(this);
        this.onColumnResize = this.onColumnResize.bind(this);
        this.onColumnResizeEnd = this.onColumnResizeEnd.bind(this);
    }

    onColumnResize(widths: ColumnWidths) {
        this.props.dispatch(setColumnWidths(widths));
    }

    onColumnResizeEnd(widths: ColumnWidths) {
        this.props.dispatch(commitColumnWidths(widths));
    }

    componentDidMount() {
        window.addEventListener("resize", this.onViewportUpdate);
        this.onViewportUpdate();
    }

    componentWillUnmount() {
        window.removeEventListener("resize", this.onViewportUpdate);
    }

    getSnapshotBeforeUpdate() {
        return autoscroll.isAtBottom(this.viewport);
    }

    componentDidUpdate(
        prevProps: FlowTableProps,
        prevState: FlowTableState,
        snapshot: boolean,
    ) {
        void prevState;
        if (snapshot) {
            autoscroll.adjustScrollTop(this.viewport);
        }
        // Only recompute the virtual-scroll window when the flow list
        // or the row height actually changed. Other call sites still
        // drive onViewportUpdate as needed (componentDidMount, the
        // resize listener, the viewport onScroll, the post-scroll-into-
        // view call). Calling it unconditionally from here let
        // setState -> componentDidUpdate -> setState spin whenever
        // vScroll.end * rowHeight was less than scrollTop: the capped
        // Math.min(scrollTop, vScroll.end * rowHeight) stayed strictly
        // below scrollTop and the `state.viewportTop !== scrollTop`
        // setState condition kept re-firing.
        if (
            prevProps.flowView !== this.props.flowView ||
            // Focus folds group headers into the row list, so the virtual
            // scroll window has to be recomputed when it changes.
            prevProps.focusHosts !== this.props.focusHosts ||
            prevProps.rowHeight !== this.props.rowHeight ||
            // Widening past the viewport adds a horizontal scrollbar, which eats into the height the virtual scroll window is derived from.
            prevProps.columnWidths !== this.props.columnWidths
        ) {
            this.onViewportUpdate();
        }

        const { onlySelectedId } = this.props;

        const selectedPotentiallyOffscreenFlow =
            onlySelectedId && onlySelectedId !== prevProps.onlySelectedId;

        if (selectedPotentiallyOffscreenFlow) {
            const { rowHeight } = this.props;
            const firstSelectedIndex = this.rowIndexOf(this.props.firstSelectedId);
            const viewport = this.viewport.current!;
            const head = this.head.current;

            const headHeight = head ? head.offsetHeight : 0;

            const rowTop = firstSelectedIndex! * rowHeight + headHeight;
            const rowBottom = rowTop + rowHeight;

            const viewportTop = viewport.scrollTop;
            const viewportHeight = viewport.offsetHeight;

            // Account for pinned thead
            if (rowTop - headHeight < viewportTop) {
                viewport.scrollTop = rowTop - headHeight;
            } else if (rowBottom > viewportTop + viewportHeight) {
                viewport.scrollTop = rowBottom - viewportHeight;
            }
            this.onViewportUpdate();
        }
    }

    onViewportUpdate() {
        const viewport = this.viewport.current!;
        const viewportTop = viewport.scrollTop || 0;

        const vScroll = calcVScroll({
            viewportTop,
            viewportHeight: viewport.offsetHeight || 0,
            itemCount: this.rows().length,
            rowHeight: this.props.rowHeight,
        });

        if (
            this.state.viewportTop !== viewportTop ||
            !shallowEqual(this.state.vScroll, vScroll)
        ) {
            // the next rendered state may only have much lower number of rows compared to what the current
            // viewportHeight anticipates. To make sure that we update (almost) at once, we already constrain
            // the maximum viewportTop value. See https://github.com/mitmproxy/mitmproxy/pull/5658 for details.
            const newViewportTop = Math.min(
                viewportTop,
                vScroll.end * this.props.rowHeight,
            );
            this.setState({
                vScroll,
                viewportTop: newViewportTop,
            });
        }
    }

    /** Rows as rendered, i.e. with focus group headers folded in. */
    rows(): TableRow[] {
        return buildRows(this.props.flowView, this.props.focusHosts);
    }

    rowIndexOf(flowId: string | undefined): number | undefined {
        if (flowId === undefined) {
            return undefined;
        }
        const pos = this.rows().findIndex(
            (row) => row.kind === "flow" && row.flow.id === flowId,
        );
        return pos === -1 ? undefined : pos;
    }

    render() {
        const { vScroll, viewportTop } = this.state;
        const rows = this.rows();
        const {
            selectedIds,
            highlightedIds,
            displayColumnNames,
            listIndex,
            rowHeight,
            columnWidths,
        } = this.props;

        const orderedColumns = displayColumnNames
            .filter(isValidColumnName)
            .concat("quickactions");

        // One column has to stay flexible and take the space the others leave over, or the browser spreads that space over the widths the user dragged.
        // `path` does it until the user has pinned every other column, and the filler from then on: an absorber to the left of the drag would slide the boundary out from under the cursor.
        // The actions column never does, as it only shows its buttons over the row on hover.
        const fillerAbsorbsSlack = orderedColumns.every(
            (col) => col === "quickactions" || columnWidths[col],
        );

        return (
            <div
                className="flow-table"
                onScroll={this.onViewportUpdate}
                ref={this.viewport}
            >
                <table>
                    <colgroup>
                        {orderedColumns.map((colName) => (
                            <col
                                key={colName}
                                className={`col-${colName}`}
                                style={{ width: columnWidths[colName] }}
                            />
                        ))}
                        <col
                            className="col-filler"
                            style={{
                                width: fillerAbsorbsSlack ? "auto" : undefined,
                            }}
                        />
                    </colgroup>
                    <thead
                        ref={this.head}
                        style={{ transform: `translateY(${viewportTop}px)` }}
                    >
                        <FlowTableHead
                            onResize={this.onColumnResize}
                            onResizeEnd={this.onColumnResizeEnd}
                        />
                    </thead>
                    <tbody>
                        <tr style={{ height: vScroll.paddingTop }} />
                        {rows.slice(vScroll.start, vScroll.end).map((row) =>
                            row.kind === "group" ? (
                                <tr
                                    key={`group-${row.group}`}
                                    className={
                                        row.focused
                                            ? "flow-group-row focused"
                                            : "flow-group-row other"
                                    }
                                    style={{ height: rowHeight }}
                                >
                                    <td colSpan={orderedColumns.length + 1}>
                                        <span className="flow-group-name">
                                            {row.focused ? (
                                                row.group
                                            ) : (
                                                <em>Other</em>
                                            )}
                                        </span>
                                        <span className="flow-group-count">
                                            {row.count}
                                        </span>
                                    </td>
                                </tr>
                            ) : (
                                <FlowRow
                                    key={row.flow.id}
                                    flow={row.flow}
                                    selected={selectedIds.has(row.flow.id)}
                                    highlighted={highlightedIds.has(
                                        row.flow.id,
                                    )}
                                    displayColumnNames={displayColumnNames}
                                    rowNumber={listIndex.get(row.flow.id)!}
                                    height={rowHeight}
                                />
                            ),
                        )}
                        <tr style={{ height: vScroll.paddingBottom }} />
                    </tbody>
                </table>
            </div>
        );
    }
}

export default connect((state: RootState) => ({
    flowView: state.flows.view,
    focusHosts: state.ui.focus.hosts,
    highlightedIds: state.flows.highlightedIds,
    selectedIds: state.flows.selectedIds,
    onlySelectedId:
        state.flows.selected.length === 1 && state.flows.selected[0].id,
    firstSelectedId: state.flows.selected[0]?.id,
    // Fetch column names once at the table level; avoids N identical
    // useAppSelector subscriptions inside each FlowRow.
    displayColumnNames: state.options.web_columns,
    // Pass list index so the # column shows the original flow number
    // (list position), not the view position after sort/filter.
    listIndex: state.flows._listIndex,
    columnWidths: state.ui.columnWidths,
}))(PureFlowTable);
