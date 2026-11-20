import * as React from "react";

type ModalLayoutProps = {
    children: React.ReactNode;
    /** Element id of the dialog; unique per modal, only one is mounted at a time. */
    id?: string;
    /** Id of the heading that names the dialog, for screen readers. */
    labelledBy?: string;
};

export default function ModalLayout({
    children,
    id = "optionsModal",
    labelledBy = "options",
}: ModalLayoutProps) {
    return (
        <div>
            <div className="modal-backdrop is-visible"></div>
            <div
                className="modal is-visible"
                id={id}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelledBy}
            >
                <div className="modal-dialog modal-lg" role="document">
                    <div className="modal-content">{children}</div>
                </div>
            </div>
        </div>
    );
}
