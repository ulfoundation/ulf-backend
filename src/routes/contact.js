import express from "express";
import Contact from "../models/Contact.js";
import { requireAuth } from "../middleware/auth.js";
import nodemailer from "nodemailer";

const router = express.Router();

/* -------------------------------------------------------------------------- */
/* 🔹 GET — Public Access (Fetch Contact Info)                                */
/* -------------------------------------------------------------------------- */
router.get("/", async (req, res) => {
  try {
    let contact = await Contact.findOne();

    if (!contact) {
      contact = await Contact.create({
        email: "support@unitedlinkfoundation.com",
        phone: "+2348039466999, +12026553807",
        message:
          "Get in touch with us for support, partnerships, or inquiries.",
      });
    }

    res.json(contact);
  } catch (err) {
    console.error("❌ Error fetching contact:", err);
    res.status(500).json({ message: "Server error fetching contact details" });
  }
});

/* -------------------------------------------------------------------------- */
/* 🔸 PUT — Admin Only (Update Contact Info)                                 */
/* -------------------------------------------------------------------------- */
router.put("/", requireAuth, async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (userRole !== "admin") {
      return res.status(403).json({ message: "Access denied — Admins only" });
    }

    const { email, phone, message } = req.body;
    let contact = await Contact.findOne();

    if (!contact) {
      contact = await Contact.create({ email, phone, message });
    } else {
      contact.email = email;
      contact.phone = phone;
      contact.message = message;
      await contact.save();
    }

    res.json(contact);
  } catch (err) {
    console.error("❌ Failed to update contact info:", err);
    res.status(500).json({ message: "Failed to update contact info" });
  }
});

/* -------------------------------------------------------------------------- */
/* 📬 POST — Public Contact Form (Send Email via Gmail SMTP)                 */
/* -------------------------------------------------------------------------- */
router.post("/send", async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ message: "All fields are required." });
    }

    // ✅ Gmail SMTP configuration (App Password required)
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // true for SSL (465)
      auth: {
        user: process.env.SMTP_USER, // your Gmail address
        pass: process.env.SMTP_PASS, // Gmail App Password (NOT regular password)
      },
    });

    // ✅ Verify Gmail connection
    await transporter.verify();
    console.log("📡 Gmail SMTP verified successfully");

    const mailOptions = {
      from: `"United Link Foundation Website" <${process.env.SMTP_USER}>`,
      to: "support@unitedlinkfoundation.com", // 🟢 Main recipient
      cc: process.env.SMTP_USER, // 🟣 Optional — sends you a copy too
      replyTo: email,
      subject: `📩 New Contact Form Submission from ${name}`,
      html: `
        <h2>New Message from United Link Foundation Contact Form</h2>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Message:</b></p>
        <p>${message}</p>
        <hr />
        <p style="font-size:12px;color:#777;">
          This message was automatically sent from the United Link Foundation website.
        </p>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent successfully via Gmail SMTP:", info.response);

    res.json({ message: "Message sent successfully!" });
  } catch (err) {
    console.error("❌ Error sending contact email:", err);
    res.status(500).json({
      message: `Failed to send message — ${err.message || "SMTP error"}`,
    });
  }
});

export default router;
