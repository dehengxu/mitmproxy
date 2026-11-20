import * as React from "react";
import Modal from "../../../components/Modal/Modal";
import { render, screen, act } from "../../test-utils";
import { setActiveModal } from "../../../ducks/ui/modal";
import { enableFetchMocks } from "jest-fetch-mock";

enableFetchMocks();

/**
 * Every modal must come out of the same shell: a dialog with a backdrop and an
 * accessible name. Throttle and the certificate guide used to render their
 * content directly into the modal slot, so they had neither.
 */
beforeEach(() => {
    fetchMock.resetMocks();
    // Whatever the content asks for, an empty answer is enough here: this test
    // is about the shell around it.
    fetchMock.mockResponse(
        JSON.stringify({ available: false, pending: [], rules: [] }),
    );
});

describe.each([
    ["OptionModal", "Options"],
    ["ThrottleModal", "Throttle"],
    ["CertificateGuideModal", "Install Certificates"],
    ["PendingDecisionModal", "Pending decisions"],
])("%s shell", (modal, heading) => {
    it("renders as a dialog with a backdrop over the page", async () => {
        const { store } = render(<Modal />);

        await act(async () => {
            store.dispatch(setActiveModal(modal));
        });

        const dialog = await screen.findByRole("dialog");
        expect(dialog).toHaveAttribute("aria-modal", "true");
        // the backdrop is the dialog's sibling, covering the page behind it
        expect(
            dialog.parentElement!.querySelector(".modal-backdrop.is-visible"),
        ).toBeInTheDocument();
        // the dialog is named by its own heading, not by a stale id
        const labelledBy = dialog.getAttribute("aria-labelledby")!;
        expect(document.getElementById(labelledBy)).toBeInTheDocument();
        expect(document.getElementById(labelledBy)!.textContent).toContain(
            heading,
        );
    });
});
