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
    const [isTorchOn, setIsTorchOn] = useState(false);
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
            setIsTorchAvailable(cameraSetup.torchAvailable);
        } catch (err) {
            setError(getCameraErrorMessage(err));
            setIsScanning(false);
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
        setScannedItems([]);
        setScanEventCount(0);
        setError("");
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

    const totalScannedItems = scannedItems.reduce((total, item) => total + item.quantity, 0);

    const subtotalAmount = scannedItems.reduce(
        (total, item) => total + (item.product?.price ?? 0) * item.quantity,
        0
    );

    const statusText = isStarting
        ? "Starting camera..."
        : isScanning
            ? "Live scanning"
            : "Camera stopped";

    const formatTaka = (amount: number) => `Tk ${amount.toLocaleString("en-BD")}`;

    const baseButton =
        "inline-flex h-12 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

    return (
        <main className="min-h-screen bg-slate-50 text-slate-900">
            <div className="mx-auto max-w-6xl">
                {isSecureOrigin === false ? (
                    <div className="mb-6 rounded-3xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
                        <p className="text-sm font-semibold">Camera is blocked on this connection</p>
                        <p className="mt-2 text-sm text-amber-800">
                            Current origin: <span className="font-mono">{origin}</span>. Mobile browsers
                            usually block camera access on HTTP IP addresses. Use HTTPS or localhost.
                        </p>
                        <p className="mt-2 text-sm text-amber-700">
                            Run your secure dev command, open the printed HTTPS URL on the phone, and
                            trust the certificate if needed.
                        </p>
                    </div>
                ) : null}

                <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-lg shadow-slate-200/60">
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
                                        ? "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200"
                                        : "bg-white/95 text-slate-700 ring-1 ring-slate-200"
                                        }`}
                                >
                                    {statusText}
                                </span>
                            </div>

                            {isTorchAvailable ? (
                                <div className="pointer-events-auto absolute bottom-4 right-4 z-50 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={toggleTorch}
                                        className="inline-flex cursor-pointer items-center rounded-full bg-white/95 p-4 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                                    >
                                        {isTorchOn ? (
                                            <FlashlightOff className="h-4 w-4" />
                                        ) : (
                                            <Flashlight className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                            ) : null}

                            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-5 sm:px-8">
                                <div
                                    className={`relative mx-auto h-28 max-w-2xl rounded-[28px] border-2 transition-all duration-300 ${isSuccessFlashActive
                                        ? "border-emerald-400 bg-emerald-400/10 shadow-[0_0_0_9999px_rgba(16,185,129,0.10)]"
                                        : "border-white/90 bg-white/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.18)]"
                                        }`}
                                >
                                    <div
                                        className={`absolute inset-x-6 top-1/2 h-px -translate-y-1/2 ${isScanning ? "bg-emerald-400/90 animate-pulse" : "bg-white/70"
                                            }`}
                                    />
                                </div>

                                <p className="mt-3 text-center text-xs font-semibold uppercase text-white sm:text-sm">
                                    Center barcode inside the frame
                                </p>
                            </div>
                        </div>
                    </div>

                    {error ? (
                        <div className="border-t border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {error}
                        </div>
                    ) : null}

                    <div className="border-t border-slate-200 p-4 sm:p-5">
                        <div className="flex justify-around gap-2">
                            <button
                                type="button"
                                onClick={resetAll}
                                className={`${baseButton} w-full border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100`}
                            >
                                Reset all
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    if (!isStarting && isScanning) {
                                        stopScanner();
                                    } else {
                                        startScanner();
                                    }
                                }}
                                disabled={isStarting || isSecureOrigin === false}
                                className={`${baseButton} w-full ${!isStarting && isScanning
                                    ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                                    : "bg-emerald-500 text-white hover:bg-emerald-600"
                                    }`}
                            >
                                {isStarting ? "Starting..." : isScanning ? "Stop" : "Start"}
                            </button>
                        </div>
                    </div>
                </section>

                <section className="mt-4 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-lg shadow-slate-200/50">
                    <div className="border-b border-slate-200 px-4 py-4 sm:px-6">
                        <div className="flex justify-between gap-3">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">Scanned items</h2>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-1 px-3 text-sm text-slate-700">
                                <span className="font-semibold text-slate-900">{totalScannedItems}</span> scans ·{" "}
                                <span className="font-semibold text-slate-900">{scannedItems.length}</span> unique ·{" "}
                                <span className="font-semibold text-slate-900">{formatTaka(subtotalAmount)}</span>
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
                                            className="rounded-3xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-white"
                                        >
                                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h3 className="text-lg font-semibold text-slate-900">
                                                            {item.product?.name ?? "Unknown product"}
                                                        </h3>

                                                        {item.product ? (
                                                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                                                SKU {item.product.sku}
                                                            </span>
                                                        ) : (
                                                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                                                                Needs product mapping
                                                            </span>
                                                        )}
                                                    </div>

                                                    <p className="mt-2 break-all font-mono text-xs text-slate-500">
                                                        {item.barcode}
                                                    </p>

                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                        <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                                                            Format: {item.format}
                                                        </span>
                                                        <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                                                            Last scan: {item.scannedAt}
                                                        </span>
                                                        {item.product ? (
                                                            <>
                                                                <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                                                                    Unit price: {formatTaka(item.product.price)}
                                                                </span>
                                                                <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                                                                    Stock: {item.product.stock}
                                                                </span>
                                                            </>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-4 lg:items-end">
                                                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left lg:text-right">
                                                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                                            Line total
                                                        </p>
                                                        <p className="mt-1 text-2xl font-bold text-slate-900">
                                                            {formatTaka(lineTotal)}
                                                        </p>
                                                    </div>

                                                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-2 shadow-sm">
                                                        <button
                                                            type="button"
                                                            onClick={() => updateItemQuantity(item.barcode, -1)}
                                                            aria-label={
                                                                item.quantity === 1
                                                                    ? `Remove ${item.product?.name ?? item.barcode}`
                                                                    : `Decrease quantity for ${item.product?.name ?? item.barcode}`
                                                            }
                                                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-slate-50 text-lg font-bold text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
                                                        >
                                                            −
                                                        </button>

                                                        <div className="min-w-21 text-center">
                                                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                                                Quantity
                                                            </p>
                                                            <p className="text-lg font-bold text-slate-900">
                                                                {item.quantity}
                                                            </p>
                                                        </div>

                                                        <button
                                                            type="button"
                                                            onClick={() => updateItemQuantity(item.barcode, 1)}
                                                            aria-label={`Increase quantity for ${item.product?.name ?? item.barcode}`}
                                                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-lg font-bold text-emerald-700 transition hover:bg-emerald-100"
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
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-2xl">
                                📦
                            </div>
                            <h3 className="mt-4 text-xl font-semibold text-slate-900">
                                No items scanned yet
                            </h3>
                            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                                Start the camera and scan a product barcode. New items will appear here
                                instantly with quantity controls and pricing details.
                            </p>
                        </div>
                    )}
                </section>
            </div>
        </main>
    )
}
