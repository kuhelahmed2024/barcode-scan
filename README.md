## Development

Desktop browser on the same machine:

```bash
npm run dev
```

Phone or another device on your LAN:

```bash
npm run dev:phone
```

Why this matters:

- `http://localhost:3000` is treated as a secure context on your computer, so camera access works.
- `http://192.168.x.x:3000` on a phone is not a secure context, so mobile browsers block `getUserMedia()`.
- `npm run dev:phone` starts Next.js with HTTPS and a LAN host so the barcode camera page has a usable mobile testing path.

Notes for phone testing:

- Open the printed `https://...` address on the phone, not the old `http://...` address.
- Next.js uses `mkcert` here and creates local certificates for the dev machine.
- If the phone still does not trust the certificate, install the mkcert root CA on that device or use an HTTPS tunnel.
