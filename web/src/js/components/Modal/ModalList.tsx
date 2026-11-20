import * as React from "react";
import ModalLayout from "./ModalLayout";
import OptionContent from "./OptionModal";
import ThrottleModalContent from "./ThrottleModal";
import CertificateGuideModalContent from "./CertificateGuideModal";
import PendingDecisionModalContent from "./PendingDecisionModal";

function OptionModal() {
    return (
        <ModalLayout>
            <OptionContent />
        </ModalLayout>
    );
}

function PendingDecisionModal() {
    return (
        <ModalLayout
            id="pendingDecisionModal"
            labelledBy="pending-decision-title"
        >
            <PendingDecisionModalContent />
        </ModalLayout>
    );
}

// Every modal goes through ModalLayout, which supplies the backdrop, the
// dialog role and the aria wiring. Rendering the content straight into the
// modal slot left these two without either, unlike OptionModal next to them.
function ThrottleModal() {
    return (
        <ModalLayout id="throttleModal" labelledBy="throttle-title">
            <ThrottleModalContent />
        </ModalLayout>
    );
}

function CertificateGuideModal() {
    return (
        <ModalLayout
            id="certificateGuideModal"
            labelledBy="certificate-guide-title"
        >
            <CertificateGuideModalContent />
        </ModalLayout>
    );
}

export default {
    OptionModal,
    ThrottleModal,
    CertificateGuideModal,
    PendingDecisionModal,
};
