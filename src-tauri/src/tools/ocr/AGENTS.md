# Native OCR

- Own provider HTTP and request cancellation in `online.rs`. Keep `online_ocr` and `cancel_online_ocr` payloads compatible with the frontend OCR service. Grant them, and OCR's clipboard image read, only in `capabilities/ocr.json`.
- Preserve endpoint validation: HTTPS for remote providers, HTTP only for loopback; reject embedded credentials, queries, and fragments. Keep redirects disabled and requests and responses bounded.
- Keep API keys transient and out of logs and persisted data.
- Maintain cancellation by request ID and remove request state after every outcome. Shared text export belongs in `platform/`.
