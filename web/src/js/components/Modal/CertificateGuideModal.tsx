import * as React from "react";
import Icon from "../common/Icon";
import * as modalAction from "../../ducks/ui/modal";
import { useAppDispatch } from "../../ducks";
import { copyToClipboard, fetchApi } from "../../utils";

/**
 * Multi-platform guide for trusting the mitmproxy CA certificate (REQ-2.1).
 *
 * This modal never installs anything on the machine - it only shows the steps
 * and the commands for each platform, and it can export the public certificate
 * files to a directory on the mitmproxy host.
 */

type Platform = {
    id: string;
    label: string;
    steps: string[];
    commands: { label: string; command: string }[];
};

const PLATFORMS: Platform[] = [
    {
        id: "macos",
        label: "macOS",
        steps: [
            "Download mitmproxy-ca-cert.pem (or export it to a directory on the mitmproxy host).",
            "Open it with Keychain Access and add it to the login keychain.",
            "In Keychain Access, double-click the certificate, set “Trust” to “Always Trust”.",
        ],
        commands: [
            {
                label: "Add to the system keychain (Terminal)",
                command:
                    "sudo security add-trusted-cert -d -r trustRoot " +
                    "-k /Library/Keychains/System.keychain mitmproxy-ca-cert.pem",
            },
        ],
    },
    {
        id: "ios",
        label: "iOS",
        steps: [
            "Send mitmproxy-ca-cert.cer to the device and install the profile.",
            "Enable it: Settings → General → About → Certificate Trust Settings.",
            "Turn on full trust for the mitmproxy certificate.",
        ],
        commands: [],
    },
    {
        id: "android",
        label: "Android",
        steps: [
            "Copy mitmproxy-ca-cert.cer to the device.",
            "Settings → Security → Encryption & credentials → Install a certificate → CA certificate.",
            "Note: since Android 7, user-installed CAs are not trusted by apps unless the app opts in via network_security_config.",
        ],
        commands: [],
    },
    {
        id: "windows",
        label: "Windows",
        steps: [
            "Download mitmproxy-ca-cert.p12 and import it.",
            "Import into “Trusted Root Certification Authorities” of the Local Machine store.",
        ],
        commands: [
            {
                label: "Import into the machine store (Command Prompt as admin)",
                command:
                    'certutil -addstore -f "ROOT" mitmproxy-ca-cert.p12',
            },
        ],
    },
    {
        id: "linux",
        label: "Linux",
        steps: [
            "Copy mitmproxy-ca-cert.pem to /usr/local/share/ca-certificates/.",
            "Run update-ca-certificates (or update-ca-trust on Fedora/RHEL).",
        ],
        commands: [
            {
                label: "Install into the system trust store",
                command:
                    "sudo cp mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/mitmproxy.crt " +
                    "&& sudo update-ca-certificates",
            },
        ],
    },
];

type CertInfo = {
    available: boolean;
    subject?: string[][];
    sha256?: string;
    confdir?: string;
};

export default function CertificateGuideModal() {
    const dispatch = useAppDispatch();
    const [platform, setPlatform] = React.useState(PLATFORMS[0].id);
    const [info, setInfo] = React.useState<CertInfo | null>(null);
    const [exportPath, setExportPath] = React.useState("");
    const [exportResult, setExportResult] = React.useState<string | null>(null);
    const [exportError, setExportError] = React.useState<string | null>(null);

    React.useEffect(() => {
        fetchApi("/cert.json")
            .then((response) => response.json())
            .then((data) => setInfo(data))
            .catch(() => setInfo({ available: false }));
    }, []);

    const active = PLATFORMS.find((p) => p.id === platform) || PLATFORMS[0];

    const doExport = () => {
        setExportError(null);
        setExportResult(null);
        fetchApi.post("/cert/export", { path: exportPath })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then((data) =>
                setExportResult(
                    `Exported ${data.files.join(", ")} to ${data.path}`,
                ),
            )
            .catch((e) => setExportError(`Export failed: ${e.message}`));
    };

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
                    <h4>Install Certificates</h4>
                </div>
            </div>

            <div className="modal-body">
                <div className="help-block text-small">
                    mitmproxy intercepts HTTPS traffic with its own
                    certificate authority. Trust the CA certificate on the
                    client to avoid TLS errors. Nothing is installed
                    automatically - follow the steps for your platform.
                </div>

                {info?.available && (
                    <div className="form-row">
                        <div className="col-12">
                            <label className="control-label">
                                Certificate authority
                            </label>
                            <div className="help-block text-small">
                                <div>
                                    <strong>SHA-256:</strong> {info.sha256}
                                </div>
                                <div>
                                    <strong>Subject:</strong>{" "}
                                    {(info.subject || [])
                                        .map((part) => part.join("="))
                                        .join(", ")}
                                </div>
                                <div>
                                    <strong>CA directory:</strong>{" "}
                                    {info.confdir}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <ul className="nav nav-tabs">
                    {PLATFORMS.map((p) => (
                        <li
                            key={p.id}
                            className={p.id === active.id ? "active" : ""}
                        >
                            <a
                                href="#"
                                onClick={(e) => {
                                    e.preventDefault();
                                    setPlatform(p.id);
                                }}
                            >
                                {p.label}
                            </a>
                        </li>
                    ))}
                </ul>

                <div className="tab-content">
                    <ol>
                        {active.steps.map((step, i) => (
                            <li key={i}>{step}</li>
                        ))}
                    </ol>

                    {active.commands.map((cmd) => (
                        <div className="form-row" key={cmd.command}>
                            <div className="col-12">
                                <label className="control-label">
                                    {cmd.label}
                                </label>
                                <div className="input-group">
                                    <input
                                        type="text"
                                        className="form-control"
                                        readOnly
                                        value={cmd.command}
                                        aria-label={cmd.label}
                                    />
                                    <span className="input-group-btn">
                                        <button
                                            type="button"
                                            className="btn btn-default"
                                            onClick={() =>
                                                copyToClipboard(
                                                    Promise.resolve(cmd.command),
                                                )
                                            }
                                        >
                                            <Icon name="copy" />
                                            &nbsp;Copy
                                        </button>
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="form-row">
                    <div className="col-12">
                        <label
                            className="control-label"
                            htmlFor="cert_export_path"
                        >
                            Export CA certificate to directory
                        </label>
                        <div className="help-block text-small">
                            Writes the public certificate files
                            (mitmproxy-ca-cert.pem, .cer, .p12) to a
                            directory on the mitmproxy host. The private key is
                            never exported.
                        </div>
                        <div className="input-group">
                            <input
                                type="text"
                                id="cert_export_path"
                                className="form-control"
                                placeholder="/tmp/mitmproxy-ca"
                                value={exportPath}
                                onChange={(e) => setExportPath(e.target.value)}
                            />
                            <span className="input-group-btn">
                                <button
                                    type="button"
                                    className="btn btn-default"
                                    disabled={!exportPath}
                                    onClick={doExport}
                                >
                                    <Icon name="download" />
                                    &nbsp;Export
                                </button>
                            </span>
                        </div>
                        {exportResult && (
                            <div className="help-block text-small text-success">
                                {exportResult}
                            </div>
                        )}
                        {exportError && (
                            <div className="help-block text-small text-danger">
                                {exportError}
                            </div>
                        )}
                    </div>
                </div>

                <div className="form-row">
                    <div className="col-12">
                        <a
                            href="http://mitm.it/"
                            target="_blank"
                            rel="noreferrer"
                        >
                            <Icon name="external" />
                            &nbsp;Official installation instructions
                        </a>
                    </div>
                </div>
            </div>

            <div className="modal-footer"></div>
        </div>
    );
}
