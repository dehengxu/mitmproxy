import * as React from "react";
import CertificateGuideModal from "../../../components/Modal/CertificateGuideModal";
import { fireEvent, render, screen, waitFor } from "../../test-utils";
import { enableFetchMocks } from "jest-fetch-mock";

enableFetchMocks();

describe("CertificateGuideModal Component", () => {
    beforeEach(() => {
        fetchMock.resetMocks();
    });

    it("shows the certificate authority details", async () => {
        fetchMock.mockResponseOnce(
            JSON.stringify({
                available: true,
                subject: [["CN", "mitmproxy"]],
                sha256: "a".repeat(64),
                confdir: "/tmp/mitmproxy",
            }),
        );

        render(<CertificateGuideModal />);

        await waitFor(() => screen.getByText(/a{64}/));
        expect(screen.getByText(/CN=mitmproxy/)).toBeInTheDocument();
        expect(screen.getByText("/tmp/mitmproxy")).toBeInTheDocument();
    });

    it("switches between platforms", async () => {
        fetchMock.mockResponseOnce(JSON.stringify({ available: false }));

        render(<CertificateGuideModal />);

        await waitFor(() => screen.getByText("macOS"));
        expect(
            screen.getAllByText(/Keychain Access/).length,
        ).toBeGreaterThan(0);

        fireEvent.click(screen.getByText("Windows"));
        expect(
            screen.getByDisplayValue(/certutil -addstore/),
        ).toBeInTheDocument();
        expect(
            screen.queryByDisplayValue(/security add-trusted-cert/),
        ).toBeNull();
    });

    it("exports the CA certificate to a directory", async () => {
        fetchMock.mockResponseOnce(JSON.stringify({ available: false }));
        fetchMock.mockResponseOnce(
            JSON.stringify({
                path: "/tmp/certs",
                files: ["mitmproxy-ca-cert.pem"],
            }),
        );

        render(<CertificateGuideModal />);

        const input = (await screen.findByLabelText(
            "Export CA certificate to directory",
        )) as HTMLInputElement;
        expect(input).toBeTruthy();

        // the export button stays disabled until a path is given
        const button = screen.getByRole("button", { name: /Export/ });
        expect(button).toBeDisabled();

        fireEvent.change(input, { target: { value: "/tmp/certs" } });
        fireEvent.click(button);

        await waitFor(() =>
            screen.getByText(/Exported mitmproxy-ca-cert.pem/),
        );
        expect(fetchMock).toHaveBeenCalledWith(
            "./cert/export",
            expect.objectContaining({ method: "POST" }),
        );
    });
});
