"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatOneDReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, type Result } from "@zxing/library";
import { Flashlight, FlashlightOff } from "lucide-react";

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
    const activeBarcodeRef = useRef<string | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const controlsRef = useRef<IScannerControls | null>(null);
    const successFlashTimeoutRef = useRef<number | null>(null);
    const clearActiveBarcodeTimeoutRef = useRef<number | null>(null);
    const readerRef = useRef<BrowserMultiFormatOneDReader | null>(null);
    const scannedItemsContainerRef = useRef<HTMLDivElement | null>(null);

    const [error, setError] = useState("");
    const [origin, setOrigin] = useState("");
    const [scanText, setScanText] = useState("");
    const [isTorchOn, setIsTorchOn] = useState(false);
    const [cameraLabel, setCameraLabel] = useState("");
    const [isStarting, setIsStarting] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanEventCount, setScanEventCount] = useState(0);
    const [isTorchAvailable, setIsTorchAvailable] = useState(false);
    const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
    const [isSuccessFlashActive, setIsSuccessFlashActive] = useState(false);
    const [isSecureOrigin, setIsSecureOrigin] = useState<boolean | null>(null);

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
        const foundProduct = PRODUCTS[text] || null;
        const scannedAt = new Date(now).toLocaleTimeString();
        const format = BarcodeFormat[result.getBarcodeFormat()] || "BARCODE";

        setError("");
        setScanText(text);
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

        triggerSuccessFlash();
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

    const subtotalAmount = scannedItems.reduce(
        (total, item) => total + (item.product?.price ?? 0) * item.quantity,
        0
    );

    const unknownItemsCount = scannedItems.filter((item) => !item.product).length;

    const statusText = isStarting
        ? "Starting camera..."
        : isScanning
            ? "Live scanning"
            : "Camera stopped";

    const formatTaka = (amount: number) => `Tk ${amount.toLocaleString("en-BD")}`;

    const baseButton =
        "inline-flex h-12 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

    return (
        <main className="min-h-screen bg-slate-950 text-slate-100">
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
                {isSecureOrigin === false ? (
                    <div className="mb-6 rounded-3xl border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100">
                        <p className="text-sm font-semibold">Camera is blocked on this connection</p>
                        <p className="mt-2 text-sm text-amber-50/90">
                            Current origin: <span className="font-mono">{origin}</span>. Mobile browsers
                            usually block camera access on HTTP IP addresses. Use HTTPS or localhost.
                        </p>
                        <p className="mt-2 text-sm text-amber-50/80">
                            Run your secure dev command, open the printed HTTPS URL on the phone, and
                            trust the certificate if needed.
                        </p>
                    </div>
                ) : null}

                <section className="overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/20">
                    <div className="relative">
                        <video
                            ref={videoRef}
                            className="aspect-16/10 w-full bg-black object-cover"
                            autoPlay
                            muted
                            playsInline
                        />

                        <div className="pointer-events-none absolute inset-0">
                            <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                                <span
                                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${isScanning
                                        ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30"
                                        : "bg-slate-800/90 text-slate-300 ring-1 ring-slate-700"
                                        }`}
                                >
                                    {statusText}
                                </span>
                            </div>

                            {
                                isTorchAvailable && (
                                    <div className="absolute right-4 bottom-4 flex flex-wrap gap-2">
                                        <span
                                            className={` inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-slate-800/90 text-slate-300 ring-1 ring-slate-700`}
                                        >
                                            {isTorchOn
                                                ? <Flashlight />
                                                : <FlashlightOff />
                                            }
                                        </span>
                                    </div>
                                )
                            }

                            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-5 sm:px-8">
                                <div
                                    className={`relative mx-auto h-28 max-w-2xl rounded-[28px] border-2 transition-all duration-300 ${isSuccessFlashActive
                                        ? "border-emerald-400 bg-emerald-400/10 shadow-[0_0_0_9999px_rgba(16,185,129,0.12)]"
                                        : "border-white/85 bg-black/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                                        }`}
                                >
                                    <div
                                        className={`absolute inset-x-6 top-1/2 h-px -translate-y-1/2 ${isScanning ? "bg-emerald-400/80 animate-pulse" : "bg-white/50"
                                            }`}
                                    />
                                </div>

                                <p className="mt-3 text-center text-xs font-semibold uppercase text-white/90 sm:text-sm">
                                    Center barcode inside the frame
                                </p>
                            </div>
                        </div>
                    </div>

                    {error ? (
                        <div className="border-t border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                            {error}
                        </div>
                    ) : null}

                    <div className="border-t border-slate-800 p-4 sm:p-5">
                        <div className="flex gap-2 justify-around">

                            <button
                                type="button"
                                onClick={resetAll}
                                className={`${baseButton} w-full border border-slate-700 bg-slate-900 text-slate-100 hover:border-slate-500 hover:bg-slate-800`}
                            >
                                Reset all
                            </button>

                            <button
                                type="button"
                                onClick={toggleTorch}
                                disabled={!isScanning || !isTorchAvailable}
                                className={`${baseButton} w-full border border-slate-700 bg-slate-800 text-slate-100 hover:border-slate-500 hover:bg-slate-700`}
                            >
                                {!isTorchAvailable
                                    ? "Torch"
                                    : isTorchOn
                                        ? "Torch off"
                                        : "Torch on"}
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    if (!isStarting && isScanning) {
                                        stopScanner()
                                    } else {
                                        startScanner()
                                    }
                                }}
                                disabled={isStarting || isScanning || isSecureOrigin === false}
                                className={`${baseButton} ${(!isStarting && isScanning) ? "border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20" : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"} w-full`}
                            >
                                {isStarting ? "Starting..." : isScanning ? "Stop" : "Start"}
                            </button>
                        </div>
                    </div>
                </section>

                <section className="mt-6 overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900/70 shadow-xl shadow-black/10">
                    <div className="border-b border-slate-800 px-4 py-4 sm:px-6">
                        <div className="flex gap-3 justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-white">Scanned items</h2>
                            </div>

                            <div className="rounded-2xl bg-slate-800/80 p-1 px-3 text-sm text-slate-200">
                                <span className="font-semibold text-white">{totalScannedItems}</span> scans ·{" "}
                                <span className="font-semibold text-white">{scannedItems.length}</span> unique ·{" "}
                                <span className="font-semibold text-white">{formatTaka(subtotalAmount)}</span>
                            </div>
                        </div>
                    </div>

                    {scannedItems.length ? (
                        <div
                            ref={scannedItemsContainerRef}
                            className="max-h-136 overflow-y-auto p-4 sm:p-6"
                        >
                            <div className="space-y-4">
                                {scannedItems.map((item) => {
                                    const lineTotal = (item.product?.price ?? 0) * item.quantity;

                                    return (
                                        <div
                                            key={item.barcode}
                                            className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4 transition hover:border-slate-700"
                                        >
                                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h3 className="text-lg font-semibold text-white">
                                                            {item.product?.name ?? "Unknown product"}
                                                        </h3>

                                                        {item.product ? (
                                                            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                                                                SKU {item.product.sku}
                                                            </span>
                                                        ) : (
                                                            <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-medium text-amber-200">
                                                                Needs product mapping
                                                            </span>
                                                        )}
                                                    </div>

                                                    <p className="mt-2 break-all font-mono text-xs text-slate-400">
                                                        {item.barcode}
                                                    </p>

                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                                                            Format: {item.format}
                                                        </span>
                                                        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                                                            Last scan: {item.scannedAt}
                                                        </span>
                                                        {item.product ? (
                                                            <>
                                                                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                                                                    Unit price: {formatTaka(item.product.price)}
                                                                </span>
                                                                <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                                                                    Stock: {item.product.stock}
                                                                </span>
                                                            </>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-4 lg:items-end">
                                                    <div className="rounded-2xl bg-slate-800/80 px-4 py-3 text-left lg:text-right">
                                                        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                            Line total
                                                        </p>
                                                        <p className="mt-1 text-2xl font-bold text-white">
                                                            {formatTaka(lineTotal)}
                                                        </p>
                                                    </div>

                                                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-2 py-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => updateItemQuantity(item.barcode, -1)}
                                                            aria-label={
                                                                item.quantity === 1
                                                                    ? `Remove ${item.product?.name ?? item.barcode}`
                                                                    : `Decrease quantity for ${item.product?.name ?? item.barcode}`
                                                            }
                                                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-lg font-bold text-slate-100 transition hover:border-slate-400 hover:bg-slate-700"
                                                        >
                                                            −
                                                        </button>

                                                        <div className="min-w-21 text-center">
                                                            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                                                                Quantity
                                                            </p>
                                                            <p className="text-lg font-bold text-white">
                                                                {item.quantity}
                                                            </p>
                                                        </div>

                                                        <button
                                                            type="button"
                                                            onClick={() => updateItemQuantity(item.barcode, 1)}
                                                            aria-label={`Increase quantity for ${item.product?.name ?? item.barcode}`}
                                                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/15 text-lg font-bold text-emerald-300 transition hover:bg-emerald-500/25"
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="px-6 py-16 text-center">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-2xl">
                                📦
                            </div>
                            <h3 className="mt-4 text-xl font-semibold text-white">
                                No items scanned yet
                            </h3>
                            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
                                Start the camera and scan a product barcode. New items will appear here
                                instantly with quantity controls and pricing details.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    );
}
