import fs from "fs";
import QRCode from "qrcode";
import { generateTicketPdf } from "../src/utils/pdf-generator";

async function run() {
  try {
    const qrDataUrl = await QRCode.toDataURL("sample-qr-data", { width: 300, errorCorrectionLevel: 'H' });
    const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
    const qrBuffer = Buffer.from(qrBase64, "base64");

    const pdfBuffer = await generateTicketPdf({
      eventName: "AI Conference 2026",
      fullName: "Vidhula Kripali",
      qrImageBuffer: qrBuffer,
      bannerImagePath: "asset/DevCommunityBanner.png",
    });

    fs.writeFileSync("test-ticket.pdf", pdfBuffer);
    console.log("PDF generated successfully: test-ticket.pdf");
  } catch (err) {
    console.error("PDF generation failed:", err);
  }
}

run();
