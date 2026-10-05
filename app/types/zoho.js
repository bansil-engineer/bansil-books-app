"use strict";
// ============================================================
// Zoho Books — Shared TypeScript Types
// Server-side and client-side safe (no secrets here)
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZOHO_STATUS_ENDPOINT = exports.ZOHO_DISCONNECT_ENDPOINT = exports.ZOHO_CALLBACK_ENDPOINT = exports.ZOHO_CONNECT_ENDPOINT = void 0;
// ---- Centralized Zoho Auth & Sync Endpoints ----
exports.ZOHO_CONNECT_ENDPOINT = "/api/zoho/connect";
exports.ZOHO_CALLBACK_ENDPOINT = "/api/zoho/callback";
exports.ZOHO_DISCONNECT_ENDPOINT = "/api/sync/disconnect";
exports.ZOHO_STATUS_ENDPOINT = "/api/zoho/status";
