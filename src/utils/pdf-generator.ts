import PDFDocument from "pdfkit";

export async function generateTicketPdf(input: {
  eventName: string;
  fullName: string;
  qrImageBuffer: Buffer;
  bannerImagePath?: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers: Buffer[] = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      const primaryBlue = "#2563eb";
      const slateDark = "#1e293b";
      const slateLight = "#475569";

      // --- PAGE 1: TICKET & QR CODE ---
      // Top event banner (if available)
      if (input.bannerImagePath) {
        try {
          doc.image(input.bannerImagePath, { width: doc.page.width - 100 });
          doc.moveDown(2);
        } catch (error) {
          console.error("Failed to load banner image for PDF", error);
        }
      }

      doc.fontSize(28).font("Helvetica-Bold").fillColor(slateDark).text("Entry Ticket", { align: "center" });
      doc.moveDown(1.5);

      doc.fontSize(20).font("Helvetica-Bold").fillColor(slateDark).text(input.eventName, { align: "center" });
      doc.moveDown(1.5);

      // Attendee Info (Centered nicely)
      doc.fontSize(14).font("Helvetica-Bold").fillColor(primaryBlue).text("Attendee: ", { continued: true }).font("Helvetica").fillColor(slateDark).text(`${input.fullName}`);
      doc.moveDown(0.5);
      doc.fontSize(12).font("Helvetica-Bold").fillColor(primaryBlue).text("Date: ", { continued: true }).font("Helvetica").fillColor(slateLight).text("15th April 2026");
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold").fillColor(primaryBlue).text("Venue: ", { continued: true }).font("Helvetica").fillColor(slateLight).text("H0002 Hochschule Schmalkalden");
      doc.moveDown(3);

      // QR Code centered
      const qrBoxScale = 220;
      const centerX = (doc.page.width - qrBoxScale) / 2;

      doc.font("Helvetica-Bold").fontSize(12).fillColor(slateDark).text("Scan this QR Code at the venue entry", 0, doc.y, { align: "center" });
      doc.moveDown(1);

      const currentY = doc.y;

      // QR Box with a subtle border
      doc.lineWidth(2).strokeColor(primaryBlue).rect(centerX - 10, currentY - 10, qrBoxScale + 20, qrBoxScale + 20).stroke();
      doc.image(input.qrImageBuffer, centerX, currentY, { width: qrBoxScale, height: qrBoxScale });

      // --- PAGE 2: GUIDELINES ---
      doc.addPage();

      // Tiny header bar for continuous pages
      doc.rect(0, 0, doc.page.width, 15).fill(primaryBlue);

      doc.y = 50;
      doc.x = 50;

      doc.fontSize(22).font("Helvetica-Bold").fillColor(slateDark).text("Participant Guidelines", { align: "center" });
      doc.moveDown(2);

      // Helper functions for sections
      const addHeading = (text: string) => {
        doc.moveDown(1).fontSize(16).font("Helvetica-Bold").fillColor(primaryBlue).text(text);
        doc.moveDown(0.2);
        // Draw a subtle line under the heading
        doc.lineWidth(1).strokeColor("#e2e8f0").moveTo(doc.x, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
        doc.moveDown(0.5);
      };

      const addSubHeading = (text: string) => {
        doc.moveDown(0.5).fontSize(12).font("Helvetica-Bold").fillColor(slateDark).text(text);
      };

      const addBullet = (text: string) => {
        doc.fontSize(10).font("Helvetica").fillColor(slateLight).text(` •  ${text}`, { indent: 10 });
      };

      const addParagraph = (text: string) => {
        doc.moveDown(0.5).fontSize(10).font("Helvetica").fillColor(slateLight).text(text);
      };

      // --- Section 1: General Info ---
      addHeading("General Information");

      addSubHeading("What to Bring");
      addBullet("Valid Entry Ticket (QR Code) - Mandatory");
      addBullet("Valid ID Card (Mandatory)");
      addBullet("Fully charged mobile phone");
      addBullet("Laptop (for workshop participants)");
      addBullet("Charger");
      addBullet("Notebook & pen (optional)");
      addBullet("Business cards (optional, for networking)");

      addSubHeading("Arrival & Check-in");
      addBullet("Arrive 15-20 minutes early");
      addBullet("Keep your QR code ready for scanning");
      addBullet("Follow instructions from event volunteers");

      addSubHeading("Internet & Access");
      addBullet("Wi-Fi will be available at the venue");
      addBullet("Event updates/materials may be shared during sessions");

      addSubHeading("Important Notes");
      addBullet("Follow venue and organizer instructions");
      addBullet("Keep your belongings secure");
      addBullet("Maintain a professional and respectful environment");

      // --- Section 2: Conference ---
      addHeading("Conference Details");

      addSubHeading("About the Conference");
      addParagraph("Welcome to the AI Conference 2026. This conference brings together:");
      addBullet("Industry experts and researchers");
      addBullet("AI enthusiasts");
      addBullet("Students and professionals");
      addParagraph("Expect:");
      addBullet("Insightful talks on Artificial Intelligence");
      addBullet("Real-world use cases and innovations");
      addBullet("Interactive discussions and Q&A sessions");

      addSubHeading("Participation & Networking");
      addBullet("Engage actively in sessions");
      addBullet("Participate in discussions and Q&A");
      addBullet("Connect with speakers and fellow attendees");
      addBullet("Be open to diverse ideas and perspectives");

      addSubHeading("Conference Etiquette");
      addBullet("Keep your phone on silent mode during sessions");
      addBullet("Avoid interruptions during talks");
      addBullet("Photography is allowed unless stated otherwise");
      addBullet("Maintain respectful and professional behavior");

      // Moving Workshop to next page to keep things clean
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 15).fill(primaryBlue);
      doc.y = 50;
      doc.x = 50;

      // --- Section 3: Workshop ---
      addHeading("Workshop: Build Your Own Smarter LLM");

      addSubHeading("Requirements");
      addBullet("Bring your personal laptop (mandatory)");
      addBullet("Ensure it is fully charged and bring your charger");
      addBullet("Recommended: 8GB RAM or higher (lower specs are acceptable)");

      addSubHeading("Pre-Installation (Important)");
      addParagraph("Please install the following before arriving:");
      addBullet("Visual Studio Code (Recommended extensions: Python, Jupyter, Docker)");
      addBullet("Git (Verify installation: git --version)");
      addBullet("Python (3.10 or above) - Ensure it is added to PATH");
      addBullet("Docker Desktop - Ensure it runs without errors");

      addSubHeading("Setup & Access");
      addBullet("Ensure your device can connect to Wi-Fi");
      addBullet("Workshop resources and GitHub links will be shared during the session");

      addSubHeading("Recommended Knowledge");
      addBullet("Basic understanding of Python");
      addBullet("Familiarity with command line");
      addParagraph("-> No prior AI/ML experience is required");

      addSubHeading("Workshop Note");
      addParagraph("Even if you have a low-spec laptop, you can still participate.\nWe will provide:");
      addBullet("Lightweight setups");
      addBullet("On-site support");

      doc.moveDown(4);
      doc.fontSize(16).font("Helvetica-Bold").fillColor(slateDark).text("We Look Forward to Seeing You!", { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(12).font("Helvetica").fillColor(slateLight).text("Let's learn, connect, and innovate together.", { align: "center" });
      doc.moveDown(1);
      doc.fontSize(12).font("Helvetica-Bold").fillColor(primaryBlue).text("HSM Developer Community", { align: "center" });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
