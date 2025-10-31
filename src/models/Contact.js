import mongoose from "mongoose";

const contactSchema = new mongoose.Schema(
  {
    address: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    hours: { type: String, default: "" },
    mapUrl: { type: String, default: "" },
    socials: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      twitter: { type: String, default: "" },
      linkedin: { type: String, default: "" },
    },
    image: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Contact", contactSchema);
