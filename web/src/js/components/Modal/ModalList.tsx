import * as React from "react";
import ModalLayout from "./ModalLayout";
import OptionContent from "./OptionModal";
import ThrottleModalContent from "./ThrottleModal";
import CertificateGuideModalContent from "./CertificateGuideModal";

function OptionModal() {
    return (
        <ModalLayout>
            <OptionContent />
        </ModalLayout>
    );
}

export default {
    OptionModal,
    ThrottleModal: ThrottleModalContent,
    CertificateGuideModal: CertificateGuideModalContent,
};
