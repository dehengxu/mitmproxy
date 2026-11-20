import * as React from "react";
import Icon from "../common/Icon";
import * as modalAction from "../../ducks/ui/modal";
import * as optionsActions from "../../ducks/options";
import { useAppDispatch, useAppSelector } from "../../ducks";

/**
 * Throttle emulates a slow network connection (Charles' "Throttle" feature).
 *
 * The kernel side is already in place: `mitmproxy/addons/throttle.py` registers the
 * two options below, and the pacing itself happens in the proxy core. This modal is
 * only the front-end entry point for them.
 */
export default function ThrottleModal() {
    const dispatch = useAppDispatch();
    const bytesPerSec = useAppSelector(
        (state) => state.options.throttle_bytes_per_sec,
    );
    const latencyMs = useAppSelector(
        (state) => state.options.throttle_latency_ms,
    );

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
                    <h4>Throttle</h4>
                </div>
            </div>

            <div className="modal-body">
                <div className="form-horizontal">
                    <div className="form-row">
                        <div className="col-6">
                            <label
                                className="control-label"
                                htmlFor="throttle_bytes_per_sec"
                            >
                                Bandwidth
                            </label>
                            <div className="help-block text-small">
                                Limit the transfer rate of response bodies.
                                0 (the default) means no limit.
                            </div>
                        </div>
                        <div className="col-6">
                            <input
                                type="number"
                                id="throttle_bytes_per_sec"
                                min={0}
                                value={bytesPerSec}
                                onChange={(e) =>
                                    dispatch(
                                        optionsActions.update(
                                            "throttle_bytes_per_sec",
                                            Math.max(
                                                0,
                                                parseInt(e.target.value) || 0,
                                            ),
                                        ),
                                    )
                                }
                            />
                            <span className="text-muted"> bytes/second</span>
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="col-6">
                            <label
                                className="control-label"
                                htmlFor="throttle_latency_ms"
                            >
                                Latency
                            </label>
                            <div className="help-block text-small">
                                Add a fixed latency to every request.
                                0 (the default) means no artificial latency.
                            </div>
                        </div>
                        <div className="col-6">
                            <input
                                type="number"
                                id="throttle_latency_ms"
                                min={0}
                                value={latencyMs}
                                onChange={(e) =>
                                    dispatch(
                                        optionsActions.update(
                                            "throttle_latency_ms",
                                            Math.max(
                                                0,
                                                parseInt(e.target.value) || 0,
                                            ),
                                        ),
                                    )
                                }
                            />
                            <span className="text-muted"> milliseconds</span>
                        </div>
                    </div>

                    {bytesPerSec > 0 && (
                        <div className="form-row">
                            <div className="col-12">
                                <div className="help-block text-small text-warning">
                                    A bandwidth limit turns on response streaming,
                                    so response bodies are no longer stored in
                                    the flow unless &quot;store_streamed_bodies&quot;
                                    is enabled as well.
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="modal-footer"></div>
        </div>
    );
}
