"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatOneDReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, type Result } from "@zxing/library";

type Product = {
    barcode: string;
    name: string;
    price: number;
    stock: number;
    sku: string;
};

type ScannedItem = {
    barcode: string;
    format: string;
    product: Product | null;
    quantity: number;
    scannedAt: string;
};

type NumericCapability = {
    min?: number;
    max?: number;
};

type BarcodeTrackCapabilities = MediaTrackCapabilities & {
    torch?: boolean;
    zoom?: NumericCapability;
    focusMode?: string[];
};

type BarcodeTrackConstraintSet = MediaTrackConstraintSet & {
    torch?: boolean;
    zoom?: number;
    focusMode?: string;
};

function toMediaTrackConstraintSet(
    constraintSet: BarcodeTrackConstraintSet
): MediaTrackConstraintSet {
    return constraintSet as unknown as MediaTrackConstraintSet;
}

type CameraSetup = {
    label: string;
    torchAvailable: boolean;
};

const PRODUCTS: Record<string, Product> = {
    "8901234567890": {
        barcode: "8901234567890",
        name: "Coca Cola 250ml",
        price: 35,
        stock: 24,
        sku: "DRK-001",
    },
    "842251152516": {
        barcode: "842251152516",
        name: "Good Luck Book",
        price: 120,
        stock: 12,
        sku: "SOAP-005",
    },
    "1234567890128": {
        barcode: "1234567890128",
        name: "Lux Soap",
        price: 55,
        stock: 12,
        sku: "SOAP-002",
    },
    "9876543210987": {
        barcode: "9876543210987",
        name: "Pran Biscuit",
        price: 20,
        stock: 48,
        sku: "BIS-003",
    },
};

const BARCODE_FORMATS = [
    BarcodeFormat.CODABAR,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.CODE_128,
    BarcodeFormat.EAN_8,
    BarcodeFormat.EAN_13,
    BarcodeFormat.ITF,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
];

const BARCODE_HINTS = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS],
    [DecodeHintType.TRY_HARDER, true],
]);

const READER_OPTIONS = {
    delayBetweenScanAttempts: 60,
    delayBetweenScanSuccess: 1200,
    tryPlayVideoTimeout: 5000,
};

const BARCODE_RESET_DELAY_MS = 450;

const REAR_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
    audio: false,
    video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        aspectRatio: { ideal: 1.7777777778 },
    },
};

const FALLBACK_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
    audio: false,
    video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
    },
};

function getCameraErrorMessage(error: unknown) {
    if (typeof window !== "undefined" && !window.isSecureContext) {
        return "Camera access on phones requires HTTPS or localhost. If you opened this site by IP over HTTP, the browser will block the camera.";
    }

    if (error instanceof DOMException) {
        switch (error.name) {
            case "NotAllowedError":
                return "Camera permission was blocked. Allow camera access in the browser and try again.";
            case "NotFoundError":
                return "No camera was found on this device.";
            case "NotReadableError":
                return "The camera is already in use by another app or browser tab.";
            case "OverconstrainedError":
                return "The preferred back camera is not available on this device.";
            case "SecurityError":
                return "This page is not allowed to access the camera. Open it over HTTPS or localhost.";
            default:
                break;
        }
    }

    return error instanceof Error ? error.message : "Failed to start the camera.";
}

function getActiveVideoTrack(videoElement: HTMLVideoElement | null) {
    const stream = videoElement?.srcObject;
    if (!(stream instanceof MediaStream)) {
        return null;
    }

    return stream.getVideoTracks()[0] ?? null;
}

function getTrackCapabilities(track: MediaStreamTrack): BarcodeTrackCapabilities {
    if (typeof track.getCapabilities !== "function") {
        return {};
    }

    return track.getCapabilities() as BarcodeTrackCapabilities;
}

function getPreferredFocusMode(capabilities: BarcodeTrackCapabilities) {
    if (!Array.isArray(capabilities.focusMode)) {
        return null;
    }

    if (capabilities.focusMode.includes("continuous")) {
        return "continuous";
    }

    if (capabilities.focusMode.includes("single-shot")) {
        return "single-shot";
    }

    return null;
}

function getPreferredZoom(capabilities: BarcodeTrackCapabilities) {
    const zoom = capabilities.zoom;
    if (!zoom || typeof zoom.max !== "number") {
        return null;
    }

    const minZoom = zoom.min ?? 1;
    const maxZoom = zoom.max;

    if (maxZoom <= minZoom) {
        return null;
    }

    return Math.min(maxZoom, Math.max(minZoom, 1.8));
}

async function configureTrackForBarcodeCapture(
    videoElement: HTMLVideoElement | null,
    controls: IScannerControls | null
): Promise<CameraSetup> {
    const track = getActiveVideoTrack(videoElement);
    if (!track) {
        return {
            label: "Camera",
            torchAvailable: Boolean(controls?.switchTorch),
        };
    }

    const capabilities = getTrackCapabilities(track);
    const focusMode = getPreferredFocusMode(capabilities);
    const zoom = getPreferredZoom(capabilities);

    if (focusMode) {
        try {
            await track.applyConstraints({
                advanced: [toMediaTrackConstraintSet({ focusMode })],
            });
        } catch {
            // ignore unsupported focus tuning
        }
    }

    if (zoom !== null) {
        try {
            await track.applyConstraints({
                advanced: [toMediaTrackConstraintSet({ zoom })],
            });
        } catch {
            // ignore unsupported zoom tuning
        }
    }

    return {
        label: track.label || "Camera",
        torchAvailable: Boolean(capabilities.torch || controls?.switchTorch),
    };
}

async function setTrackTorch(videoElement: HTMLVideoElement | null, enabled: boolean) {
    const track = getActiveVideoTrack(videoElement);
    if (!track) {
        return false;
    }

    try {
        await track.applyConstraints({
            advanced: [toMediaTrackConstraintSet({ torch: enabled })],
        });
        return true;
    } catch {
        return false;
    }
}

export default function BarcodeDemoPage() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const readerRef = useRef<BrowserMultiFormatOneDReader | null>(null);
    const controlsRef = useRef<IScannerControls | null>(null);
    const activeBarcodeRef = useRef<string | null>(null);
    const clearActiveBarcodeTimeoutRef = useRef<number | null>(null);
    const successFlashTimeoutRef = useRef<number | null>(null);
    const scannedItemsContainerRef = useRef<HTMLDivElement | null>(null);

    const [isStarting, setIsStarting] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const [isSuccessFlashActive, setIsSuccessFlashActive] = useState(false);
    const [scanText, setScanText] = useState("");
    const [scanFormat, setScanFormat] = useState("");
    const [lastScannedAt, setLastScannedAt] = useState("");
    const [product, setProduct] = useState<Product | null>(null);
    const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
    const [scanEventCount, setScanEventCount] = useState(0);
    const [error, setError] = useState("");
    const [cameraLabel, setCameraLabel] = useState("");
    const [origin, setOrigin] = useState("");
    const [isSecureOrigin, setIsSecureOrigin] = useState<boolean | null>(null);
    const [isTorchAvailable, setIsTorchAvailable] = useState(false);
    const [isTorchOn, setIsTorchOn] = useState(false);

    useEffect(() => {
        setOrigin(window.location.origin);
        setIsSecureOrigin(window.isSecureContext);
        const videoElement = videoRef.current;

        return () => {
            if (clearActiveBarcodeTimeoutRef.current !== null) {
                window.clearTimeout(clearActiveBarcodeTimeoutRef.current);
            }

            if (successFlashTimeoutRef.current !== null) {
                window.clearTimeout(successFlashTimeoutRef.current);
            }

            try {
                controlsRef.current?.stop();
            } catch {
                // ignore cleanup error
            }

            const stream = videoElement?.srcObject;
            if (stream instanceof MediaStream) {
                stream.getTracks().forEach((track) => track.stop());
            }

            if (videoElement) {
                videoElement.pause();
                videoElement.srcObject = null;
            }

            controlsRef.current = null;
            activeBarcodeRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!scanEventCount) {
            return;
        }

        scannedItemsContainerRef.current?.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    }, [scanEventCount]);

    function clearPendingBarcodeReset() {
        if (clearActiveBarcodeTimeoutRef.current === null) {
            return;
        }

        window.clearTimeout(clearActiveBarcodeTimeoutRef.current);
        clearActiveBarcodeTimeoutRef.current = null;
    }

    function scheduleBarcodeReset() {
        clearPendingBarcodeReset();
        clearActiveBarcodeTimeoutRef.current = window.setTimeout(() => {
            activeBarcodeRef.current = null;
            clearActiveBarcodeTimeoutRef.current = null;
        }, BARCODE_RESET_DELAY_MS);
    }

    function clearSuccessFlashTimer() {
        if (successFlashTimeoutRef.current === null) {
            return;
        }

        window.clearTimeout(successFlashTimeoutRef.current);
        successFlashTimeoutRef.current = null;
    }

    function resetSuccessFlash() {
        clearSuccessFlashTimer();
        setIsSuccessFlashActive(false);
    }

    function triggerSuccessFlash() {
        clearSuccessFlashTimer();
        setIsSuccessFlashActive(true);
        successFlashTimeoutRef.current = window.setTimeout(() => {
            setIsSuccessFlashActive(false);
            successFlashTimeoutRef.current = null;
        }, 850);
    }

    function handleScanResult(result: Result | undefined, _error: unknown, controls: IScannerControls) {
        controlsRef.current = controls;

        if (!result) {
            scheduleBarcodeReset();
            return;
        }

        const text = result.getText().trim();
        if (!text) {
            return;
        }

        clearPendingBarcodeReset();

        if (activeBarcodeRef.current === text) {
            return;
        }

        activeBarcodeRef.current = text;
        const now = Date.now();
        const format = BarcodeFormat[result.getBarcodeFormat()] || "BARCODE";
        const scannedAt = new Date(now).toLocaleTimeString();

        setScanText(text);
        setScanFormat(format);
        setLastScannedAt(scannedAt);

        const foundProduct = PRODUCTS[text] || null;
        setProduct(foundProduct);
        setError("");
        setScanEventCount((current) => current + 1);
        setScannedItems((current) => {
            const existing = current.find((item) => item.barcode === text);

            return [
                {
                    barcode: text,
                    format,
                    product: foundProduct,
                    quantity: (existing?.quantity ?? 0) + 1,
                    scannedAt,
                },
                ...current.filter((item) => item.barcode !== text),
            ];
        });

        if (foundProduct) {
            triggerSuccessFlash();
            return;
        }

        resetSuccessFlash();
    }

    async function startScanner() {
        try {
            setError("");
            setIsStarting(true);
            setIsTorchOn(false);
            setIsTorchAvailable(false);
            resetSuccessFlash();
            clearPendingBarcodeReset();
            activeBarcodeRef.current = null;

            if (!videoRef.current) {
                setError("Video preview element was not found.");
                return;
            }

            if (!window.isSecureContext) {
                setError("Camera access on phones requires HTTPS or localhost. If you opened this site by IP over HTTP, the browser will block the camera.");
                return;
            }

            if (!navigator.mediaDevices?.getUserMedia) {
                setError("This browser does not support camera access.");
                return;
            }

            stopScanner();

            if (!readerRef.current) {
                readerRef.current = new BrowserMultiFormatOneDReader(BARCODE_HINTS, READER_OPTIONS);
            }

            setIsScanning(true);

            try {
                controlsRef.current = await readerRef.current.decodeFromConstraints(
                    REAR_CAMERA_CONSTRAINTS,
                    videoRef.current,
                    handleScanResult
                );
            } catch (error) {
                const shouldRetryWithAnyCamera =
                    error instanceof DOMException &&
                    (error.name === "OverconstrainedError" || error.name === "NotFoundError");

                if (!shouldRetryWithAnyCamera) {
                    throw error;
                }

                controlsRef.current = await readerRef.current.decodeFromConstraints(
                    FALLBACK_CAMERA_CONSTRAINTS,
                    videoRef.current,
                    handleScanResult
                );
            }

            const cameraSetup = await configureTrackForBarcodeCapture(videoRef.current, controlsRef.current);
            setCameraLabel(cameraSetup.label);
            setIsTorchAvailable(cameraSetup.torchAvailable);
        } catch (err) {
            setError(getCameraErrorMessage(err));
            setIsScanning(false);
            setCameraLabel("");
            setIsTorchAvailable(false);
            setIsTorchOn(false);
        }
        finally {
            setIsStarting(false);
        }
    }

    function stopScanner() {
        try {
            controlsRef.current?.stop();
        } catch {
            // ignore cleanup error
        }

        const stream = videoRef.current?.srcObject;
        if (stream instanceof MediaStream) {
            stream.getTracks().forEach((track) => track.stop());
        }

        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.srcObject = null;
        }

        controlsRef.current = null;
        clearPendingBarcodeReset();
        activeBarcodeRef.current = null;
        resetSuccessFlash();
        setIsScanning(false);
        setIsTorchAvailable(false);
        setIsTorchOn(false);
    }

    function resetAll() {
        stopScanner();
        activeBarcodeRef.current = null;
        setScanText("");
        setScanFormat("");
        setLastScannedAt("");
        setProduct(null);
        setScannedItems([]);
        setScanEventCount(0);
        setError("");
        setCameraLabel("");
    }

    function updateItemQuantity(barcode: string, delta: number) {
        setScannedItems((current) =>
            current.flatMap((item) => {
                if (item.barcode !== barcode) {
                    return [item];
                }

                const nextQuantity = item.quantity + delta;
                if (nextQuantity <= 0) {
                    return [];
                }

                return [
                    {
                        ...item,
                        quantity: nextQuantity,
                    },
                ];
            })
        );
    }

    async function toggleTorch() {
        const nextTorchState = !isTorchOn;

        try {
            if (controlsRef.current?.switchTorch) {
                await controlsRef.current.switchTorch(nextTorchState);
            } else {
                const torchApplied = await setTrackTorch(videoRef.current, nextTorchState);
                if (!torchApplied) {
                    throw new Error("Torch control is not available on this device.");
                }
            }

            setError("");
            setIsTorchOn(nextTorchState);
        } catch (torchError) {
            setError(
                torchError instanceof Error
                    ? torchError.message
                    : "Torch control is not available on this device."
            );
        }
    }

    const latestScan = scanText
        ? scannedItems.find((item) => item.barcode === scanText) ?? null
        : null;
    const totalScannedItems = scannedItems.reduce((total, item) => total + item.quantity, 0);

    return (
        <main className="min-h-screen bg-white p-6 text-black">
            <div className="mx-auto max-w-3xl space-y-6">
                <div className="flex items-start justify-between gap-3">
                    <h1 className="text-2xl font-bold">Barcode Scanner Demo</h1>
                    <button
                        type="button"
                        onClick={() => setIsHelpOpen((current) => !current)}
                        aria-expanded={isHelpOpen}
                        aria-controls="scanner-help"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-lg font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950"
                    >
                        <span className="sr-only">
                            {isHelpOpen ? "Hide scanner instructions" : "Show scanner instructions"}
                        </span>
                        ?
                    </button>
                </div>

                {isSecureOrigin === false ? (
                    <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                        <p className="font-semibold">Camera is blocked on this connection</p>
                        <p className="text-sm">
                            This page is running from <span className="font-mono">{origin}</span>, which is not a secure origin. Desktop Chrome works on <span className="font-mono">localhost</span>, but phones usually open the dev server by IP address and browsers block camera access there unless it is HTTPS.
                        </p>
                        <p className="text-sm">
                            Start the app with <span className="font-mono">npm run dev:phone</span>, then open the printed <span className="font-mono">https://...</span> address on your phone.
                        </p>
                        <p className="text-sm">
                            If the phone still warns about the certificate, trust the mkcert root CA on the phone or use an HTTPS tunnel.
                        </p>
                    </div>
                ) : null}

                {isHelpOpen ? (
                    <div
                        id="scanner-help"
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
                    >
                        Hold the barcode inside the center strip, keep some distance, and turn on
                        the torch in low light. Start the camera once, keep scanning products, and
                        stop it manually when you are done. Only one-dimensional barcodes are
                        decoded.
                    </div>
                ) : null}

                <div className="relative overflow-hidden rounded-2xl border bg-gray-100">
                    <video
                        ref={videoRef}
                        className="aspect-video w-full bg-black object-cover"
                        autoPlay
                        muted
                        playsInline
                    />

                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-5">
                        <div className="w-full max-w-xl">
                            <div
                                className={`h-24 rounded-2xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.30)] transition-all duration-200 ${
                                    isSuccessFlashActive
                                        ? "animate-pulse border-emerald-400 bg-emerald-400/10 shadow-[0_0_0_9999px_rgba(16,185,129,0.18)]"
                                        : "border-white/90"
                                }`}
                            />
                            <p className="mt-3 text-center text-xs font-semibold uppercase tracking-[0.35em] text-white/90">
                                Align Barcode Here
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3 justify-end">

                    <button
                        onClick={stopScanner}
                        disabled={!isScanning}
                        className="rounded-lg border px-4 py-2 disabled:opacity-50"
                    >
                        Stop
                    </button>

                    {isTorchAvailable ? (
                        <button
                            onClick={toggleTorch}
                            disabled={!isScanning}
                            className="rounded-lg border px-4 py-2 disabled:opacity-50"
                        >
                            {isTorchOn ? "Torch Off" : "Torch On"}
                        </button>
                    ) : null}

                    <button
                        onClick={resetAll}
                        className="rounded-lg border px-4 py-2"
                    >
                        Reset
                    </button>

                    <button
                        onClick={startScanner}
                        disabled={isStarting || isScanning || isSecureOrigin === false}
                        className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
                    >
                        {isStarting ? "Starting..." : isScanning ? "Scanning..." : "Start Camera"}
                    </button>
                </div>

                {cameraLabel ? (
                    <p className="text-sm text-gray-600">Using camera: {cameraLabel}</p>
                ) : null}

                <div className="grid gap-4 rounded-2xl border p-4 md:grid-cols-2">
                    <div>
                        <div className="text-sm text-gray-500">Last scanned barcode</div>
                        <div className="font-mono text-lg">{scanText || "No scan yet"}</div>
                    </div>

                    <div>
                        <div className="text-sm text-gray-500">Detected format</div>
                        <div className="font-mono text-lg">{scanFormat || "1D barcode only"}</div>
                    </div>

                    {scanText ? (
                        <div
                            className={`space-y-2 rounded-xl border p-4 md:col-span-2 ${product
                                    ? "border-green-200 bg-green-50"
                                    : "border-amber-200 bg-amber-50"
                                }`}
                        >
                            <h2 className="text-lg font-semibold">
                                {product ? "Latest Product" : "Latest Scan"}
                            </h2>
                            {product ? (
                                <>
                                    <div><strong>Name:</strong> {product.name}</div>
                                    <div><strong>Barcode:</strong> {product.barcode}</div>
                                    <div><strong>SKU:</strong> {product.sku}</div>
                                    <div><strong>Price:</strong> Tk {product.price}</div>
                                    <div><strong>Stock:</strong> {product.stock}</div>
                                </>
                            ) : (
                                <div>This barcode is not in the product list yet.</div>
                            )}
                            {latestScan ? (
                                <div><strong>Scanned count:</strong> {latestScan.quantity}</div>
                            ) : null}
                            {lastScannedAt ? (
                                <div><strong>Last scanned at:</strong> {lastScannedAt}</div>
                            ) : null}
                        </div>
                    ) : (
                        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 md:col-span-2">
                            No scan yet. Start the camera and keep scanning until you press Stop.
                        </div>
                    )}

                    {error ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700 md:col-span-2">
                            {error}
                        </div>
                    ) : null}
                </div>

                <div className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-lg font-semibold">Scanned Items</h2>
                        <p className="text-sm text-gray-600">
                            {totalScannedItems} total scans - {scannedItems.length} unique barcodes
                        </p>
                    </div>

                    {scannedItems.length ? (
                        <div
                            ref={scannedItemsContainerRef}
                            className="mt-4 max-h-96 space-y-3 overflow-y-auto pr-1"
                        >
                            {scannedItems.map((item) => (
                                <div key={item.barcode} className="rounded-xl border border-slate-200 p-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="text-base font-semibold">
                                                {item.product?.name ?? "Unknown product"}
                                            </div>
                                            <div className="font-mono text-sm text-slate-600">
                                                {item.barcode}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => updateItemQuantity(item.barcode, -1)}
                                                aria-label={
                                                    item.quantity === 1
                                                        ? `Remove ${item.product?.name ?? item.barcode}`
                                                        : `Decrease quantity for ${item.product?.name ?? item.barcode}`
                                                }
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                                            >
                                                -
                                            </button>
                                            <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                                                Qty {item.quantity}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => updateItemQuantity(item.barcode, 1)}
                                                aria-label={`Increase quantity for ${item.product?.name ?? item.barcode}`}
                                                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 text-lg font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
                                        <div><strong>Format:</strong> {item.format}</div>
                                        {item.product ? <div><strong>SKU:</strong> {item.product.sku}</div> : null}
                                        {item.product ? <div><strong>Price:</strong> Tk {item.product.price}</div> : null}
                                        <div><strong>Last scan:</strong> {item.scannedAt}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="mt-4 text-sm text-gray-600">
                            No items scanned yet.
                        </p>
                    )}
                </div>
            </div>
        </main>
    );
}
