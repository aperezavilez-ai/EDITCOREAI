"use strict";

const path = require("node:path");
const ExcelJS = require("exceljs");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_TEXT = 60_000;

function truncateText(value, max) {
  const text = String(value || "");
  return text.length <= max ? text : `${text.slice(0, max)}\n[EDITCOREAI: contenido truncado]`;
}

function decodeAttachmentDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/\r\n=]+)$/i);
  if (!match) throw new Error("El archivo adjunto no tiene un formato base64 valido.");
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) throw new Error("El archivo adjunto esta vacio.");
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error("El archivo adjunto supera 8 MB.");
  return { mimeType: match[1].toLowerCase(), buffer };
}

function documentExtension(name) {
  return path.extname(String(name || "")).toLowerCase();
}

async function extractDocumentAttachment(document) {
  const name = String(document?.name || "archivo").slice(0, 160);
  const extension = documentExtension(name);
  try {
    const { mimeType, buffer } = decodeAttachmentDataUrl(document?.dataUrl);
    let text = "";
    let format = extension || mimeType;
    if ([".xlsx", ".xls", ".xlsm", ".csv"].includes(extension) || /spreadsheet|excel|csv/i.test(mimeType)) {
      if (extension === ".csv" || /csv/i.test(mimeType)) {
        text = buffer.toString("utf8");
      } else {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        text = workbook.worksheets.map((sheet) => {
          const rows = [];
          sheet.eachRow({ includeEmpty: false }, (row) => {
            rows.push(row.values.slice(1).map((value) => {
              if (value && typeof value === "object") {
                if (value.text) return value.text;
                if (value.result !== undefined) return value.result;
                if (value.hyperlink) return value.text || value.hyperlink;
              }
              return value == null ? "" : String(value);
            }).join(","));
          });
          return `## Hoja: ${sheet.name}\n${rows.join("\n")}`;
        }).join("\n\n");
      }
      format = "excel";
    } else if (extension === ".docx" || /wordprocessingml\.document/i.test(mimeType)) {
      text = (await mammoth.extractRawText({ buffer })).value;
      format = "word-docx";
    } else if (extension === ".pdf" || mimeType === "application/pdf") {
      text = (await pdfParse(buffer)).text;
      format = "pdf";
    } else if ([".txt", ".md", ".markdown", ".json", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".xml", ".csv"].includes(extension)
      || /^text\//i.test(mimeType) || /json|javascript|typescript|css|html|xml/i.test(mimeType)) {
      text = buffer.toString("utf8");
      format = "text";
    } else {
      return { name, format, supported: false, error: `Formato no compatible: ${extension || mimeType}.` };
    }
    const normalized = String(text || "").replace(/\u0000/g, "").trim();
    return {
      name,
      format,
      supported: true,
      truncated: normalized.length > MAX_DOCUMENT_TEXT,
      text: truncateText(normalized, MAX_DOCUMENT_TEXT),
    };
  } catch (error) {
    return { name, format: extension || "desconocido", supported: false, error: String(error?.message || error).slice(0, 500) };
  }
}

async function extractDocumentFromBuffer(name = "", buffer) {
  const extension = documentExtension(name);
  const safeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!safeBuffer.length) {
    return { name, format: extension || "desconocido", supported: false, error: "Archivo vacio." };
  }
  if (safeBuffer.length > MAX_DOCUMENT_BYTES) {
    return { name, format: extension || "desconocido", supported: false, error: "Documento supera 8 MB." };
  }
  return extractDocumentAttachment({
    name,
    dataUrl: `data:application/octet-stream;base64,${safeBuffer.toString("base64")}`,
  });
}

async function normalizeDocuments(documents) {
  if (!Array.isArray(documents)) return [];
  return Promise.all(documents.slice(0, 6).map(extractDocumentAttachment));
}

function documentContext(documents = []) {
  return documents.map((document) => document.supported
    ? `[ARCHIVO ADJUNTO: ${document.name} | formato ${document.format}]\n${document.text}`
    : `[ARCHIVO NO PROCESADO: ${document.name}] ${document.error || "Formato no compatible."}`
  ).join("\n\n");
}

module.exports = {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_TEXT,
  decodeAttachmentDataUrl,
  documentContext,
  documentExtension,
  extractDocumentAttachment,
  extractDocumentFromBuffer,
  normalizeDocuments,
};
