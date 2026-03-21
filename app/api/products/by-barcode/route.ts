import { NextRequest, NextResponse } from "next/server";

const PRODUCTS = [
    {
        barcode: "8901234567890",
        name: "Coca Cola 250ml",
        price: 35,
        stock: 24,
        sku: "DRK-001",
    },
    {
        barcode: "1234567890128",
        name: "Lux Soap",
        price: 55,
        stock: 12,
        sku: "SOAP-002",
    },
    {
        barcode: "9876543210987",
        name: "Pran Biscuit",
        price: 20,
        stock: 48,
        sku: "BIS-003",
    },
];

export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code")?.trim();

    if (!code) {
        return NextResponse.json(
            { success: false, message: "Barcode code is required" },
            { status: 400 }
        );
    }

    const product = PRODUCTS.find((item) => item.barcode === code) || null;

    return NextResponse.json({
        success: true,
        product,
    });
}