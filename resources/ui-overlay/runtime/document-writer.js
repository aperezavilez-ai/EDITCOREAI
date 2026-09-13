"use strict";

/**
 * DOCUMENT WRITER - Crea documentos PDF, Word y Excel
 */

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require("docx");
const ExcelJS = require("exceljs");

/**
 * Crea un documento PDF
 */
async function createPdf(content, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: options.size || "A4",
        margins: options.margins || {
          top: 50,
          bottom: 50,
          left: 50,
          right: 50,
        },
      });

      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Título
      if (options.title) {
        doc.fontSize(20).font("Helvetica-Bold").text(options.title, {
          align: "center",
        });
        doc.moveDown(2);
      }

      // Contenido
      doc.fontSize(12).font("Helvetica");

      if (typeof content === "string") {
        // Texto simple
        doc.text(content, {
          align: options.align || "left",
          lineGap: 5,
        });
      } else if (Array.isArray(content)) {
        // Array de párrafos
        content.forEach((paragraph, index) => {
          if (typeof paragraph === "string") {
            doc.text(paragraph, { lineGap: 5 });
            if (index < content.length - 1) doc.moveDown();
          } else if (paragraph.type === "heading") {
            doc.fontSize(16).font("Helvetica-Bold").text(paragraph.text);
            doc.fontSize(12).font("Helvetica").moveDown(0.5);
          } else if (paragraph.type === "list") {
            paragraph.items.forEach((item) => {
              doc.text(`• ${item}`, { indent: 20, lineGap: 3 });
            });
            doc.moveDown();
          }
        });
      }

      // Metadata
      if (options.author) doc.info.Author = options.author;
      if (options.subject) doc.info.Subject = options.subject;
      if (options.keywords) doc.info.Keywords = options.keywords;

      doc.end();

      stream.on("finish", () => {
        resolve({
          success: true,
          path: outputPath,
          size: fs.statSync(outputPath).size,
        });
      });

      stream.on("error", reject);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Crea un documento Word (.docx)
 */
async function createWord(content, outputPath, options = {}) {
  try {
    const children = [];

    // Título
    if (options.title) {
      children.push(
        new Paragraph({
          text: options.title,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        })
      );
    }

    // Contenido
    if (typeof content === "string") {
      // Texto simple - dividir en párrafos
      const paragraphs = content.split("\n\n");
      paragraphs.forEach((text) => {
        if (text.trim()) {
          children.push(
            new Paragraph({
              children: [new TextRun(text)],
              spacing: { after: 200 },
            })
          );
        }
      });
    } else if (Array.isArray(content)) {
      // Array estructurado
      content.forEach((item) => {
        if (typeof item === "string") {
          children.push(
            new Paragraph({
              children: [new TextRun(item)],
              spacing: { after: 200 },
            })
          );
        } else if (item.type === "heading") {
          children.push(
            new Paragraph({
              text: item.text,
              heading: item.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
              spacing: { before: 240, after: 120 },
            })
          );
        } else if (item.type === "list") {
          item.items.forEach((listItem) => {
            children.push(
              new Paragraph({
                text: `• ${listItem}`,
                spacing: { after: 100 },
                indent: { left: 720 },
              })
            );
          });
        } else if (item.type === "paragraph") {
          const runs = [];
          if (typeof item.text === "string") {
            runs.push(new TextRun(item.text));
          } else if (Array.isArray(item.text)) {
            item.text.forEach((run) => {
              runs.push(
                new TextRun({
                  text: run.text || run,
                  bold: run.bold,
                  italics: run.italic,
                })
              );
            });
          }
          children.push(
            new Paragraph({
              children: runs,
              spacing: { after: 200 },
            })
          );
        }
      });
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);

    return {
      success: true,
      path: outputPath,
      size: buffer.length,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Crea un archivo Excel (.xlsx)
 */
async function createExcel(data, outputPath, options = {}) {
  const workbook = new ExcelJS.Workbook();
  const addSheet = (sheetName, sheetData) => {
    if (!Array.isArray(sheetData)) throw new Error(`Formato de hoja inválido para ${sheetName}`);
    const worksheet = workbook.addWorksheet(String(sheetName || "Hoja1").slice(0, 31));
    const first = sheetData[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const headers = [...new Set(sheetData.flatMap((row) => Object.keys(row || {})))];
      worksheet.columns = headers.map((key) => ({ header: key, key }));
      worksheet.addRows(sheetData);
    } else {
      worksheet.addRows(sheetData);
    }
  };

  if (Array.isArray(data)) {
    addSheet(options.sheetName || "Hoja1", data);
  } else if (data && typeof data === "object") {
    for (const [sheetName, sheetData] of Object.entries(data)) addSheet(sheetName, sheetData);
  } else {
    throw new Error("Formato de datos inválido para Excel");
  }
  if (!workbook.worksheets.length) throw new Error("Excel requiere al menos una hoja");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
  return {
    success: true,
    path: outputPath,
    size: fs.statSync(outputPath).size,
  };
}

/**
 * Crea CSV simple
 */
async function createCsv(data, outputPath, options = {}) {
  try {
    const delimiter = options.delimiter || ",";
    const lineBreak = options.lineBreak || "\n";

    let csvContent = "";

    if (Array.isArray(data) && Array.isArray(data[0])) {
      // Array de arrays
      csvContent = data
        .map((row) =>
          row
            .map((cell) => {
              const value = String(cell || "");
              // Escapar comillas y encerrar en comillas si contiene delimitador
              if (value.includes(delimiter) || value.includes('"') || value.includes("\n")) {
                return `"${value.replace(/"/g, '""')}"`;
              }
              return value;
            })
            .join(delimiter)
        )
        .join(lineBreak);
    } else if (Array.isArray(data) && typeof data[0] === "object") {
      // Array de objetos
      const headers = Object.keys(data[0]);
      const headerRow = headers.map((h) => `"${h}"`).join(delimiter);
      const dataRows = data
        .map((obj) =>
          headers
            .map((header) => {
              const value = String(obj[header] || "");
              if (value.includes(delimiter) || value.includes('"') || value.includes("\n")) {
                return `"${value.replace(/"/g, '""')}"`;
              }
              return value;
            })
            .join(delimiter)
        )
        .join(lineBreak);

      csvContent = headerRow + lineBreak + dataRows;
    } else {
      throw new Error("Formato de datos inválido para CSV");
    }

    fs.writeFileSync(outputPath, csvContent, "utf8");

    return {
      success: true,
      path: outputPath,
      size: fs.statSync(outputPath).size,
    };
  } catch (error) {
    throw error;
  }
}

module.exports = {
  createPdf,
  createWord,
  createExcel,
  createCsv,
};
