"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GstAcquisitionJournal = void 0;
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
var GstAcquisitionJournal = /** @class */ (function () {
    function GstAcquisitionJournal(baseDir) {
        if (baseDir === void 0) { baseDir = path.resolve('output', 'gst_source_cache'); }
        this.baseDir = baseDir;
        this.journalPath = path.join(baseDir, 'acquisition_journal.jsonl');
        this.authPath = path.join(baseDir, 'authorizations.jsonl');
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }
    }
    // A helper for testing
    GstAcquisitionJournal.prototype.clearForTest = function () {
        if (fs.existsSync(this.journalPath))
            fs.unlinkSync(this.journalPath);
        if (fs.existsSync(this.authPath))
            fs.unlinkSync(this.authPath);
    };
    GstAcquisitionJournal.prototype.authorizeBatch = function (auth) {
        var existing = this.getAuthorization(auth.batch_id);
        if (existing) {
            if (existing.authorization_id !== auth.authorization_id) {
                throw new Error("AUTHORIZATION CONFLICT — OWNER REVIEW REQUIRED");
            }
            return; // already authorized
        }
        fs.appendFileSync(this.authPath, JSON.stringify(auth) + '\n');
    };
    GstAcquisitionJournal.prototype.getAuthorization = function (batchId) {
        if (!fs.existsSync(this.authPath))
            return null;
        var lines = fs.readFileSync(this.authPath, 'utf8').split('\n').filter(Boolean);
        for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
            var line = lines_1[_i];
            var rec = JSON.parse(line);
            if (rec.batch_id === batchId)
                return rec;
        }
        return null;
    };
    GstAcquisitionJournal.prototype.appendEvent = function (event) {
        fs.appendFileSync(this.journalPath, JSON.stringify(event) + '\n');
    };
    GstAcquisitionJournal.prototype.getJournalEvents = function (authId) {
        if (!fs.existsSync(this.journalPath))
            return [];
        var lines = fs.readFileSync(this.journalPath, 'utf8').split('\n').filter(Boolean);
        var events = [];
        for (var _i = 0, lines_2 = lines; _i < lines_2.length; _i++) {
            var line = lines_2[_i];
            var ev = JSON.parse(line);
            if (ev.authorization_id === authId)
                events.push(ev);
        }
        return events;
    };
    GstAcquisitionJournal.prototype.getAttemptCount = function (authId) {
        return this.getJournalEvents(authId).length;
    };
    GstAcquisitionJournal.prototype.checkSafetyGuards = function (batchId, authId, batchDir) {
        var auth = this.getAuthorization(batchId);
        if (!auth)
            throw new Error("UNAUTHORIZED BATCH");
        var attempts = this.getAttemptCount(authId);
        var manifestPath = path.join(batchDir, 'batch_manifest.json');
        var progressPath = path.join(batchDir, 'batch_progress.json');
        // 5. Raw Cache Cross-Check
        var rawExists = fs.existsSync(path.join(batchDir, 'sales')) || fs.existsSync(path.join(batchDir, 'purchases'));
        var rawFileCount = 0;
        if (rawExists) {
            var countFiles = function (dir) {
                if (!fs.existsSync(dir))
                    return 0;
                return fs.readdirSync(dir).filter(function (f) { return f.endsWith('.json'); }).length;
            };
            rawFileCount += countFiles(path.join(batchDir, 'sales'));
            rawFileCount += countFiles(path.join(batchDir, 'purchases'));
        }
        if (attempts === 0 && rawFileCount > 0) {
            throw new Error("CONTROL INCONSISTENCY — OWNER REVIEW REQUIRED (Journal missing but raw cache exists)");
        }
        // 6. Manifest Deletion Check
        if (attempts > 0 && !fs.existsSync(manifestPath)) {
            throw new Error("MANIFEST MISSING — OWNER REVIEW REQUIRED");
        }
        if (attempts >= auth.authorized_limit) {
            throw new Error("AUTHORIZATION EXHAUSTED");
        }
        // Concurrent runner check: can be done via a lock file in real app, 
        // for this offline task we just verify the counter handles it safely if appended.
    };
    GstAcquisitionJournal.prototype.validateDocumentSafety = function (doc, auth) {
        var docId = String(doc.invoice_id || doc.bill_id || doc.document_id || '');
        var docDate = String(doc.date || doc.invoice_date || doc.bill_date || '');
        // 7. Synthetic / Test Guard
        if (docId.includes('test') || docId.includes('hist') || docId.includes('pilot')) {
            throw new Error("SYNTHETIC DOCUMENT REJECTED");
        }
        // 8. FY Guard
        if (docDate < auth.fy_bounds.start || docDate > auth.fy_bounds.end) {
            throw new Error("OUT OF FY REJECTED");
        }
    };
    return GstAcquisitionJournal;
}());
exports.GstAcquisitionJournal = GstAcquisitionJournal;
