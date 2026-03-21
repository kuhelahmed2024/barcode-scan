"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";

type Product = {
    barcode: string;
    name: string;
    price: number;
    stock: number;
    sku: string;
};

const PRODUCTS: Record<string, Product> = {
    "8901234567890": {
        barcode: "8901234567890",
        name: "Coca Cola 250ml",
        price: 35,
        stock: 24,
        sku: "DRK-001",
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

const REAR_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
    audio: false,
    video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
    },
};

const FALLBACK_CAMERA_CONSTRAINTS: MediaStreamConstraints = {
    audio: false,
    video: true,
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

export default function BarcodeDemoPage() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const readerRef = useRef<BrowserMultiFormatReader | null>(null);
    const controlsRef = useRef<IScannerControls | null>(null);
    const scannedOnceRef = useRef(false);

    const [isStarting, setIsStarting] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [scanText, setScanText] = useState("");
    const [product, setProduct] = useState<Product | null>(null);
    const [error, setError] = useState("");
    const [cameraLabel, setCameraLabel] = useState("");
    const [origin, setOrigin] = useState("");
    const [isSecureOrigin, setIsSecureOrigin] = useState<boolean | null>(null);

    useEffect(() => {
        setOrigin(window.location.origin);
        setIsSecureOrigin(window.isSecureContext);

        return () => {
            stopScanner();
        };
    }, []);

    function handleScanResult(
        result: { getText(): string } | undefined,
        _error: unknown,
        controls: IScannerControls
    ) {
        controlsRef.current = controls;

        if (!result || scannedOnceRef.current) {
            return;
        }

        scannedOnceRef.current = true;

        const text = result.getText().trim();
        setScanText(text);

        const foundProduct = PRODUCTS[text] || null;
        setProduct(foundProduct);
        setError(foundProduct ? "" : `No product found for barcode: ${text}`);

        controls.stop();
        controlsRef.current = null;
        setIsScanning(false);
    }

    async function startScanner() {
        try { 
            setError("");
            setProduct(null);
            setScanText("");
            scannedOnceRef.current = false;
            setIsStarting(true);

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
                readerRef.current = new BrowserMultiFormatReader();
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

            const stream = videoRef.current.srcObject;
            if (stream instanceof MediaStream) {
                const [track] = stream.getVideoTracks();
                setCameraLabel(track?.label || "Camera");
            } else {
                setCameraLabel("Camera");
            }
        } catch (err) {
            setError(getCameraErrorMessage(err));
            setIsScanning(false);
            setCameraLabel("");
        } finally {
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
        setIsScanning(false);
    }

    function resetAll() {
        stopScanner();
        scannedOnceRef.current = false;
        setScanText("");
        setProduct(null);
        setError("");
        setCameraLabel("");
    }

    return (
        <main className="min-h-screen bg-white text-black p-6">
            <div className="mx-auto max-w-2xl space-y-6">
                <div>
                    <h1 className="text-2xl font-bold">Barcode Scanner Demo</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Open the camera, scan a barcode, and show the matching product info.
                    </p>
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

                <div className="flex flex-wrap gap-3">
                    <button
                        onClick={startScanner}
                        disabled={isStarting || isScanning || isSecureOrigin === false}
                        className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
                    >
                        {isStarting ? "Starting..." : isScanning ? "Scanning..." : "Start Camera"}
                    </button>

                    <button
                        onClick={stopScanner}
                        disabled={!isScanning}
                        className="rounded-lg border px-4 py-2 disabled:opacity-50"
                    >
                        Stop
                    </button>

                    <button
                        onClick={resetAll}
                        className="rounded-lg border px-4 py-2"
                    >
                        Reset
                    </button>
                </div>

                <div className="overflow-hidden rounded-2xl border bg-gray-100">
                    <video
                        ref={videoRef}
                        className="aspect-video w-full bg-black object-cover"
                        autoPlay
                        muted
                        playsInline
                    />
                </div>

                {cameraLabel ? (
                    <p className="text-sm text-gray-600">Using camera: {cameraLabel}</p>
                ) : null}

                <div className="space-y-3 rounded-2xl border p-4">
                    <div>
                        <div className="text-sm text-gray-500">Scanned barcode</div>
                        <div className="font-mono text-lg">{scanText || "No scan yet"}</div>
                    </div>

                    {product ? (
                        <div className="space-y-2 rounded-xl border border-green-200 bg-green-50 p-4">
                            <h2 className="text-lg font-semibold">Product Found</h2>
                            <div><strong>Name:</strong> {product.name}</div>
                            <div><strong>Barcode:</strong> {product.barcode}</div>
                            <div><strong>SKU:</strong> {product.sku}</div>
                            <div><strong>Price:</strong> Tk {product.price}</div>
                            <div><strong>Stock:</strong> {product.stock}</div>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4">
                            No product matched yet.
                        </div>
                    )}

                    {error ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
                            {error}
                        </div>
                    ) : null}
                </div>
            </div>
        </main>
    );
}
